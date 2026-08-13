<#
.SYNOPSIS
  Step 3 — measure a cold start stage by stage, then compare against a warm one.
.DESCRIPTION
  Starts a container from scratch and times each stage of the cold start, then
  measures the same route once the instance is warm. Runs entirely on local
  Docker: no cloud account and no network required.

  A local container does not reproduce the network latency or the image layer
  download that Cloud Run pays during provisioning, so absolute numbers there
  are higher. What this does reproduce faithfully is the RATIO: the first
  request costs an order of magnitude more than the ones that follow.

  The application reports its own startup breakdown on /api/boot, so stage 3
  below is not a black box: you can see which part of it was I/O waiting on a
  secret store and which part was CPU building an index.
.PARAMETER BootProfile
  How much startup work the container performs: off, realistic or heavy.
  `off` is a hello-world process; `realistic` and `heavy` load configuration,
  derive keys, index a catalog and open a connection pool, which is what a real
  application does before it can answer anything.
.PARAMETER DelayMs
  Sets RENDER_DELAY_MS in the container to simulate a slow upstream API in the
  middle of the render. Unlike startup work, this cost is paid on EVERY request.
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  [int]$Port = 8080,
  [ValidateSet('off', 'realistic', 'heavy')]
  [string]$BootProfile = 'realistic',
  [int]$DelayMs = 0,
  [int]$Repetitions = 20
)

. "$PSScriptRoot\_common.ps1"

Assert-Docker

$name = 'ssr-cold-start'
$base = "http://localhost:$Port"

# Guarantees the next instance really is a new one.
Remove-Container $name

Write-Heading 'Cold start, stage by stage'

Write-Note "BOOT_PROFILE=$BootProfile"
if ($DelayMs -gt 0) {
  Write-Note "RENDER_DELAY_MS=$DelayMs - simulating a slow backend during render."
}
Write-Host ''

$client = New-HttpClient

try {
  # =========================================================================
  # Stages 1 and 2 — provision the instance, boot Node, run startup work
  # =========================================================================
  Write-Step '01+02  Provision the instance, boot Node, run startup work'

  $clock = [System.Diagnostics.Stopwatch]::StartNew()

  $arguments = @(
    'run', '-d', '--name', $name,
    '-e', "PORT=$Port",
    '-e', "BOOT_PROFILE=$BootProfile",
    '-p', "${Port}:${Port}"
  )
  if ($DelayMs -gt 0) { $arguments += @('-e', "RENDER_DELAY_MS=$DelayMs") }
  $arguments += $Tag

  docker @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start the container.' }

  $containerCreatedMs = $clock.Elapsed.TotalMilliseconds

  # Wait for the process to accept its first connection. This is exactly what
  # Cloud Run waits for before routing traffic to a new instance — and the
  # application deliberately keeps the port closed until its eager startup
  # stages have finished, so this number includes them.
  $readyMs = Wait-Server -Client $client -Url "$base/healthz" -Stopwatch $clock

  if ($null -eq $readyMs) { throw 'The container did not answer /healthz within 60s.' }

  Write-Note ('container created         {0,8:N0} ms' -f $containerCreatedMs)
  Write-Note ('first connection accepted {0,8:N0} ms' -f $readyMs)
  Write-Host ''

  # =========================================================================
  # Stage 3 — the first render
  # =========================================================================
  Write-Step '03     First render (this request paid for the cold start)'

  $cold = Invoke-Timed -Client $client -Url "$base/"
  Write-Note ('total, client side        {0,8:N0} ms' -f $cold.TotalMs)
  Write-Note ('server render only        {0,8:N0} ms' -f $cold.RenderMs)
  Write-Note ("HTML returned             {0,8} bytes" -f $cold.Bytes)
  Write-Host ''

  # =========================================================================
  # Stage 4 — what the process actually spent its startup on
  # =========================================================================
  Write-Step '04     Startup breakdown, as reported by the instance'

  $boot = $client.GetStringAsync("$base/api/boot").GetAwaiter().GetResult() | ConvertFrom-Json

  foreach ($stage in $boot.stages) {
    $marker = if ($stage.when -eq 'lazy') { 'first request' } else { 'before listen ' }
    Write-Note ('{0,-28} {1,8:N0} ms  {2}  [{3}]' -f `
        $stage.label, $stage.durationMs, $marker, $stage.kind)
  }

  Write-Host ''
  Write-Note ('eager, before the port opened  {0,8:N0} ms' -f $boot.eagerMs)
  Write-Note ('lazy, billed to request #1     {0,8:N0} ms' -f $boot.lazyMs)
  Write-Note ('SKUs indexed                   {0,8:N0}' -f $boot.indexedSkus)
  Write-Host ''

  # =========================================================================
  # Stage 5 — warm instance
  # =========================================================================
  Write-Step "05     Warm instance ($Repetitions requests to the same route)"

  $totals = @()
  $renders = @()
  for ($i = 0; $i -lt $Repetitions; $i++) {
    $measurement = Invoke-Timed -Client $client -Url "$base/"
    $totals += $measurement.TotalMs
    if ($null -ne $measurement.RenderMs) { $renders += $measurement.RenderMs }
  }

  $sorted = $totals | Sort-Object
  $median = $sorted[[int]($sorted.Count / 2)]
  $p95 = $sorted[[math]::Min($sorted.Count - 1, [int][math]::Ceiling($sorted.Count * 0.95) - 1)]
  $medianRender = ($renders | Sort-Object)[[int]($renders.Count / 2)]

  Write-Note ('median total              {0,8:N0} ms' -f $median)
  Write-Note ('p95 total                 {0,8:N0} ms' -f $p95)
  Write-Note ('median render only        {0,8:N0} ms' -f $medianRender)
  Write-Host ''

  # =========================================================================
  # Verdict
  # =========================================================================
  Write-Heading 'Cold versus warm'

  # What a real visitor waits for when the service has scaled to zero: the
  # instance did not exist, so provisioning and startup are on their clock too.
  $scaleToZero = $readyMs + $cold.TotalMs

  Write-Metric 'Visitor on a scaled-to-zero service' ('{0:N0} ms' -f $scaleToZero)
  Write-Metric 'First request alone (cold instance)' ('{0:N0} ms' -f $cold.TotalMs)
  Write-Metric 'Subsequent requests (warm)' ('{0:N0} ms' -f $median)

  if ($median -gt 0) {
    Write-Metric 'Cold request vs warm' ('{0:N1}x' -f ($cold.TotalMs / $median))
    Write-Metric 'Scaled to zero vs warm' ('{0:N1}x' -f ($scaleToZero / $median))
  }

  Write-Host ''
  Write-Note 'A cold start never disappears — it moves off the user critical path.'
  Write-Note '--min-instances 1 keeps one instance warm so the first visitor lands'
  Write-Note 'in the right-hand column instead of the left one. Run 6-min-instances.ps1'
  Write-Note 'to watch that substitution happen.'
  Write-Host ''

  if ($BootProfile -ne 'heavy') {
    Write-Note 'Tip: -BootProfile heavy triples the startup work. -BootProfile off'
    Write-Note 'strips it entirely, which is what a hello-world SSR container looks'
    Write-Note 'like — and why hello-world benchmarks understate the problem.'
    Write-Host ''
  }

  if ($DelayMs -eq 0) {
    Write-Note 'Tip: run with -DelayMs 800 to watch a slow backend inflate stage 3'
    Write-Note 'and, unlike startup work, the warm column with it.'
    Write-Host ''
  }
} finally {
  $client.Dispose()
  Remove-Container $name
}
