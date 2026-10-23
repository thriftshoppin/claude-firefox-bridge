# Downloads an already-approved signed .xpi from AMO (use it when sign.ps1 timed out before approval)
# and opens it in Firefox. Credentials are read into memory only; nothing is written to disk.
#   -Version 1.0.2   (default: the version in extension\manifest.json)
param([string]$Version)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$manifest = Get-Content "$root\extension\manifest.json" -Raw | ConvertFrom-Json
$guid = $manifest.browser_specific_settings.gecko.id
if (-not $Version) { $Version = $manifest.version }
function Result($ok, $msg) { if ($ok) { Write-Host "  PASS  $msg" -ForegroundColor Green } else { Write-Host "  FAIL  $msg" -ForegroundColor Red; exit 1 } }

$issuer = if ($env:WEB_EXT_API_KEY) { $env:WEB_EXT_API_KEY } else { Read-Host 'JWT issuer (user:...)' }
$secret = if ($env:WEB_EXT_API_SECRET) { $env:WEB_EXT_API_SECRET } else {
  $s = Read-Host 'JWT secret' -AsSecureString
  [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

function B64Url([byte[]]$b) { [Convert]::ToBase64String($b).TrimEnd('=').Replace('+', '-').Replace('/', '_') }
function NewJwt {
  $now = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $head = B64Url ([Text.Encoding]::UTF8.GetBytes('{"alg":"HS256","typ":"JWT"}'))
  $body = B64Url ([Text.Encoding]::UTF8.GetBytes((@{ iss = $issuer; jti = [guid]::NewGuid().ToString(); iat = $now; exp = $now + 60 } | ConvertTo-Json -Compress)))
  $hmac = New-Object Security.Cryptography.HMACSHA256 (, [Text.Encoding]::UTF8.GetBytes($secret))
  $sig = B64Url ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes("$head.$body")))
  "JWT $head.$body.$sig"
}

Write-Host "`n=== Fetch signed $guid $Version from AMO ===" -ForegroundColor Cyan
$api = "https://addons.mozilla.org/api/v5/addons/addon/$([uri]::EscapeDataString($guid))/versions/?filter=all_with_unlisted&page_size=50"
$list = Invoke-RestMethod -Uri $api -Headers @{ Authorization = (NewJwt) }
$v = $list.results | Where-Object { $_.version -eq $Version } | Select-Object -First 1
Result ([bool]$v) "AMO has version $Version (channel $($v.channel))"
Result ($v.file.status -eq 'public') "version $Version is approved and signed (file status: $($v.file.status))"

$out = Join-Path $root "dist\claude-mcp-connect-$Version.xpi"
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
Invoke-WebRequest -Uri $v.file.url -Headers @{ Authorization = (NewJwt) } -OutFile $out -UseBasicParsing
Result ((Get-Item $out).Length -gt 1000) "downloaded $out ($((Get-Item $out).Length) bytes)"

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($out)
$names = $zip.Entries.FullName
$mf = (New-Object IO.StreamReader ($zip.GetEntry('manifest.json').Open())).ReadToEnd() | ConvertFrom-Json
$zip.Dispose()
Result ($names -contains 'META-INF/mozilla.rsa' -or $names -contains 'META-INF/cose.sig') "file carries Mozilla's signature"
Result ($mf.version -eq $Version -and $mf.browser_specific_settings.gecko.id -eq $guid) "manifest inside is $guid $($mf.version)"
Result (-not ($names -contains 'local-config.json')) "no local-config.json inside"

$secret = $null; $issuer = $null
Start-Process firefox $out
Write-Host "`nFirefox will ask to add or update the extension: click Add / Update." -ForegroundColor Green
