<#
.SYNOPSIS
  Step 2 — package the build into a container and measure the result.
.DESCRIPTION
  Builds the image and reports its size and layer breakdown. The interesting
  part is what the final image does NOT contain.
.PARAMETER NoCache
  Also measures a build with no cache at all. That is the honest "real cost"
  number, but it takes a minute or two.
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  [switch]$NoCache
)

. "$PSScriptRoot\_common.ps1"

$root = Get-ProjectRoot
Set-Location $root

Assert-Docker

Write-Heading 'From source to container'

Write-Step 'Build context'
Write-Note 'node_modules, .angular, .git and dist are excluded by .dockerignore.'
Write-Host ''

# --- Optional cold build -----------------------------------------------------
$noCacheSeconds = $null

if ($NoCache) {
  Write-Step 'docker build --no-cache — the real cost, reusing nothing'
  Write-Host ''

  $coldClock = [System.Diagnostics.Stopwatch]::StartNew()
  docker build --no-cache -t $Tag . | Out-Null
  $coldClock.Stop()

  if ($LASTEXITCODE -ne 0) { throw 'docker build --no-cache failed.' }
  $noCacheSeconds = $coldClock.Elapsed.TotalSeconds

  Write-Note ('{0:N1}s — this is what CI pays when no cache exists.' -f $noCacheSeconds)
  Write-Host ''
}

# --- Normal build ------------------------------------------------------------
Write-Step "docker build -t $Tag ."
Write-Host ''

$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
docker build -t $Tag .
$stopwatch.Stop()

if ($LASTEXITCODE -ne 0) { throw 'docker build failed.' }
$cachedSeconds = $stopwatch.Elapsed.TotalSeconds

# --- Result ------------------------------------------------------------------
Write-Heading 'The image'

$size = docker images $Tag --format '{{.Size}}'

Write-Metric 'Final size' $size

if ($null -ne $noCacheSeconds) {
  Write-Metric 'Build without cache' ('{0:N1}s' -f $noCacheSeconds)
  Write-Metric 'Build with cache' ('{0:N1}s' -f $cachedSeconds)
  if ($cachedSeconds -gt 0) {
    Write-Metric 'Cache speedup' ('{0:N1}x faster' -f ($noCacheSeconds / $cachedSeconds))
  }
} else {
  Write-Metric 'Build (layers cached)' ('{0:N1}s' -f $cachedSeconds)
  Write-Note 'Run with -NoCache to also measure a build from scratch.'
}

Write-Host ''
Write-Step 'Final image layers'

# Explicit separator: inside single quotes a backtick escapes nothing, so a
# "`t" would be printed literally.
docker history $Tag --format '{{.Size}}|{{.CreatedBy}}' --no-trunc |
  Select-Object -First 6 |
  ForEach-Object {
    $parts = $_ -split '\|', 2
    $command = $parts[1]
    if ($command.Length -gt 56) { $command = $command.Substring(0, 56) + '...' }
    Write-Note ('{0,-10} {1}' -f $parts[0], $command)
  }

Write-Host ''
Write-Note 'Note what is missing: node_modules. Angular bundles Express into'
Write-Note 'server.mjs, so the runtime image carries only the dist directory.'
Write-Host ''
