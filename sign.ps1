# Signs the extension as an unlisted (private) AMO add-on and opens the .xpi in Firefox.
# Credentials are read into memory only; nothing is written to disk.
# Get them at https://addons.mozilla.org/developers/addon/api/key/
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
$out = Join-Path $root 'dist'
Step 'web-ext lint' { web-ext lint --source-dir "$root\extension" --ignore-files local-config.json }
Step 'web-ext sign (unlisted)' { web-ext sign --source-dir "$root\extension" --artifacts-dir $out --channel=unlisted --ignore-files local-config.json --approval-timeout 2700000 }
$xpi = Get-ChildItem $out -Filter *.xpi | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $xpi) { Write-Host 'FAIL: no .xpi produced' -ForegroundColor Red; exit 1 }
$version = (Get-Content "$root\extension\manifest.json" -Raw | ConvertFrom-Json).version
$named = Join-Path $out "claude-browser-bridge-$version.xpi"
Copy-Item $xpi.FullName $named -Force
Write-Host "Signed: $named" -ForegroundColor Green
Start-Process firefox $named
Write-Host 'Firefox will ask to add the extension: click Add. Then open its Options and paste the token.'
Remove-Item Env:WEB_EXT_API_SECRET, Env:WEB_EXT_API_KEY -ErrorAction SilentlyContinue
