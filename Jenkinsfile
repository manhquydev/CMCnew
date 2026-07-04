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
      steps {
        checkout scm
        script {
          catchError(buildResult: null, stageResult: 'UNSTABLE') {
            publishChecks name: 'CMCnew CI', title: 'Build in progress', summary: 'Jenkins build running', status: 'IN_PROGRESS'
          }
        }
      }
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
      when { anyOf { branch 'main'; branch 'develop'; changeRequest() } }   // gate PRs + both deploy branches — a red integration test must block deploy/merge
      steps {
        sh 'bash scripts/ci-integration-tests.sh'   // spins an ephemeral Postgres, runs vitest, tears down
      }
    }

    stage('Build + Deploy (prod)') {
      when { branch 'main' }   // deploy the live prod stack only from main
      steps {
        sh '''
          # Surface the deployed revision at GET /health so a deploy is externally verifiable.
          export APP_COMMIT="${GIT_COMMIT:-unknown}"
          export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          # Ensure an origin cert exists (self-signed for CF Full) so nginx can start —
          # self-heals a fresh volume, fails loud on a corrupt/invalid one.
          bash scripts/ensure-origin-cert.sh
          # The prod nginx joins the shared cmcnew-edge network (declared `external` in the compose
          # file) to reach the dev app tier. Create it before `up` or compose aborts; idempotent,
          # and `|| true` because this shell runs with -e and the network persists between deploys.
          docker network create cmcnew-edge 2>/dev/null || true
          # Refresh the nginx config at the stable host path the compose mount references
          # (the deploy runs from the ephemeral Jenkins workspace, so sync to /root/cmcnew).
          docker run --rm -v /root/cmcnew/docker:/dest -v "$WORKSPACE/docker":/src:ro alpine \
            cp /src/nginx-prod.conf /dest/nginx-prod.conf
          $COMPOSE up -d postgres redis
          # Bound concurrent image-build memory (api/admin/lms can otherwise build in parallel
          # while old containers still serve traffic — see docs/decisions/0029-*).
          export COMPOSE_PARALLEL_LIMIT=1
          # --build here is required: without it, `run` reuses whatever api image last existed
          # locally (stale, pre-dating this commit's migration files), so a schema change added in
          # this same commit can silently apply against an OLD Prisma client that has never seen it
          # — "No pending migrations to apply" while the migration sits unapplied on prod. The api
          # image is rebuilt again below by `up -d --build`; Docker layer caching makes that second
          # build cheap once this first one has run.
          $COMPOSE --profile migrate run --rm --build api-migrate
          $COMPOSE up -d --build
          # nginx resolves the admin/lms/api upstream hostnames once at startup. Recreated app
          # containers get new IPs, so restart nginx to re-resolve — otherwise it can proxy a
          # vhost to the wrong (stale-IP) container and the apps appear swapped.
          $COMPOSE restart nginx
        '''
      }
    }

    stage('Smoke (prod)') {
      when { branch 'main' }   // smoke-test the deploy that only main performs
      steps {
        sh '''
          # api health from inside the compose network (proves the new container serves)
          $COMPOSE exec -T api wget -qO- http://localhost:4000/health
          # public end-to-end reachability (Jenkins runs in its own container, so hit the
          # real domains via egress→Cloudflare→origin rather than 127.0.0.1, which is not nginx here)
          RESP="$(curl -fsS https://erp.cmcvn.edu.vn/api/health)"; echo "$RESP" | grep -q '"ok":true'
          curl -fsS -o /dev/null https://hoc.cmcvn.edu.vn/
          echo "branch=main url=https://erp.cmcvn.edu.vn commit=${GIT_COMMIT} health=$RESP smoke OK"
        '''
      }
    }

    // ── DEV branch: deploy the cmcnew-dev stack (deverp/devlms), never touch prod ──
    stage('Build + Deploy (dev)') {
      when { branch 'develop' }   // deploy the dev stack only from develop
      steps {
        sh '''
          # Surface the deployed revision at GET /health so a dev deploy is externally verifiable.
          export APP_COMMIT="${GIT_COMMIT:-unknown}"
          export APP_BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
          export COMPOSE_PARALLEL_LIMIT=1   # 2 vCPU box: serialize image builds so dev+prod+jenkins don't OOM
          # The dev app tier joins the shared cmcnew-edge network; create it before `up` (external).
          docker network create cmcnew-edge 2>/dev/null || true
          # Explicit branch-to-environment mapping — dev project, dev env file, dev compose. No prod vars.
          DEV="docker compose -f docker/docker-compose.dev.tls.yml --env-file /secrets/.env.dev"
          echo "deploying: project=cmcnew-dev env=/secrets/.env.dev commit=$APP_COMMIT"
          $DEV up -d dev-postgres dev-redis
          for i in $(seq 1 30); do
            [ "$($DEV ps -q dev-postgres | xargs -r docker inspect -f '{{.State.Health.Status}}' 2>/dev/null)" = healthy ] && break
            sleep 2
          done
          # --build for the same stale-image reason as prod (see the prod deploy stage note).
          $DEV --profile migrate run --rm --build dev-api-migrate
          # Align the cmc_app RLS role password with the runtime secret (idempotent; required on a
          # fresh dev DB where the RLS migration creates cmc_app with a default password).
          DBU="$(grep -m1 '^DB_USER=' /secrets/.env.dev | cut -d= -f2-)"; DBU="${DBU:-cmc}"
          DBN="$(grep -m1 '^DB_NAME=' /secrets/.env.dev | cut -d= -f2-)"; DBN="${DBN:-cmc}"
          DBP="$(grep -m1 '^DB_APP_PASSWORD=' /secrets/.env.dev | cut -d= -f2-)"
          $DEV exec -T dev-postgres psql -U "$DBU" -d "$DBN" -c "ALTER ROLE cmc_app PASSWORD '$DBP';"
          $DEV up -d --build dev-api dev-admin dev-lms
          # The shared prod nginx caches the dev upstream IPs; recreated dev containers get new IPs,
          # so reload (NOT restart — zero-downtime, and it must not disrupt prod) to re-resolve them.
          docker exec cmcnew-prod-nginx-1 nginx -s reload
        '''
      }
    }

    stage('Smoke (dev)') {
      when { branch 'develop' }   // smoke-test the deploy that only develop performs
      steps {
        sh '''
          DEV="docker compose -f docker/docker-compose.dev.tls.yml --env-file /secrets/.env.dev"
          $DEV exec -T dev-api wget -qO- http://localhost:4000/health
          RESP="$(curl -fsS https://deverp.cmcvn.edu.vn/api/health)"; echo "$RESP" | grep -q '"ok":true'
          curl -fsS -o /dev/null https://devlms.cmcvn.edu.vn/
          echo "branch=develop url=https://deverp.cmcvn.edu.vn commit=${GIT_COMMIT} health=$RESP smoke OK"
        '''
      }
    }
  }
  post {
    success {
      catchError(buildResult: null, stageResult: 'UNSTABLE') {
        publishChecks name: 'CMCnew CI', title: 'Build passed', summary: 'Lint/typecheck/integration/deploy succeeded', conclusion: 'SUCCESS'
      }
    }
    failure {
      echo 'Pipeline FAILED — app stack left at previous state (compose did not switch traffic on a failed build).'
      catchError(buildResult: null, stageResult: 'UNSTABLE') {
        publishChecks name: 'CMCnew CI', title: 'Build failed', summary: 'See Jenkins console output', conclusion: 'FAILURE'
      }
    }
    unstable {
      catchError(buildResult: null, stageResult: 'UNSTABLE') {
        publishChecks name: 'CMCnew CI', title: 'Build unstable', summary: 'See Jenkins console output', conclusion: 'NEUTRAL'
      }
    }
    always  { cleanWs() }
  }
}
