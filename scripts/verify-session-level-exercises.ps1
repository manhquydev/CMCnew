param(
  [switch]$SkipMigrate
)

$ErrorActionPreference = 'Stop'

function Run-Step {
  param(
    [string]$Name,
    [scriptblock]$Command
  )
  Write-Host "==> $Name"
  & $Command
}

Run-Step "Prisma generate" {
  pnpm db:generate
}

if (-not $SkipMigrate) {
  Run-Step "Prisma migrate deploy" {
    pnpm --filter @cmc/api exec node -e "require('dotenv').config({path:'../../.env'}); const cp=require('child_process'); const r=cp.spawnSync('pnpm',['db:migrate'],{stdio:'inherit',shell:true,env:process.env,cwd:'../..'}); process.exit(r.status ?? 1);"
  }
}

Run-Step "DB typecheck" {
  pnpm --filter @cmc/db typecheck
}

Run-Step "API typecheck" {
  pnpm --filter @cmc/api typecheck
}

Run-Step "Admin typecheck" {
  pnpm --filter @cmc/admin typecheck
}

Run-Step "LMS typecheck" {
  pnpm --filter @cmc/lms typecheck
}

Run-Step "Focused integration tests" {
  pnpm --filter @cmc/api exec vitest run --config vitest.integration.config.ts `
    test/curriculum-seed.int.test.ts `
    test/curriculum-read.int.test.ts `
    test/schedule-generate-curriculum-map.int.test.ts `
    test/session-level-exercises.int.test.ts `
    test/exercise-open-notify.int.test.ts `
    test/lms-full-lifecycle-e2e.int.test.ts `
    test/lms-security-invariants.int.test.ts `
    test/schedule-makeup-session.int.test.ts `
    test/submission-open-gate-forbidden-midedit.int.test.ts `
    test/submission-version-conflict.int.test.ts `
    test/assessment-final-grade-publish.int.test.ts `
    test/onboarding-to-lms-timeline.int.test.ts
}

Write-Host "Session-level exercise verification passed."
