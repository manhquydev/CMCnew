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
            pnpm -r typecheck && pnpm -r lint
          '
        '''
      }
    }

    stage('Integration tests') {
      when { anyOf { branch 'develop'; branch 'main' } }
      steps {
        sh 'bash scripts/ci-integration-tests.sh'   // spins an ephemeral Postgres, runs vitest, tears down
      }
    }

    stage('Build + Deploy') {
      when { anyOf { branch 'develop'; branch 'main' } }
      steps {
        sh '''
          # Ensure an origin cert exists (self-signed for CF Full) so nginx can start.
          docker volume create cmcnew-prod_letsencrypt >/dev/null
          $COMPOSE up -d postgres redis
          $COMPOSE --profile migrate run --rm api-migrate
          $COMPOSE up -d --build
        '''
      }
    }

    stage('Smoke') {
      when { anyOf { branch 'develop'; branch 'main' } }
      steps {
        sh '''
          # api health from inside the compose network
          $COMPOSE exec -T api wget -qO- http://localhost:4000/health
          # origin reachability for both vhosts (through nginx, self-signed → -k)
          curl -fsSk -H 'Host: erp.cmcvn.edu.vn' https://127.0.0.1/ -o /dev/null
          curl -fsSk -H 'Host: hoc.cmcvn.edu.vn' https://127.0.0.1/ -o /dev/null
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
