$ErrorActionPreference = 'Stop'

$origins = if ($env:SSO_ORIGINS) { $env:SSO_ORIGINS } elseif ($env:SSO_ORIGIN) { $env:SSO_ORIGIN } else { 'https://teacher.cmcvn.edu.vn' }
$timeoutMs = if ($env:SSO_TIMEOUT_MS) { $env:SSO_TIMEOUT_MS } else { '900000' }

$env:SSO_ORIGINS = $origins
$env:SSO_TIMEOUT_MS = $timeoutMs

pnpm --filter @cmc/e2e exec node ../../scripts/verify-teacher-cmcvn-interactive-sso.mjs @args
if ($LASTEXITCODE -ne 0) {
  throw "Interactive SSO verifier failed with exit code $LASTEXITCODE"
}
