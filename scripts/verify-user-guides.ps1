$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$guideDir = Join-Path $root 'docs/user-guides'
$htmlFiles = @(
  'index.html',
  'huong-dan-su-dung-giam-doc.html',
  'huong-dan-su-dung-sale-giao-vien.html'
)

$requiredFiles = @(
  'assets/guide.css',
  'assets/guide.js',
  'assets/user-guides/staff-dev-login.png',
  'assets/user-guides/staff-overview-dashboard.png',
  'assets/user-guides/staff-create-user-modal.png',
  'assets/user-guides/staff-cskh-panel.png',
  'assets/user-guides/staff-assessment-panel.png',
  'assets/user-guides/staff-my-payslips-panel.png',
  'assets/user-guides/e2e-crm-admission-flow.svg',
  'assets/user-guides/e2e-director-first-day.svg',
  'assets/user-guides/e2e-finance-readonly.svg',
  'assets/user-guides/e2e-training-class-flow.svg',
  'assets/user-guides/e2e-staff-onboarding-flow.svg',
  'assets/user-guides/e2e-kpi-approval-flow.svg',
  'assets/user-guides/e2e-teacher-day-flow.svg',
  'assets/user-guides/e2e-test-grading-flow.svg'
)

foreach ($file in $htmlFiles) {
  $path = Join-Path $guideDir $file
  if (-not (Test-Path $path)) {
    throw "Missing HTML file: $file"
  }

  $content = Get-Content -Raw $path
  foreach ($pattern in @('<!doctype html>', '<meta name="viewport"', 'assets/guide.css')) {
    if ($content -notmatch [regex]::Escape($pattern)) {
      throw "$file missing required pattern: $pattern"
    }
  }
}

foreach ($relative in $requiredFiles) {
  $path = Join-Path $guideDir $relative
  if (-not (Test-Path $path)) {
    throw "Missing guide asset: $relative"
  }
}

$refs = Select-String -Path (Join-Path $guideDir '*.html') -Pattern '(?:src|href)="([^"]+)"' -AllMatches |
  ForEach-Object { $_.Matches } |
  ForEach-Object { $_.Groups[1].Value } |
  Where-Object { $_ -notmatch '^(#|https?:|mailto:)' }

foreach ($ref in $refs) {
  if ($ref -match '^.+\.html$') {
    $target = Join-Path $guideDir $ref
  } elseif ($ref.StartsWith('../')) {
    $target = Join-Path $guideDir $ref
  } else {
    $target = Join-Path $guideDir $ref
  }
  if (-not (Test-Path $target)) {
    throw "Broken reference: $ref"
  }
}

$assetRefs = @($refs |
  Where-Object { $_ -match '^assets/user-guides/.+\.(png|svg)$' } |
  ForEach-Object { Split-Path $_ -Leaf } |
  Sort-Object -Unique)

$assetDir = Join-Path $guideDir 'assets/user-guides'
$assetFiles = Get-ChildItem $assetDir -File | Where-Object { $_.Extension -in @('.png', '.svg') } | Sort-Object Name
$assetFileNames = @($assetFiles | ForEach-Object { $_.Name })

$orphanFiles = @($assetFileNames | Where-Object { $_ -notin $assetRefs })
if ($orphanFiles.Count -gt 0) {
  throw "Unreferenced guide asset(s): $($orphanFiles -join ', ')"
}

$forbiddenPatterns = @('crm', 'finance', 'org-users', 'preview', 'dev-after-login')
foreach ($file in $assetFiles) {
  foreach ($pattern in $forbiddenPatterns) {
    if ($file.Extension -eq '.png' -and $file.Name -match $pattern) {
      throw "Forbidden guide screenshot remains: $($file.Name)"
    }
  }
  if ($file.Extension -eq '.png' -and $file.Length -gt 500KB) {
    throw "Guide screenshot too large: $($file.Name) $($file.Length) bytes"
  }
  if ($file.Extension -eq '.svg' -and $file.Length -gt 200KB) {
    throw "Guide SVG too large: $($file.Name) $($file.Length) bytes"
  }
}

Write-Output "user-guides-ok"
