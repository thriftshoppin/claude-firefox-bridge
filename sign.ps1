# Submits the Firefox add-on (extension\) to addons.mozilla.org (AMO).
#   .\sign.ps1 -Listed   Submit for the PUBLIC listing on addons.mozilla.org, with the listing text in amo\metadata.json.
#                        Mozilla reviews it (automated, sometimes also a person) and emails you. It's installable from the add-on page once approved.
#   .\sign.ps1           Sign a PRIVATE (unlisted) copy for self-distribution, and download it to dist\.
# Every submission needs a version number that hasn't been used before on AMO, in either channel.
# The AMO API key and secret are read into memory only and never written to disk.
# Get them at https://addons.mozilla.org/developers/addon/api/key/
param([switch]$Listed)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
function Step($name, [scriptblock]$b) {
  Write-Host "== $name" -ForegroundColor Cyan
  & $b
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host "FAIL: $name" -ForegroundColor Red; exit 1 }
  Write-Host "PASS: $name" -ForegroundColor Green
}
if (-not $env:WEB_EXT_API_KEY)    { $env:WEB_EXT_API_KEY = Read-Host 'JWT issuer (user:...)' }
if (-not $env:WEB_EXT_API_SECRET) {
  $s = Read-Host 'JWT secret' -AsSecureString
  $env:WEB_EXT_API_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$version = (Get-Content "$root\extension\manifest.json" -Raw | ConvertFrom-Json).version
$out = Join-Path $root 'dist'
try {
  Step 'web-ext lint' { web-ext lint --source-dir "$root\extension" --ignore-files local-config.json }
  if ($Listed) {
    Step "submit $version for the public listing" {
      web-ext sign --source-dir "$root\extension" --artifacts-dir $out --channel=listed `
        --amo-metadata "$root\amo\metadata.json" --ignore-files local-config.json --approval-timeout 0
    }
    Write-Host "`nSubmitted version $version for the public listing." -ForegroundColor Green
    Write-Host 'Mozilla emails you when the review finishes. Track it at https://addons.mozilla.org/developers/addons'
  } else {
    Step "sign $version (unlisted, private)" {
      web-ext sign --source-dir "$root\extension" --artifacts-dir $out --channel=unlisted --ignore-files local-config.json --approval-timeout 2700000
    }
    $xpi = Get-ChildItem $out -Filter *.xpi | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $xpi) { Write-Host 'FAIL: no .xpi produced. If it is still waiting for approval, run fetch-signed.ps1 later.' -ForegroundColor Red; exit 1 }
    $named = Join-Path $out "claude-mcp-connect-$version.xpi"
    Copy-Item $xpi.FullName $named -Force
    Write-Host "Signed: $named" -ForegroundColor Green
    Start-Process firefox $named
    Write-Host 'Firefox will ask to add the extension: click Add. Then copy the connection code from its toolbar popup into Claude.'
  }
} finally {
  Remove-Item Env:WEB_EXT_API_SECRET, Env:WEB_EXT_API_KEY -ErrorAction SilentlyContinue
}
