# ClaudeKit doc-accuracy checker.
# Asserts every /ck:<skill> referenced in the harness docs is actually installed
# under .claude/skills/. Catches doc drift (e.g. a renamed/removed skill) before
# it misleads an operator. A /ck:<name> resolves if .claude/skills/<name> OR
# .claude/skills/ck-<name> exists (the thin-vs-engine naming from CK_WORKFLOW §2).
#
# Usage:  pwsh -File scripts/verify-ck-docs.ps1
# Exit:   0 = every referenced skill exists, 1 = at least one is missing.

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$skillsDir = Join-Path $repoRoot ".claude/skills"

# Harness docs that reference ck skills. Add new ones here as they appear.
$docs = @(
    "docs/CK_WORKFLOW.md",
    "docs/SESSION_LOOP.md",
    "docs/CK_CAPABILITIES.md"
) | ForEach-Object { Join-Path $repoRoot $_ } | Where-Object { Test-Path $_ }

# Skills intentionally referenced but provided globally (not a project skill).
# Keep empty so global references must be added here deliberately, not silently.
$allowlist = @()

if (-not (Test-Path $skillsDir)) { Write-Host "FAIL: .claude/skills not found"; exit 1 }

# name -> resolves if skills/<name> or skills/ck-<name> exists
function Test-Skill([string]$name) {
    if ($allowlist -contains $name) { return $true }
    return (Test-Path (Join-Path $skillsDir $name)) -or (Test-Path (Join-Path $skillsDir "ck-$name"))
}

$missing = @()
$checked = 0
foreach ($doc in $docs) {
    $text = Get-Content -LiteralPath $doc -Raw
    # /ck:<name> with optional flags after; capture the skill name only.
    $names = [regex]::Matches($text, "/ck:([a-z0-9][a-z0-9-]*)") |
             ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
    foreach ($n in $names) {
        $checked++
        if (-not (Test-Skill $n)) {
            $missing += [pscustomobject]@{ Doc = (Split-Path -Leaf $doc); Skill = "/ck:$n" }
        }
    }
}

if ($missing.Count -gt 0) {
    Write-Host "FAIL: $($missing.Count) referenced ck skill(s) not installed under .claude/skills:"
    $missing | ForEach-Object { Write-Host "  $($_.Skill)  (in $($_.Doc))" }
    Write-Host "Fix the doc, or add the skill name to `$allowlist if it is a known global skill."
    exit 1
}

Write-Host "OK: all $checked /ck: skill references across $($docs.Count) doc(s) resolve to installed skills."
exit 0
