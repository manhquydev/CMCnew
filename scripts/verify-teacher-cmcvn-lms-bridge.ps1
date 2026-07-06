$ErrorActionPreference = 'Stop'

$container = 'cmc-teacher-bridge-verify-pg'
$ports = @(4000, 5173, 5175)
$oldEnv = @{}
$envNames = @(
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_SECRET',
  'STAFF_PASSWORD_LOGIN',
  'COOKIE_SECURE',
  'SEED_SUPERADMIN_PASSWORD',
  'TEST_LMS_STUDENT_PASSWORD',
  'CI'
)

foreach ($name in $envNames) {
  $oldEnv[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

function Restore-VerifyEnv {
  foreach ($name in $envNames) {
    if ($null -eq $oldEnv[$name]) {
      Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($name, $oldEnv[$name], 'Process')
    }
  }
}

function Stop-VerifyContainer {
  $existing = docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $container }
  if ($existing) {
    docker rm -f $container | Out-Null
  }
}

function Invoke-VerifyCommand {
  param(
    [Parameter(Mandatory = $true)]
    [string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$Arguments
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

try {
  $owners = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($pidValue in $owners) {
    if ($pidValue -and $pidValue -ne $PID) {
      Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue
    }
  }

  Stop-VerifyContainer
  docker run --name $container `
    -e POSTGRES_PASSWORD=postgres `
    -e POSTGRES_USER=postgres `
    -e POSTGRES_DB=cmc `
    -p 55432:5432 `
    -d postgres:16-alpine | Out-Null

  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    docker exec $container pg_isready -U postgres -d cmc | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Postgres did not become ready'
  }

  $env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/cmc?schema=public&connection_limit=5'
  $env:DIRECT_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/cmc?schema=public'
  $env:JWT_SECRET = 'test-secret-for-teacher-bridge-verify-32-chars-minimum'
  $env:STAFF_PASSWORD_LOGIN = 'true'
  $env:COOKIE_SECURE = 'false'
  $env:SEED_SUPERADMIN_PASSWORD = 'ChangeMe!123'
  $env:TEST_LMS_STUDENT_PASSWORD = 'ChangeMe!123'
  $env:CI = '1'

  Invoke-VerifyCommand pnpm --filter @cmc/api typecheck
  Invoke-VerifyCommand pnpm --filter @cmc/ui typecheck
  Invoke-VerifyCommand pnpm --filter @cmc/db generate
  Invoke-VerifyCommand pnpm --filter @cmc/db migrate
  Invoke-VerifyCommand pnpm --filter @cmc/db seed

  Invoke-VerifyCommand pnpm --filter @cmc/api test `
    test/attendance-report-markall.int.test.ts `
    test/schedule-my-sessions.int.test.ts `
    test/teacher-bridge-staff-setup.int.test.ts `
    test/batch-code-atomicity.int.test.ts `
    test/class-batch-create-multislot.int.test.ts `
    test/upload-exercise-pdf-rbac.int.test.ts `
    test/student-provisioning-approve.int.test.ts `
    test/role-flows-commission-chain.int.test.ts `
    test/lms-full-lifecycle-e2e.int.test.ts `
    test/session-evidence-publish-to-lms.int.test.ts `
    test/submission-version-conflict.int.test.ts `
    test/submission-guardian-layer.int.test.ts `
    test/lms-security-invariants.int.test.ts

  Invoke-VerifyCommand pnpm --filter @cmc/e2e exec playwright test `
    tests/teacher-nav-consolidation.spec.ts `
    tests/lms-smoke.spec.ts `
    tests/session-evidence-publish.spec.ts `
    tests/lms-autosave-and-parent-readonly.spec.ts `
    --workers=1

  Invoke-VerifyCommand powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-teacher-cmcvn-live-smoke.ps1
} finally {
  Stop-VerifyContainer
  Restore-VerifyEnv
}
