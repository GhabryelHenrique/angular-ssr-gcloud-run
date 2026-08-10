<#
.SYNOPSIS
  Step 1 — an SSR build produces one artifact: static files plus a Node server.
.DESCRIPTION
  Runs `ng build` and prints the resulting tree, separating what ships to the
  browser from what runs on the server.
#>

. "$PSScriptRoot\_common.ps1"

$root = Get-ProjectRoot
Set-Location $root

Write-Heading 'The SSR build'

Write-Step 'ng build'
Write-Note 'One command. No custom webpack, no bundler configuration.'
Write-Host ''

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
npm run build
$stopwatch.Stop()

if ($LASTEXITCODE -ne 0) { throw 'The build failed.' }

$dist = Join-Path $root 'dist\angular-ssr-cloud-run'
$browser = Join-Path $dist 'browser'
$server = Join-Path $dist 'server'

Write-Heading 'What the build produced'

function Get-DirectorySize {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return 0 }
  (Get-ChildItem $Path -Recurse -File | Measure-Object -Property Length -Sum).Sum
}

$browserSize = Get-DirectorySize $browser
$serverSize = Get-DirectorySize $server

Write-Host '  dist/angular-ssr-cloud-run/' -ForegroundColor White
Write-Host ('    browser/   {0,-12} ' -f (Format-Bytes $browserSize)) -NoNewline -ForegroundColor Cyan
Write-Host 'hashed static assets + prerendered routes' -ForegroundColor DarkGray
Write-Host ('    server/    {0,-12} ' -f (Format-Bytes $serverSize)) -NoNewline -ForegroundColor Cyan
Write-Host 'server.mjs — the Node process that renders' -ForegroundColor DarkGray
Write-Host ''

# Prerendered routes become real .html files inside browser/.
$prerendered = Get-ChildItem $browser -Recurse -Filter '*.html' -File |
  Where-Object { $_.Name -ne 'index.csr.html' }

if ($prerendered) {
  Write-Step 'Routes frozen at build time (RenderMode.Prerender)'
  foreach ($file in $prerendered) {
    $relative = $file.FullName.Substring($browser.Length + 1)
    Write-Note ("{0,-34} {1}" -f $relative, (Format-Bytes $file.Length))
  }
  Write-Host ''
}

Write-Step 'Server entry point'
$entry = Join-Path $server 'server.mjs'
Write-Note "node dist/angular-ssr-cloud-run/server/server.mjs   ($(Format-Bytes (Get-Item $entry).Length))"
Write-Host ''

Write-Metric 'Build time' ('{0:N1}s' -f $stopwatch.Elapsed.TotalSeconds)
Write-Metric 'Total artifact size' (Format-Bytes ($browserSize + $serverSize))
Write-Host ''
Write-Note 'This entire directory is what goes into the Docker image — nothing else.'
Write-Host ''
