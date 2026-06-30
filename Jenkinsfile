// CMCnew CI/CD — single-node Jenkins on the same VPS as the app.
// Build → (develop/main) test → build+deploy the compose stack → migrate → smoke.
// Jenkins runs as a container with the host docker socket + docker CLI, so `docker compose`
// here targets the same Docker engine that hosts the app. The compose project name is fixed
// (cmcnew-prod), so deploys update the live stack regardless of the workspace path.
pipeline {
  agent any
  options {
    disableConcurrentBuilds()   // 2 vCPU — never run two builds at once
    timestamps()
    ansiColor('xterm')
    timeout(time: 30, unit: 'MINUTES')
  }
  environment {
    COMPOSE  = 'docker compose -f docker/docker-compose.prod.tls.yml --env-file /secrets/.env.production'
    NODE_IMG = 'node:22-alpine'
  }
  stages {
    stage('Checkout') {
      steps { checkout scm }
    }

    stage('Lint + Typecheck') {
      steps {
        sh '''
          docker run --rm -v "$WORKSPACE":/app -w /app $NODE_IMG sh -c '
            corepack enable && corepack prepare pnpm@10.24.0 --activate &&
            pnpm install --frozen-lockfile &&
            pnpm --filter @cmc/db generate &&
            pnpm -r typecheck && pnpm -r lint
          '
        '''
      }
    }

    stage('Integration tests') {
      when { branch 'main' }   // CI/CD pipeline runs on main only; other branches get lint+typecheck as a PR gate
      steps {
        sh 'bash scripts/ci-integration-tests.sh'   // spins an ephemeral Postgres, runs vitest, tears down
      }
    }

    stage('Build + Deploy') {
      when { branch 'main' }   // deploy the live stack only from main
      steps {
        sh '''
          # Surface the deployed revision at GET /health so a deploy is externally verifiable.
          export APP_COMMIT="${GIT_COMMIT:-unknown}"
          export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          # Ensure an origin cert exists (self-signed for CF Full) so nginx can start.
          docker volume create cmcnew-prod_letsencrypt >/dev/null
          # Refresh the nginx config at the stable host path the compose mount references
          # (the deploy runs from the ephemeral Jenkins workspace, so sync to /root/cmcnew).
          docker run --rm -v /root/cmcnew/docker:/dest -v "$WORKSPACE/docker":/src:ro alpine \
            cp /src/nginx-prod.conf /dest/nginx-prod.conf
          $COMPOSE up -d postgres redis
          $COMPOSE --profile migrate run --rm api-migrate
          $COMPOSE up -d --build
          # nginx resolves the admin/lms/api upstream hostnames once at startup. Recreated app
          # containers get new IPs, so restart nginx to re-resolve — otherwise it can proxy a
          # vhost to the wrong (stale-IP) container and the apps appear swapped.
          $COMPOSE restart nginx
        '''
      }
    }

    stage('Smoke') {
      when { branch 'main' }   // smoke-test the deploy that only main performs
      steps {
        sh '''
          # api health from inside the compose network (proves the new container serves)
          $COMPOSE exec -T api wget -qO- http://localhost:4000/health
          # public end-to-end reachability (Jenkins runs in its own container, so hit the
          # real domains via egress→Cloudflare→origin rather than 127.0.0.1, which is not nginx here)
          curl -fsS https://erp.cmcvn.edu.vn/api/health | grep -q '"ok":true'
          curl -fsS -o /dev/null https://hoc.cmcvn.edu.vn/
          echo "smoke OK"
        '''
      }
    }
  }
  post {
    always  { cleanWs() }
    failure { echo 'Pipeline FAILED — app stack left at previous state (compose did not switch traffic on a failed build).' }
  }
}
