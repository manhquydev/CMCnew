$ErrorActionPreference = 'Stop'

function Run-Step {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,
    [Parameter(Mandatory = $true)]
    [string[]] $Command
  )

  Write-Host ""
  Write-Host "==> $Name"
  $exe = $Command[0]
  $args = @()
  if ($Command.Length -gt 1) {
    $args = $Command[1..($Command.Length - 1)]
  }
  & $exe @args
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed: $Name (exit $LASTEXITCODE)"
  }
}

function Save-Env {
  param([Parameter(Mandatory = $true)][string[]] $Names)

  $saved = @{}
  foreach ($name in $Names) {
    $saved[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
  }
  return $saved
}

function Restore-Env {
  param(
    [Parameter(Mandatory = $true)][string[]] $Names,
    [Parameter(Mandatory = $true)] $Saved
  )

  foreach ($name in $Names) {
    if ($null -eq $Saved[$name]) {
      Remove-Item "Env:\$name" -ErrorAction SilentlyContinue
    } else {
      [Environment]::SetEnvironmentVariable($name, $Saved[$name], 'Process')
    }
  }
}

function Remove-VerifyDb {
  param([Parameter(Mandatory = $true)][string] $Container)

  $existing = docker ps -a --format '{{.Names}}' | Where-Object { $_ -eq $Container }
  if ($existing) {
    docker rm -f $Container | Out-Null
  }
}

function Start-VerifyDb {
  param(
    [Parameter(Mandatory = $true)][string] $Container,
    [Parameter(Mandatory = $true)][int] $Port
  )

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker is required for Teacher Lite DB-backed verification'
  }
  $portOwner = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($portOwner) {
    throw "Port $Port is already in use; cannot start isolated Teacher Lite verification DB"
  }

  Remove-VerifyDb $Container
  Run-Step 'Teacher Lite verification DB start' @(
    'docker',
    'run',
    '--name',
    $Container,
    '-e',
    'POSTGRES_PASSWORD=postgres',
    '-e',
    'POSTGRES_USER=postgres',
    '-e',
    'POSTGRES_DB=cmc',
    '-p',
    "${Port}:5432",
    '-d',
    'postgres:16-alpine'
  )

  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    docker exec $Container pg_isready -U postgres -d cmc | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $ready = $true
      break
    }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) {
    throw 'Teacher Lite verification DB did not become ready'
  }
}

$apiListening = Get-NetTCPConnection -State Listen -LocalPort 4000 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($apiListening) {
  Write-Host ''
  Write-Host '==> DB client generation'
  Write-Host 'Skipping Prisma generate because the API dev server is listening on :4000 and may lock query_engine-windows.dll.node.'
} else {
  Run-Step 'DB client generation' @('pnpm', '--filter', '@cmc/db', 'generate')
}
Run-Step 'API typecheck' @('pnpm', '--filter', '@cmc/api', 'typecheck')
Run-Step 'DB typecheck' @('pnpm', '--filter', '@cmc/db', 'typecheck')
Run-Step 'Admin typecheck' @('pnpm', '--filter', '@cmc/admin', 'typecheck')
Run-Step 'LMS typecheck' @('pnpm', '--filter', '@cmc/lms', 'typecheck')
Run-Step 'API lint (strict warnings)' @('pnpm', '--filter', '@cmc/api', 'exec', 'eslint', 'src', '--max-warnings', '0')
Run-Step 'Admin lint (strict warnings)' @('pnpm', '--filter', '@cmc/admin', 'exec', 'eslint', 'src', '--max-warnings', '0')
Run-Step 'LMS lint (strict warnings)' @('pnpm', '--filter', '@cmc/lms', 'exec', 'eslint', 'src', '--max-warnings', '0')
Run-Step 'Permission parity' @('pnpm', '--filter', '@cmc/api', 'exec', 'vitest', 'run', 'test/permission-parity.test.ts')

$verifyDbContainer = 'cmc-teacher-lite-verify-pg'
$verifyDbPort = 55433
$verifyEnvNames = @(
  'DATABASE_URL',
  'DIRECT_URL',
  'JWT_SECRET',
  'STAFF_PASSWORD_LOGIN',
  'COOKIE_SECURE',
  'SEED_SUPERADMIN_PASSWORD',
  'TEST_LMS_STUDENT_PASSWORD',
  'CI'
)
$savedVerifyEnv = Save-Env $verifyEnvNames
try {
  Start-VerifyDb $verifyDbContainer $verifyDbPort

  $env:DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:${verifyDbPort}/cmc?schema=public&connection_limit=5"
  $env:DIRECT_URL = "postgresql://postgres:postgres@127.0.0.1:${verifyDbPort}/cmc?schema=public"
  $env:JWT_SECRET = 'test-secret-for-teacher-lite-verify-32-chars-minimum'
  $env:STAFF_PASSWORD_LOGIN = 'true'
  $env:COOKIE_SECURE = 'false'
  $env:SEED_SUPERADMIN_PASSWORD = 'ChangeMe!123'
  $env:TEST_LMS_STUDENT_PASSWORD = 'Cmc2026@'
  $env:CI = '1'

  Run-Step 'Teacher Lite verification DB migrate' @('pnpm', '--filter', '@cmc/db', 'migrate')
  Run-Step 'Teacher Lite verification DB seed' @('pnpm', '--filter', '@cmc/db', 'seed')
  Run-Step 'Teacher Lite DB-backed invariants' @(
    'pnpm',
    '--filter',
    '@cmc/api',
    'exec',
    'vitest',
    'run',
    'test/teacher-lite-direct-provisioning.int.test.ts',
    'test/session-evidence-publish-to-lms.int.test.ts',
    'test/submission-guardian-layer.int.test.ts',
    'test/lms-security-invariants.int.test.ts',
    'test/attendance-report-markall.int.test.ts',
    'test/assessment-final-grade-publish.int.test.ts'
  )
} finally {
  Restore-Env $verifyEnvNames $savedVerifyEnv
  Remove-VerifyDb $verifyDbContainer
}

Run-Step 'Teacher Lite nav regression' @(
  'pnpm',
  '--filter',
  '@cmc/admin',
  'exec',
  'vitest',
  'run',
  'src/__tests__/nav-teacher-consolidation.test.ts',
  'src/__tests__/nav-consistency.test.ts',
  'src/__tests__/nav-director-kd-cockpit-consolidation.test.ts',
  'src/__tests__/nav-director-dt-cockpit-consolidation.test.ts'
)
Run-Step 'Admin production build' @('pnpm', '--filter', '@cmc/admin', 'build')
Run-Step 'LMS production build' @('pnpm', '--filter', '@cmc/lms', 'build')

Write-Host ""
Write-Host 'Teacher Lite Direct LMS MVP local verification completed.'
