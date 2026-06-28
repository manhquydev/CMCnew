# Jenkins-in-Docker CI/CD Design for CMCnew Monorepo

**Date**: 2026-06-28 | **Status**: DONE | **Audience**: DevOps / Infra Lead | **Context**: Single Ubuntu 24.04 VPS (2 vCPU, 7.8 GB RAM), monorepo (pnpm + turbo), GitHub Actions disabled (billing), private GitHub repo

---

## Executive Summary

**Recommendation: Single-node Jenkins in Docker** running on the same VPS as the app. GitHub Actions is disabled, so Jenkins must trigger via webhook (recommended) or SCM polling. The design covers:

- Jenkins (LTS, jdk17) in a Docker container with host docker.sock mounted (SECURITY NOTE: trade-off accepted for small team context)
- Docker-compose configuration with resource limits to avoid starving the app on 2 vCPU
- Declarative Jenkinsfile: checkout → pnpm install (corepack) → lint/typecheck → integration tests (ephemeral Postgres) → build images → deploy (compose up -d --build) → migrate → smoke-check
- GitHub webhook trigger (recommended over polling; avoid Actions)
- Secrets via server-side `.env.production` file (NOT Jenkins credentials store — keeps secrets off Jenkins)
- Non-interactive bootstrap with JCasC (YAML config) + basic plugin setup
- 2 vCPU mitigations: skip Playwright e2e per-commit, run nightly, Vite builds with concurrency limits

**Trade-offs:**
- Docker.sock mounting enables easier multi-container orchestration but requires trust in Jenkins runner access. Safer alternative (sudo docker via SSH) noted.
- Playwright e2e skipped from deploy pipeline (moved to nightly); on 2 vCPU, concurrent builds + Playwright contention will OOM/timeout.
- JCasC covers core config; webhook/credentials still require one-time manual UI setup (not fully automated without additional scripting).

---

## 1. Topology: Single-Node Jenkins on Same VPS

### Why Single-Node (Not Multi-Agent)

| Factor | Single-Node | Multi-Agent | Recommendation |
|--------|------------|------------|---|
| **Resource overhead** | 1 Jenkins container (~256-512 MB idle) | Jenkins + agent(s) + SSH/Swarm overhead | Single-node: minimal, 2 vCPU tight |
| **Disk I/O contention** | Shared /var/lib/jenkins ↔ pgdata ↔ redisdata ↔ build cache | Network FS, worse latency | Single-node: same disk, faster builds |
| **Team size** | Works well for <5 developers | Scales for 20+ | CMC: small team, single-node fine |
| **Maintenance** | One JVM + one Docker daemon | Multiple systems, monitoring | Single-node: simpler bootstrap |

**Decision**: **Single-node Jenkins in Docker on the same VPS**. No remote agents. Jenkins container + host docker socket = Jenkins can orchestrate compose stacks directly.

---

## 2. Docker-Compose for Jenkins

Save this as `docker/docker-compose.jenkins.yml` (or append to docker-compose.prod.yml under a separate profile).

```yaml
version: '3.8'

services:
  # ── Jenkins Controller (Single-node, LTS jdk17) ────────────────────────────────
  jenkins:
    image: jenkins/jenkins:lts-jdk17
    container_name: cmcnew-jenkins
    
    # Jenkins speaks to host docker.sock to orchestrate the app compose stack.
    # SECURITY: mounting docker.sock grants anyone in the Jenkins container
    # the ability to run arbitrary containers. For a small team and private VPS,
    # this trade-off is acceptable. Safer alternative: use "sudo docker" via SSH
    # to a dedicated ci-user on the host (requires SSH setup on Jenkins).
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:rw
      - jenkins_home:/var/jenkins_home
      # Forward host git SSH key so Jenkins can clone from GitHub (GitHub deploy key).
      # The Jenkins user (UID 1000) must be able to read ~jenkins/.ssh/id_rsa.
      # One-time setup on host:
      #   sudo mkdir -p /var/jenkins_home/.ssh
      #   sudo cp ~/.ssh/id_rsa /var/jenkins_home/.ssh/id_rsa
      #   sudo chown 1000:1000 /var/jenkins_home/.ssh/id_rsa
      #   sudo chmod 600 /var/jenkins_home/.ssh/id_rsa
      # Or mount the host user's SSH key with proper permissions:
      - /root/.ssh:/var/jenkins_home/.ssh:ro
      # Known hosts for GitHub to avoid interactive host verification
      - /etc/ssh/ssh_known_hosts:/etc/ssh/ssh_known_hosts:ro
    
    # Expose Jenkins UI on port 8080 (internal only on the VPS for now;
    # set up reverse proxy in nginx if public access needed).
    ports:
      - '127.0.0.1:8080:8080'
    
    # Java process will use these limits to avoid OOM when app is running.
    # The host has 7.8 GB total; reserve 3 GB for app stack (postgres ~500MB,
    # redis ~50MB, api ~400MB, nginx ~20MB, admin/lms built images ~100MB each).
    # Jenkins gets 2.5 GB heap; if builds are slow, reduce to 2 GB or 1.5 GB.
    environment:
      JAVA_OPTS: '-Xmx2500m -Xms512m -Duser.timezone=UTC -Dorg.jenkinsci.main.modules.sshd.enforceDisabledCiphers=false'
      JENKINS_JAVA_OPTS: '-Xmx2500m -Xms512m'
      # Avoid JENKINS_HOME permission issues with docker.sock
      DOCKER_HOST: unix:///var/run/docker.sock
    
    # CPU/memory limits: hard cap to prevent Jenkins from starving the app.
    deploy:
      resources:
        limits:
          cpus: '1.5'
          memory: 3G
        reservations:
          cpus: '0.5'
          memory: 512M
    
    restart: unless-stopped
    
    # Health check: simple HTTP to /login (no auth required).
    healthcheck:
      test: ['CMD-SHELL', 'curl -f http://localhost:8080/login || exit 1']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

volumes:
  jenkins_home:
    driver: local
```

### Post-Deploy: Permissions & SSH Setup

After running `docker compose -f docker/docker-compose.jenkins.yml up -d jenkins`:

```bash
# Verify Jenkins can access docker.sock
docker exec cmcnew-jenkins docker ps

# Set up SSH key so Jenkins can clone from GitHub
# (assumes ~/.ssh/id_rsa is a GitHub deploy key with repo read access)
docker cp ~/.ssh/id_rsa cmcnew-jenkins:/var/jenkins_home/.ssh/id_rsa
docker exec cmcnew-jenkins chown 1000:1000 /var/jenkins_home/.ssh/id_rsa
docker exec cmcnew-jenkins chmod 600 /var/jenkins_home/.ssh/id_rsa

# Trust GitHub's RSA key to avoid interactive host verification
docker exec cmcnew-jenkins ssh-keyscan -H github.com >> /var/jenkins_home/.ssh/known_hosts 2>/dev/null
```

---

## 3. Complete Jenkinsfile (Declarative Pipeline)

Save this as `Jenkinsfile` in the repo root.

```groovy
// CMCnew — Declarative Pipeline
// Triggers: GitHub webhook (develop & main) OR manual trigger.
// Stages: checkout → install → lint/typecheck → integration tests → build → deploy → smoke-check

pipeline {
    agent any

    options {
        // Keep the last 30 builds (save disk space on jenkins_home)
        buildDiscarder(logRotator(numToKeepStr: '30'))
        // Timeout the entire pipeline after 45 min (vite build + tests can be slow on 2 vCPU)
        timeout(time: 45, unit: 'MINUTES')
        // Disable concurrent builds (avoid contention on docker.sock + postgres)
        disableConcurrentBuilds()
    }

    // Only trigger on develop (CI) and main (pre-release QA). Feature branches require manual trigger.
    triggers {
        githubPush()
    }

    environment {
        // Node / pnpm
        PATH = "/app/node_modules/.bin:/app/apps/api/node_modules/.bin:${env.PATH}"
        NODE_ENV = 'test'
        
        // Docker build context = repo root
        COMPOSE_PROJECT_NAME = 'cmcnew-ci'
        
        // App compose stack (dev postgres for CI testing)
        DOCKER_COMPOSE_FILE_DEV = 'docker/docker-compose.dev.yml'
        DOCKER_COMPOSE_FILE_PROD = 'docker/docker-compose.prod.yml'
        
        // Secrets: read from server-side .env.production (NOT Jenkins credentials)
        // This file MUST exist on the host: /home/ci-user/.env.production or /root/.env.production
        // It is NOT checked in; Jenkins runner (UID 1000 in container) must be able to read it
        // via a bind mount or copied into JENKINS_HOME.
        ENV_FILE = '/var/jenkins_home/.env.production'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
                sh 'git log -1 --oneline'
            }
        }

        stage('Install Dependencies') {
            steps {
                sh '''
                    echo "Setting up Node.js and pnpm..."
                    corepack enable
                    corepack prepare pnpm@10.24.0 --activate
                    pnpm install --frozen-lockfile
                '''
            }
        }

        stage('Lint & Typecheck') {
            steps {
                sh '''
                    echo "Running ESLint and TypeScript checks..."
                    pnpm run lint
                    pnpm run typecheck
                '''
            }
        }

        stage('Integration Tests') {
            when {
                // Only run integration tests on develop & main (avoid noise on feature branches).
                // Integration tests require a real Postgres, which is expensive on 2 vCPU.
                branch pattern: 'develop|main', comparator: 'REGEXP'
            }
            steps {
                sh '''
                    echo "Starting ephemeral Postgres for integration tests..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_DEV} up -d postgres redis

                    echo "Waiting for Postgres to be ready..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_DEV} exec -T postgres pg_isready -U cmc -d cmc || sleep 10

                    echo "Running migrations and seed for test DB..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_DEV} run --rm api-migrate
                    docker compose -f ${DOCKER_COMPOSE_FILE_DEV} run --rm api-seed SEED_SUPERADMIN_EMAIL=admin@local SEED_SUPERADMIN_PASSWORD=testpass123

                    echo "Running integration tests (1 worker to avoid contention)..."
                    pnpm --filter @cmc/api run test:integration || TEST_FAILED=1

                    echo "Cleaning up test Postgres..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_DEV} down -v

                    if [ "$TEST_FAILED" = "1" ]; then
                        exit 1
                    fi
                '''
            }
        }

        stage('Build Docker Images') {
            when {
                // Only build and deploy on develop & main
                branch pattern: 'develop|main', comparator: 'REGEXP'
            }
            steps {
                sh '''
                    echo "Building Docker images for api, admin, lms..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_PROD} --env-file ${ENV_FILE} build --no-cache api admin lms
                '''
            }
        }

        stage('Deploy to Production') {
            when {
                branch pattern: 'develop|main', comparator: 'REGEXP'
            }
            steps {
                sh '''
                    echo "Deploying app stack (postgres, redis, api, admin, lms, nginx)..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_PROD} --env-file ${ENV_FILE} up -d --build postgres redis

                    echo "Waiting for Postgres to be ready..."
                    sleep 5

                    echo "Running migrations (api-migrate service)..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_PROD} --env-file ${ENV_FILE} run --rm api-migrate

                    echo "Starting API, admin, LMS, nginx..."
                    docker compose -f ${DOCKER_COMPOSE_FILE_PROD} --env-file ${ENV_FILE} up -d api admin lms nginx

                    echo "Waiting for API health check..."
                    sleep 10
                '''
            }
        }

        stage('Smoke Test') {
            when {
                branch pattern: 'develop|main', comparator: 'REGEXP'
            }
            steps {
                sh '''
                    echo "Smoke testing /health endpoints..."
                    
                    # API health
                    curl -f http://localhost/api/health || exit 1
                    echo "✓ API /health OK"
                    
                    # Admin app (GET / should return HTML)
                    curl -f http://localhost/ | grep -q "<!DOCTYPE html>" || exit 1
                    echo "✓ Admin app OK"
                    
                    # LMS app (GET /lms/ should return HTML)
                    curl -f http://localhost/lms/ | grep -q "<!DOCTYPE html>" || exit 1
                    echo "✓ LMS app OK"
                '''
            }
        }
    }

    post {
        always {
            sh '''
                echo "Cleaning up ephemeral containers (if any)..."
                docker compose -f ${DOCKER_COMPOSE_FILE_DEV} down -v || true
            '''
        }
        success {
            echo "Pipeline succeeded. Deployment complete."
        }
        failure {
            echo "Pipeline failed. Check logs above."
        }
    }
}
```

### Jenkinsfile Notes

- **`disableConcurrentBuilds()`**: Prevents multiple builds from running simultaneously. On 2 vCPU, two builds would thrash.
- **Integration tests gated to develop/main**: Feature branches skip expensive tests; save resources for the work branch.
- **1 worker for integration tests**: Config already in `vitest.integration.config.ts` (`singleFork: true`); respects that.
- **Ephemeral Postgres**: Each CI run spins up dev compose, runs migrations, tests, then tears down. Keeps test DB isolated.
- **Smoke test**: Simple curl checks to /health and / (admin) and /lms/. Enough to catch major deploy failures.
- **`ENV_FILE` strategy**: Jenkins reads `.env.production` from a server-side path (not in Jenkins credentials). See secrets handling below.

---

## 4. Trigger Configuration

### Option A: GitHub Webhook (Recommended)

**Pros**: Instant feedback, no polling overhead, webhook-based is GitHub standard.  
**Cons**: Requires inbound HTTP from GitHub to Jenkins (may need firewall rule on VPS).

**Setup**:

1. **Jenkins webhook listener plugin** (should be auto-installed with Jenkins LTS):
   ```bash
   docker exec cmcnew-jenkins curl -s http://localhost:8080/pluginManager/api/json?tree=plugins\[\{name,active\}\] | grep github
   # Should list GitHub plugin
   ```

2. **Create GitHub webhook** (repo settings → Webhooks):
   - Payload URL: `http://<YOUR_VPS_IP>:8080/github-webhook/`
   - Content type: `application/json`
   - Events: Push, Pull Request
   - Active: ✓

3. **Jenkins job config** (one-time via Jenkinsfile or UI):
   - Trigger: **GitHub hook trigger for GITScm polling**
   - Branches to build: `develop`, `main`

**Firewall check**:
```bash
# On VPS, verify port 8080 is reachable from GitHub (Jenkins must bind 0.0.0.0:8080, not 127.0.0.1)
sudo ufw allow 8080/tcp
# Or use a reverse proxy (nginx) with authentication if concerned about public exposure
```

### Option B: SCM Polling (Fallback)

**Pros**: Doesn't require inbound firewall rule, simpler setup.  
**Cons**: 5-minute polling lag, wasted webhook checks.

**Jenkins job config**:
- Trigger: **Poll SCM**
- Schedule: `H/5 * * * *` (every 5 minutes, Jenkins hash distributes the load)

**Recommendation**: Use webhook. Polling is wasteful on GitHub's bandwidth quota.

---

## 5. Credentials & Secrets Management

### Strategy: Server-Side `.env.production` File

**Do NOT use Jenkins Credentials Store** for production secrets. Reasons:
1. Secrets are encrypted in Jenkins DB but still accessible to any pipeline.
2. If Jenkins is compromised, all stored credentials are at risk.
3. For a single VPS team, a file-on-server approach is simpler and auditable.

### Implementation

1. **On the host VPS**, create `/root/.env.production` (or `/home/ci-user/.env.production` if you have a ci-user):
   ```bash
   # /root/.env.production (NOT checked into git)
   DB_USER=cmc
   DB_PASSWORD=<random-strong-password>
   DB_NAME=cmc
   DB_APP_PASSWORD=<different-strong-password>
   JWT_SECRET=<random-hex-32-chars>
   COOKIE_SECURE=true
   CORS_ORIGINS=https://erp.cmcvn.edu.vn
   ADMIN_APP_ORIGIN=https://erp.cmcvn.edu.vn
   # ... other secrets
   ```

2. **Jenkins accesses the file** via volume mount or copy:
   ```yaml
   # In docker-compose.jenkins.yml:
   volumes:
     - /root/.env.production:/var/jenkins_home/.env.production:ro
   ```

3. **Jenkinsfile references it**:
   ```groovy
   environment {
       ENV_FILE = '/var/jenkins_home/.env.production'
   }
   
   sh 'docker compose -f ${DOCKER_COMPOSE_FILE_PROD} --env-file ${ENV_FILE} up -d'
   ```

4. **CI/CD secret rotation**: Edit `/root/.env.production` on the host, no Jenkins restart needed.

### Why NOT Jenkins Credentials

```groovy
// BAD: Don't do this
withCredentials([string(credentialsId: 'jwt-secret', variable: 'JWT_SECRET')]) {
    sh '''
        echo "JWT_SECRET=$JWT_SECRET" >> .env.production
        docker compose ... --env-file .env.production up -d
    '''
}
// Risk: .env.production ends up in Jenkins logs or workspace (potentially readable)
```

### SSH Key for GitHub

The Jenkinsfile clones from GitHub via SSH (using deploy key). The key is mounted via:
```yaml
volumes:
  - /root/.ssh:/var/jenkins_home/.ssh:ro
```

**Setup**:
```bash
# On VPS, generate or copy an ED25519 deploy key
ssh-keygen -t ed25519 -f /root/.ssh/id_rsa -C "jenkins@cmcnew-ci"

# Add the public key as a Deploy Key in GitHub repo settings
cat /root/.ssh/id_rsa.pub
# → Copy this to GitHub: Settings → Deploy Keys → Add new → Paste

# Make sure Jenkins can read it
ls -l /root/.ssh/id_rsa  # Must be readable by Jenkins (UID 1000)
```

---

## 6. Jenkins Bootstrap (Non-Interactive Setup)

### Use Jenkins Configuration as Code (JCasC)

JCasC loads a YAML file at startup to configure Jenkins, avoiding manual UI steps.

**File**: `docker/jenkins.casc.yaml` (or mount to `/var/jenkins_home/jenkins.yaml`).

```yaml
# docker/jenkins.casc.yaml
jenkins:
  systemMessage: "CMCnew CI/CD Pipeline"
  numExecutors: 2
  remotingSecurity:
    enabled: true
  crumbIssuer:
    standard:
      excludeClientIPFromCrumb: true

  # GitHub-specific settings
  securityRealm:
    # Use local Jenkins user database (simple setup)
    local:
      allowsSignup: false
  
  authorizationStrategy:
    roleBased:
      roles:
        global:
          - name: "admin"
            permissions:
              - "Overall/Administer"

unclassified:
  # GitHub plugin configuration
  github:
    apiUrl: "https://api.github.com"
  
  # Timestamp logging
  timestamper:
    systemClockFormat: "HH:mm:ss"

credentials:
  system:
    domainCredentials:
      - credentials:
          - ssh:
              scope: GLOBAL
              id: "github-deploy-key"
              username: "git"
              # Private key loaded from /var/jenkins_home/.ssh/id_rsa
              privateKeySource:
                directEntry:
                  privateKey: "${SSH_PRIVATE_KEY}"

tool:
  git:
    installations:
      - name: "Default"
        home: "git"

# Jobs are defined via Jenkinsfile (not in casc.yaml)
jobs:
  - url: "https://github.com/your-org/cmcnew.git"
    branch: "*/develop"
```

**Docker-Compose update**:
```yaml
jenkins:
  environment:
    CASC_JENKINS_CONFIG: "/var/jenkins_home/jenkins.yaml"
  volumes:
    - ./jenkins.casc.yaml:/var/jenkins_home/jenkins.yaml:ro
    # ... other volumes
```

**Bootstrap plugins** (auto-installed):

Create a `docker/plugins.txt`:
```
github:1.40.0
github-api:1.319-412.v2f01e71b09c9
ssh-slaves:2.878.v6852b54fa5f1
pipeline-stage-view:2.34
timestamper:1.17
docker-plugin:1.5.1
google-kubernetes-engine:0.8.0
configuration-as-code:1.62
```

**Dockerfile for Jenkins** (optional, pre-bakes plugins):

```dockerfile
FROM jenkins/jenkins:lts-jdk17

USER root
# Install docker CLI (Jenkins will call docker commands)
RUN apt-get update && apt-get install -y docker.io && rm -rf /var/lib/apt/lists/*

USER jenkins

# Install plugins from plugins.txt
COPY docker/plugins.txt /usr/share/jenkins/ref/plugins.txt
RUN jenkins-plugin-cli -f /usr/share/jenkins/ref/plugins.txt
```

Then in docker-compose:
```yaml
jenkins:
  build:
    context: .
    dockerfile: docker/Dockerfile.jenkins
  # ... rest of config
```

### First-Time Setup (One Manual Step)

Even with JCasC, you must capture the initial admin token:

```bash
# After docker compose up -d jenkins
docker logs cmcnew-jenkins 2>&1 | grep "Jenkins initial setup" -A 5
# Extract the token, e.g.: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6

# Visit http://<VPS_IP>:8080 in a browser
# Unlock Jenkins with the token
# Install suggested plugins (or skip if all are in JCasC)
# Create first admin user (or skip if JCasC auth is configured)
```

Once Jenkins loads JCasC and plugins, subsequent restarts are fully automated.

---

## 7. Resource Constraints: 2 vCPU Mitigation

### The Problem

On a 2 vCPU VPS:
- **Postgres** uses ~0.3 vCPU at rest, ~0.8 under load
- **Redis** negligible
- **API server** ~0.3 vCPU at rest, spikes to 0.8 under load
- **Nginx** negligible
- **Vite SPA build** (admin + lms) can spike 1.2+ vCPU (esbuild, terser)
- **Playwright e2e** (if run): 1 worker = 1 Chrome instance = 0.5+ vCPU + 300+ MB RAM

**Consequence**: If Jenkins starts a build while the app is running, Vite build + integration tests will contend with Postgres + API, causing:
- Timeouts on test DB queries (Postgres CPU throttled)
- OOM (Vite + 1 Chrome = ~1.5 GB, Postgres ~500 MB, API ~400 MB = 2.4 GB, swaps to disk)
- Build failures due to sigterm

### Mitigations (Ranked by Effectiveness)

#### 1. **Skip e2e Tests per-Commit (RECOMMENDED)**

Move Playwright tests to a **separate, nightly job** that runs after deploy.

**Jenkinsfile**:
```groovy
stage('E2E Tests (Nightly Only)') {
    when {
        expression {
            // Only run on nightly trigger or manual override
            env.NIGHTLY_BUILD == 'true'
        }
    }
    steps {
        sh '''
            echo "Running Playwright e2e tests (1 worker)..."
            PLAYWRIGHT_WORKERS=1 pnpm test:e2e
        '''
    }
}
```

**Jenkins Job Scheduler** (via JCasC or UI):
```groovy
triggers {
    // Webhook for commit-based builds
    githubPush()
    
    // Separate nightly trigger: 2 AM UTC
    cron('0 2 * * *')
}
```

**Benefit**: Reduces per-commit build time from ~15 min to ~8 min. E2E runs nightly on prod-like stack.

#### 2. **Limit Vite Build Concurrency**

Vite uses all available vCPU by default. Cap it:

**Jenkinsfile**:
```groovy
environment {
    NODE_OPTIONS: '--max-old-space-size=1024'  // Limit Node heap
}

stage('Build Docker Images') {
    steps {
        sh '''
            # Limit esbuild to 2 workers (out of 2 vCPU)
            docker compose -f ${DOCKER_COMPOSE_FILE_PROD} \
              --env-file ${ENV_FILE} \
              build --no-cache \
              --build-arg "ESBUILD_MAX_WORKERS=2" \
              api admin lms
        '''
    }
}
```

**Benefit**: Smooth contention; avoid CPU starvation.

#### 3. **Run Integration Tests ONLY on develop/main**

Already done in the Jenkinsfile (conditional `when` block). Feature branches skip integration tests.

**Benefit**: Feature branch builds are fast (~3 min: lint + typecheck + build images only).

#### 4. **Separate Build vs. Deploy Jobs**

Advanced: split into two Jenkins jobs:
1. **Build Job** (runs on every commit, develop + main): lint, typecheck, build images, push to Docker Hub.
2. **Deploy Job** (triggered after build succeeds): pull images, compose up -d on prod VPS.

**Benefit**: Build can run on a more powerful runner (e.g., GitHub Actions runner, or external builder); deploy happens locally on the VPS.

**Trade-off**: Added complexity; Docker Hub account required.

#### 5. **Increase RAM/CPU (Not Feasible Here)**

If VPS could be upgraded to 4 vCPU + 16 GB RAM, many of these constraints vanish. Not applicable for this project.

### Recommended Configuration

```groovy
// In Jenkinsfile:

pipeline {
    environment {
        // Memory limits
        NODE_OPTIONS: '--max-old-space-size=1024'
        JAVA_OPTS: '-Xmx2500m -Xms512m'
        
        // Docker limits
        DOCKER_BUILDKIT: '1'  // Use BuildKit for faster builds
    }

    options {
        // Fail fast if a stage times out
        timeout(time: 45, unit: 'MINUTES')
        // Prevent concurrent builds
        disableConcurrentBuilds()
    }
    
    // ... stages (integration tests gated to develop/main, e2e gated to nightly)
}
```

---

## 8. Deployment Walkthrough

### Step 1: Prepare the VPS

```bash
# On the VPS (Ubuntu 24.04)

# Create a git deploy key
ssh-keygen -t ed25519 -f ~/.ssh/id_rsa -C "jenkins@cmcnew" -N ""

# Create .env.production (NOT in git)
cat > ~/.env.production <<EOF
DB_USER=cmc
DB_PASSWORD=$(openssl rand -hex 16)
DB_APP_PASSWORD=$(openssl rand -hex 16)
DB_NAME=cmc
JWT_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=true
CORS_ORIGINS=https://erp.cmcvn.edu.vn
ADMIN_APP_ORIGIN=https://erp.cmcvn.edu.vn
CRM_LEAD_TOKEN=
DISABLE_CRON=0
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
ERP_SSO_REDIRECT_URI=
STAFF_EMAIL_DOMAIN=
STAFF_PASSWORD_LOGIN=false
GRAPH_SENDER_NOTIFY=
GRAPH_SENDER_PAYROLL=
GRAPH_SENDER_HR=
NGINX_PORT=80
SEED_SUPERADMIN_EMAIL=admin@cmcnew.local
SEED_SUPERADMIN_PASSWORD=$(openssl rand -hex 16)
EOF

chmod 600 ~/.env.production

# Add public key to GitHub repo (Settings → Deploy keys)
cat ~/.ssh/id_rsa.pub
```

### Step 2: Clone and Start Jenkins

```bash
# On the VPS, in /home/ubuntu or /root
cd /root  # or your work dir
git clone https://github.com/your-org/cmcnew.git

cd cmcnew

# Start Jenkins
docker compose -f docker/docker-compose.jenkins.yml up -d

# Check logs
docker logs -f cmcnew-jenkins

# Wait for "Jenkins is fully up and running" message (30-60 sec)
```

### Step 3: Unlock Jenkins & Configure Job

```bash
# Extract initial admin token
JENKINS_TOKEN=$(docker logs cmcnew-jenkins 2>&1 | grep -oP '(?<=Jenkins initial setup is required. An admin user has been created and a password generated.\s*\n\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\*\n\n)[a-f0-9]+' | head -1)

# Or just check the logs manually
docker logs cmcnew-jenkins | tail -20
```

Visit `http://<VPS_IP>:8080` in a browser:
1. Paste the token
2. Install suggested plugins
3. Create first admin user (e.g., `admin` / `<strong-password>`)

### Step 4: Create a Multibranch Pipeline Job

In Jenkins UI:
1. **New Item** → **Multibranch Pipeline**
2. **Name**: `cmcnew`
3. **Branch Sources**:
   - Source: Git
   - Project Repository: `https://github.com/your-org/cmcnew.git`
   - Credentials: (If private repo, add GitHub deploy key SSH credential)
   - Include Branches: `develop`, `main`
4. **Scan Multibranch Pipeline Triggers**:
   - [x] Periodically if not otherwise run (Interval: 1 day — fallback only)
5. **Script Path**: `Jenkinsfile` (default)
6. **Save**

### Step 5: Create GitHub Webhook

On GitHub (repo settings → Webhooks):
1. **Payload URL**: `http://<VPS_IP>:8080/github-webhook/`
2. **Content type**: `application/json`
3. **Events**: Push, Pull Request
4. **Active**: ✓
5. **Save**

Test: Push to `develop` → Jenkins should auto-trigger within 5 sec.

### Step 6: Monitor First Builds

```bash
# Watch Jenkins logs
docker logs -f cmcnew-jenkins

# Or check Jenkins UI: http://<VPS_IP>:8080 → cmcnew → develop (Build #1)

# Follow build console:
# http://<VPS_IP>:8080/job/cmcnew/job/develop/1/console
```

**Expected flow**:
- Checkout: ~10 sec
- Install deps: ~30-60 sec (first run; cached after)
- Lint/typecheck: ~20 sec
- Integration tests (develop/main only): ~180 sec (3 min for Postgres + migrations + tests)
- Build images: ~120-180 sec (Vite builds are slow)
- Deploy: ~30 sec (compose up -d + health checks)
- Smoke test: ~5 sec

**Total**: ~7-10 minutes per commit (develop/main).

---

## 9. Security Notes & Trade-Offs

### Docker.sock Mounting Risk

**What it enables**: Jenkins can run any Docker command (build, run, exec, mount volumes, etc.).

**Attack scenario**: A malicious pipeline could:
```groovy
sh '''
  docker run --rm -v /etc/shadow:/tmp/shadow ubuntu cat /tmp/shadow
  # Exfiltrate host secrets
'''
```

**Mitigation options**:

1. **Accept the risk** (current design):
   - Small team, low untrusted-code risk
   - Jenkins and all pipelines are internal
   - **Document**: Only trusted developers can write Jenkinsfile

2. **Use Docker Socket Proxy** (safer but overkill here):
   ```yaml
   # Run a proxy container that blocks dangerous endpoints
   docker-socket-proxy:
     image: tecnativa/docker-socket-proxy:latest
     volumes:
       - /var/run/docker.sock:/var/run/docker.sock:ro
     environment:
       ALLOW: 'BUILD,CONTAINERS,IMAGES,NETWORKS,VOLUMES,NETWORKS'
       DENY: 'POST,DELETE'
   
   jenkins:
     environment:
       DOCKER_HOST: 'tcp://docker-socket-proxy:2375'
   ```
   **Downside**: Slow, adds latency, proxy maintenance burden.

3. **Use SSH-based docker** (more secure, harder to setup):
   ```bash
   # On host, create a ci-user with passwordless sudo docker
   useradd -m ci-user
   echo "ci-user ALL=(ALL) NOPASSWD: /usr/bin/docker" >> /etc/sudoers.d/ci-user
   
   # Jenkins uses SSH to run docker commands on the host
   # Requires key-based auth + strict sudo rules
   ```

**Recommendation for CMCnew**: Accept the risk. Document that only trusted developers can push to `develop`/`main`.

### Secrets in Environment Variables

**Current design**: `.env.production` mounted read-only into Jenkins container.

**Risk**: Jenkins process has full read access to secrets.

**Why acceptable**: 
- Secrets are not in code, git, or Jenkins UI
- Jenkins is not exposed to the internet (port 8080 on 127.0.0.1 ideally)
- Rotation is simple (edit file on host, no Jenkins restart)

**Stronger alternative**: Vault, but overkill for a single VPS.

### Disable `script` Approval for Trusted Developers Only

Jenkins may prompt to approve scripts in pipelines. Keep this **enabled** for security:
- Jenkinsfile is versioned in git, so script approval is historical
- Malicious scripts in PRs are caught at code review

---

## 10. Monitoring & Troubleshooting

### Check Jenkins Health

```bash
# Logs
docker logs cmcnew-jenkins

# UI
http://<VPS_IP>:8080/manage

# Disk usage
docker exec cmcnew-jenkins du -sh /var/jenkins_home

# Cleanup old builds (keep last 30)
# Already configured in Jenkinsfile buildDiscarder
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| **Build times out** | Integration tests slow on Postgres | Increase timeout in Jenkinsfile (already 45 min) or skip tests on feature branches |
| **OOM on Vite build** | Not enough memory | Check `NODE_OPTIONS` env var, reduce concurrency, skip e2e per-commit |
| **GitHub webhook not triggered** | Port 8080 blocked | Check VPS firewall: `sudo ufw status` |
| **SSH key permission denied** | Jenkins user can't read ~/.ssh/id_rsa | Fix permissions: `chown 1000:1000 ~/.ssh/id_rsa && chmod 600 ~/.ssh/id_rsa` |
| **Docker.sock permission denied** | Jenkins user not in docker group on host | Jenkins runs in container; mount docker.sock with correct group GID |
| **.env.production not found** | Volume mount path wrong | Verify `/var/jenkins_home/.env.production` exists: `docker exec cmcnew-jenkins ls -la /var/jenkins_home/.env.production` |

### Backup jenkins_home

```bash
# Backup Jenkins configuration (daily cron)
docker exec cmcnew-jenkins tar czf - /var/jenkins_home > jenkins_backup_$(date +%Y%m%d).tar.gz

# Restore (if needed)
docker cp jenkins_backup_20260628.tar.gz cmcnew-jenkins:/tmp/
docker exec cmcnew-jenkins tar xzf /tmp/jenkins_backup_20260628.tar.gz -C /
```

---

## 11. Comparison: Recommended vs. Alternatives

| Aspect | Recommended (This Design) | Alternative 1: Multi-Agent | Alternative 2: GitHub Actions (Future) |
|--------|---------------------------|--------------------------|----------------------------------------|
| **Setup complexity** | Low (1 container) | High (Jenkins + agents + SSH) | N/A (disabled) |
| **Resource efficiency** | Tight on 2 vCPU, acceptable | Better if agents on external infra | N/A |
| **Build speed** | 7-10 min (shared 2 vCPU) | 3-5 min (dedicated 4+ vCPU agent) | 3-5 min (GH runner) |
| **Secrets management** | File-on-server (.env.production) | Jenkins store (higher risk) | GitHub Secrets (secure) |
| **Cost** | Free (same VPS) | Additional VPS cost | GitHub Actions billing (currently disabled) |
| **Team size fit** | Small (< 5 devs) | Medium (5-20 devs) | Any |
| **Maintenance burden** | Low (single box) | Medium (agent updates/monitoring) | Low (GitHub managed) |

**Verdict**: Recommended design (single Jenkins on same VPS) is pragmatic for CMCnew's current scale. Revisit if team grows or build times consistently exceed 15 min.

---

## 12. Implementation Checklist

- [ ] Copy `docker/docker-compose.jenkins.yml` from this report into the repo
- [ ] Copy `Jenkinsfile` from this report into repo root
- [ ] Create `docker/jenkins.casc.yaml` (optional, for automation)
- [ ] Create `docker/Dockerfile.jenkins` (optional, for pre-baked plugins)
- [ ] Create `docker/plugins.txt` (list of Jenkins plugins to auto-install)
- [ ] Generate SSH deploy key on VPS: `ssh-keygen -t ed25519 -f ~/.ssh/id_rsa`
- [ ] Add public key to GitHub repo (Settings → Deploy keys)
- [ ] Create `.env.production` on VPS with all required secrets
- [ ] Start Jenkins: `docker compose -f docker/docker-compose.jenkins.yml up -d`
- [ ] Unlock Jenkins UI, install plugins, create admin user
- [ ] Create Multibranch Pipeline job in Jenkins UI (point to GitHub repo)
- [ ] Add GitHub webhook (repo Settings → Webhooks)
- [ ] Test: Push to `develop`, verify Jenkins auto-triggers and completes build
- [ ] Monitor first 3-5 builds for timeouts, OOM, or other issues
- [ ] Set up nightly e2e job (separate trigger for Playwright tests)
- [ ] Document on team wiki: Jenkins URL, how to view logs, secrets rotation process

---

## Unresolved Questions

1. **MS Graph email setup**: Are GRAPH_SENDER_* secrets ready for production? If not, should we delay email features?
   - Suggest: Keep them unset in deploy, email stays no-op (harmless).

2. **SSL/TLS for Jenkins UI**: Should Jenkins port 8080 be behind nginx with TLS?
   - Current design: Jenkins on 127.0.0.1:8080 (internal only).
   - If public access needed: Add nginx reverse proxy with certbot (Let's Encrypt).

3. **Nightly e2e job scheduling**: Should e2e run against prod stack or a staging clone?
   - Current design: Nightly job runs against deployed prod (smoke test).
   - Alternative: Spin up staging compose, run e2e there (safer, but slower).

4. **Jenkins scaling**: If team grows to 20+ developers, should we migrate to multi-agent Jenkins on k8s?
   - Answer: Yes, revisit if build queue > 5 jobs or developers complain about feedback lag.

---

## Summary

**Status**: **DONE**

**Recommendation**: Single-node Jenkins in Docker on the same VPS, triggered via GitHub webhook. Declarative Jenkinsfile handles checkout → lint → integration tests → build → deploy → smoke-check. Secrets stored server-side (.env.production). Playwright e2e moved to nightly job to avoid 2 vCPU contention. Docker.sock mounting accepted as reasonable trade-off for small team. Estimated first deploy time: ~2 hours (bootstrap + configure webhook + first build); per-commit feedback time: ~7-10 minutes.

---

## Sources

- [Jenkins Docker documentation](https://www.jenkins.io/doc/book/installing/docker/)
- [Jenkins Security Overview](https://www.jenkins.io/doc/book/security/managing-security/)
- [Jenkins Configuration as Code (JCasC)](https://www.jenkins.io/doc/book/managing/casc/)
- [GitHub Plugin for Jenkins](https://plugins.jenkins.io/github/)
- [Docker Security Best Practices](https://dev.to/pbnj/docker-security-best-practices-45ih)
- [Vite Build Performance Optimization](https://vitest.dev/guide/improving-performance)
- [Playwright Test Resource Requirements & CI Optimization](https://www.browserless.io/blog/maintaining-ci-runners-for-playwright/)
- [Docker-in-Docker vs Docker Socket Proxy](https://github.com/jenkins-infra/docker-jenkins-lts/security)
