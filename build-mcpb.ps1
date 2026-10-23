# Builds dist\firefox-mcp-connect-<version>.mcpb, the one-click Claude desktop extension.
# The bridge has no dependencies, so the bundle is just the manifest, the icon and server\bridge.js.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$version = (Get-Content (Join-Path $root 'mcpb\manifest.json') -Raw | ConvertFrom-Json).version
function Step($name, [scriptblock]$b) {
  Write-Host "== $name" -ForegroundColor Cyan
  & $b
  if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host "FAIL: $name" -ForegroundColor Red; exit 1 }
  Write-Host "PASS: $name" -ForegroundColor Green
}
$stage = Join-Path $root 'dist\mcpb-stage'
Step 'stage files' {
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Force (Join-Path $stage 'server') | Out-Null
  Copy-Item (Join-Path $root 'mcpb\manifest.json') $stage
  Copy-Item (Join-Path $root 'plugin\assets\icon.png') (Join-Path $stage 'icon.png')
  Copy-Item (Join-Path $root 'plugin\server\bridge.js') (Join-Path $stage 'server\bridge.js')
}
Step 'validate manifest' { npx -y @anthropic-ai/mcpb@2.1.2 validate (Join-Path $stage 'manifest.json') }
$out = Join-Path $root "dist\firefox-mcp-connect-$version.mcpb"
Step 'pack' { npx -y @anthropic-ai/mcpb@2.1.2 pack $stage $out }
Remove-Item $stage -Recurse -Force
Write-Host "Built: $out" -ForegroundColor Green
