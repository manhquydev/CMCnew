# Harness CLI smoke test.
# Exercises scripts/bin/harness-cli.exe against an ISOLATED temp database
# (HARNESS_DB env) so the real harness.db is never touched. Asserts happy
# paths, schema CHECK-constraint enforcement, query/audit/score commands, and
# that a fully-populated trace reaches at least the "standard" quality tier.
#
# Usage:  pwsh -File scripts/verify-harness.ps1
# Exit:   0 = all checks passed, 1 = at least one check failed.

$ErrorActionPreference = "Stop"

# --- locate the binary (Windows .exe, POSIX fallback) ---
$repoRoot = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $repoRoot "scripts/bin/harness-cli.exe"
if (-not (Test-Path $cli)) { $cli = Join-Path $repoRoot "scripts/bin/harness-cli" }
if (-not (Test-Path $cli)) { Write-Host "FAIL: harness-cli binary not found"; exit 1 }

# --- isolate the database ---
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("harness-smoke-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$env:HARNESS_DB = Join-Path $tmp "smoke.db"
$env:HARNESS_REPO_ROOT = $repoRoot

$script:pass = 0
$script:fail = 0

# Run the CLI; returns @{ Code; Out } (stdout+stderr merged, exit code preserved).
function Invoke-Cli([string[]]$CliArgs) {
    $out = & $cli @CliArgs 2>&1 | Out-String
    return @{ Code = $LASTEXITCODE; Out = $out }
}

# Assert a positive case: command must exit 0 AND stdout match $Expect (if given).
function Check-Ok([string]$Name, [string[]]$CliArgs, [string]$Expect = "") {
    $r = Invoke-Cli $CliArgs
    if ($r.Code -eq 0 -and ($Expect -eq "" -or $r.Out -match $Expect)) {
        Write-Host "  PASS  $Name"; $script:pass++
    } else {
        Write-Host "  FAIL  $Name (exit=$($r.Code))"; Write-Host "        $($r.Out.Trim())"; $script:fail++
    }
}

# Assert a NEGATIVE case: command MUST fail (non-zero) — proves a guard works.
function Check-Rejects([string]$Name, [string[]]$CliArgs) {
    $r = Invoke-Cli $CliArgs
    if ($r.Code -ne 0) {
        Write-Host "  PASS  $Name (correctly rejected)"; $script:pass++
    } else {
        Write-Host "  FAIL  $Name (should have failed but exit=0)"; $script:fail++
    }
}

try {
    Write-Host "Harness smoke test  (DB: $($env:HARNESS_DB))"
    Write-Host "--- setup ---"
    Check-Ok    "init creates schema"        @("init")                                              "Schema applied"
    Check-Ok    "stats starts empty"         @("query","stats")                                     "0"

    Write-Host "--- happy paths ---"
    Check-Ok    "intake records a row"       @("intake","--type","harness improvement","--summary","smoke intake","--lane","normal") "Intake #"
    Check-Ok    "story add"                  @("story","add","--id","US-SMOKE","--title","smoke story","--lane","normal","--verify","echo ok") "US-SMOKE"
    Check-Ok    "story update proof (numeric)" @("story","update","--id","US-SMOKE","--unit","1","--integration","0")
    Check-Ok    "decision add"               @("decision","add","--id","9999-smoke","--title","smoke decision","--doc","docs/decisions/0017-daily-session-loop-playbook.md")

    Write-Host "--- constraint enforcement (must reject) ---"
    Check-Rejects "invalid trace outcome"    @("trace","--summary","bad","--outcome","banana")
    Check-Rejects "non-numeric story proof"  @("story","update","--id","US-SMOKE","--unit","yes")

    Write-Host "--- trace quality tiers ---"
    # Thin trace -> expect "minimal" tier in output.
    Check-Ok    "thin trace = minimal tier"  @("trace","--summary","thin","--outcome","completed") "minimal"
    # Fully-populated trace -> expect standard or higher (NOT minimal).
    $rich = Invoke-Cli @("trace","--summary","rich smoke trace","--outcome","completed","--intake","1","--agent","smoke","--actions","ran cli; asserted constraints","--read","docs/TRACE_SPEC.md","--changed","scripts/verify-harness.ps1","--errors","none")
    if ($rich.Code -eq 0 -and $rich.Out -match "standard|rich|comprehensive" -and $rich.Out -notmatch "minimal") {
        Write-Host "  PASS  populated trace >= standard tier"; $script:pass++
    } else {
        Write-Host "  FAIL  populated trace did not reach standard tier"; Write-Host "        $($rich.Out.Trim())"; $script:fail++
    }

    Write-Host "--- query + audit + score ---"
    Check-Ok    "query matrix"               @("query","matrix")                                    "US-SMOKE"
    Check-Ok    "query decisions"            @("query","decisions")                                 "9999-smoke"
    Check-Ok    "query traces"               @("query","traces")
    Check-Ok    "audit runs"                 @("audit")                                             "Entropy score"
    Check-Ok    "story verify-all"           @("story","verify-all")

} finally {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    Remove-Item Env:\HARNESS_DB -ErrorAction SilentlyContinue
    Remove-Item Env:\HARNESS_REPO_ROOT -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Result: $script:pass passed, $script:fail failed."
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
