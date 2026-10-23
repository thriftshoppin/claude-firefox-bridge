# Builds dist\claude-browser-bridge-<version>.mcpb (the one-click Claude desktop extension) from bridge\bridge.js.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$m = Join-Path $root 'mcpb'
$version = (Get-Content (Join-Path $m 'manifest.json') -Raw | ConvertFrom-Json).version
function Step($name, [scriptblock]$b) {
  Write-Host "== $name" -ForegroundColor Cyan
  & $b
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host "FAIL: $name" -ForegroundColor Red; exit 1 }
  Write-Host "PASS: $name" -ForegroundColor Green
}
Step 'copy bridge into mcpb\server' {
  Copy-Item (Join-Path $root 'bridge\bridge.js') (Join-Path $m 'server\bridge.js') -Force
  Copy-Item (Join-Path $root 'bridge\package-lock.json') (Join-Path $m 'server\package-lock.json') -Force
}
Step 'install runtime dependencies' { Push-Location (Join-Path $m 'server'); npm ci --omit=dev --no-audit --no-fund; Pop-Location }
Step 'validate manifest' { npx -y @anthropic-ai/mcpb@2.1.2 validate (Join-Path $m 'manifest.json') }
$out = Join-Path $root "dist\claude-browser-bridge-$version.mcpb"
New-Item -ItemType Directory -Force (Join-Path $root 'dist') | Out-Null
Step 'pack' { npx -y @anthropic-ai/mcpb@2.1.2 pack $m $out }
Write-Host "Built: $out" -ForegroundColor Green
