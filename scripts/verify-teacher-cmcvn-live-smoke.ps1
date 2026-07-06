$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Net.Http

$handler = [System.Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [System.Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(20)

function Get-Response([string]$url) {
  $response = $client.GetAsync($url).GetAwaiter().GetResult()
  $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  return [pscustomobject]@{
    Url = $url
    Status = [int]$response.StatusCode
    Headers = $response.Headers
    Body = $body
  }
}

function Assert-Status([string]$url, [int]$expected) {
  $response = Get-Response $url
  if ($response.Status -ne $expected) {
    throw "$url returned $($response.Status), expected $expected"
  }
  return $response
}

function Assert-Health([string]$origin) {
  $response = Assert-Status "$origin/api/health" 200
  $json = $response.Body | ConvertFrom-Json
  if (-not $json.ok) {
    throw "$origin/api/health did not return ok=true"
  }
  [pscustomobject]@{
    Origin = $origin
    Commit = $json.commit
    BuiltAt = $json.builtAt
  }
}

function Assert-RootIdentity([string]$origin, [string]$expectedTitleMarker) {
  $response = Assert-Status "$origin/" 200
  $title = if ($response.Body -match '<title>(.*?)</title>') { $Matches[1] } else { '' }
  if (-not $title.Contains($expectedTitleMarker)) {
    throw "$origin root SPA identity mismatch: title='$title', expected marker '$expectedTitleMarker'"
  }
  $asset = if ($response.Body -match '/assets/index-[^"'']+\.js') { $Matches[0] } else { '' }
  if (-not $asset) {
    throw "$origin root SPA did not include a Vite index asset"
  }
  [pscustomobject]@{
    Origin = $origin
    Title = $title
    Asset = $asset
  }
}

function Assert-RootAssetMarker([string]$origin, [string]$expectedMarker) {
  $response = Assert-Status "$origin/" 200
  $asset = if ($response.Body -match '/assets/index-[^"'']+\.js') { $Matches[0] } else { '' }
  if (-not $asset) {
    throw "$origin root SPA did not include a Vite index asset"
  }
  $assetResponse = Assert-Status "$origin$asset" 200
  if (-not $assetResponse.Body.Contains($expectedMarker)) {
    throw "$origin SPA bundle did not contain marker '$expectedMarker'"
  }
  [pscustomobject]@{
    Origin = $origin
    Asset = $asset
    Marker = $expectedMarker
  }
}

function Assert-RenderedTeacherSurface {
  $env:TEACHER_SURFACE_URL = 'https://teacher.cmcvn.edu.vn/'
  node scripts/verify-teacher-cmcvn-rendered-surface.mjs
  if ($LASTEXITCODE -ne 0) {
    throw "Rendered teacher surface verification failed with exit code $LASTEXITCODE"
  }
}

function Assert-SsoStart([string]$origin, [string]$expectedCallback) {
  $response = Assert-Status "$origin/api/auth/sso/login" 302
  $locationValues = $response.Headers.GetValues('Location')
  $location = [string]($locationValues | Select-Object -First 1)
  if (-not $location.Contains('login.microsoftonline.com')) {
    throw "$origin SSO did not redirect to Microsoft: $location"
  }
  $decodedLocation = [System.Uri]::UnescapeDataString($location)
  if (-not $decodedLocation.Contains("redirect_uri=$expectedCallback")) {
    throw "$origin SSO redirect_uri mismatch: $decodedLocation"
  }
  $cookieValues = @()
  if ($response.Headers.Contains('Set-Cookie')) {
    $cookieValues = @($response.Headers.GetValues('Set-Cookie'))
  }
  $txCookie = $cookieValues | Where-Object { $_ -like 'cmc.sso_tx=*' } | Select-Object -First 1
  if (-not $txCookie) {
    throw "$origin SSO did not set cmc.sso_tx"
  }
  if ($txCookie -match '(?i)(^|;\s*)Domain=') {
    throw "$origin SSO transaction cookie must be host-only, got: $txCookie"
  }
  [pscustomobject]@{
    Origin = $origin
    Location = $location
    Cookie = $txCookie
  }
}

function Assert-EntraAcceptsRedirect([string]$origin, [string]$authorizeUrl) {
  $response = Get-Response $authorizeUrl
  if ($response.Body.Contains('AADSTS50011')) {
    throw "$origin Microsoft authorize rejected redirect_uri with AADSTS50011"
  }
  if ($response.Body.Contains('AADSTS900971')) {
    throw "$origin Microsoft authorize rejected request parameters with AADSTS900971"
  }
  [pscustomobject]@{
    Origin = $origin
    Status = $response.Status
    NoAadsts50011 = $true
  }
}

$health = @(
  Assert-Health 'https://erp.cmcvn.edu.vn'
  Assert-Health 'https://teacher.cmcvn.edu.vn'
  Assert-Health 'https://hoc.cmcvn.edu.vn'
)

$rootIdentity = @(
  Assert-RootIdentity 'https://erp.cmcvn.edu.vn' 'CMC ERP'
  Assert-RootIdentity 'https://hoc.cmcvn.edu.vn' 'CMC EDU'
)
$teacherBundle = Assert-RootAssetMarker 'https://teacher.cmcvn.edu.vn' 'CMC Teacher'
$teacherIntakeRouteBundle = Assert-RootAssetMarker 'https://teacher.cmcvn.edu.vn' 'family-intake'
Assert-RenderedTeacherSurface

$erpSso = Assert-SsoStart 'https://erp.cmcvn.edu.vn' 'https://erp.cmcvn.edu.vn/api/auth/sso/callback'
$teacherSso = Assert-SsoStart 'https://teacher.cmcvn.edu.vn' 'https://teacher.cmcvn.edu.vn/api/auth/sso/callback'
$erpEntra = Assert-EntraAcceptsRedirect 'https://erp.cmcvn.edu.vn' $erpSso.Location
$teacherEntra = Assert-EntraAcceptsRedirect 'https://teacher.cmcvn.edu.vn' $teacherSso.Location

[pscustomobject]@{
  Health = $health
  RootIdentity = $rootIdentity
  TeacherBundle = $teacherBundle
  TeacherIntakeRouteBundle = $teacherIntakeRouteBundle
  ErpSsoRedirect = $erpSso.Location
  TeacherSsoRedirect = $teacherSso.Location
  EntraAuthorizePreLogin = @($erpEntra, $teacherEntra)
  Status = 'pass'
} | ConvertTo-Json -Depth 4

$client.Dispose()
$handler.Dispose()
