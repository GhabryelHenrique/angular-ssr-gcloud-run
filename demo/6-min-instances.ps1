<#
.SYNOPSIS
  Step 6 — what --min-instances 1 actually buys, measured on both sides.
.DESCRIPTION
  Scripts 3 and 4 measure a cold start. This one measures the FIX, by putting
  the two situations side by side and timing the same visit in each:

    A) Scaled to zero. Nothing is running. The visitor's request is what causes
       an instance to be created, so provisioning, Node boot, the startup
       stages and the first render are all on their clock.

    B) One instance kept warm. Someone else — a keep-alive request, in this
       simulation; Cloud Run's scheduler, in production — already paid for all
       of that. The visitor gets the render and nothing else.

  Note what does NOT change between the two: the startup work is identical, and
  the container is the same image with the same environment. --min-instances
  makes nothing faster. It changes WHO waits, and that is the whole point.

  Runs entirely on local Docker. No cloud account, no billing, no network.
.PARAMETER BootProfile
  How much startup work the container performs: off, realistic or heavy. The
  heavier the startup, the wider the gap — which is exactly the relationship
  worth showing.
.PARAMETER Visits
  How many visits to time in each scenario. Scenario A restarts the container
  before every one of them, so keep this small.
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  [int]$Port = 8080,
  [ValidateSet('off', 'realistic', 'heavy')]
  [string]$BootProfile = 'realistic',
  [int]$Visits = 3
)

. "$PSScriptRoot\_common.ps1"

Assert-Docker

$name = 'ssr-min-instances'
$base = "http://localhost:$Port"

function Start-Instance {
  param([System.Net.Http.HttpClient]$Client)

  Remove-Container $name

  $clock = [System.Diagnostics.Stopwatch]::StartNew()

  docker run -d --name $name -e "PORT=$Port" -e "BOOT_PROFILE=$BootProfile" `
    -p "${Port}:${Port}" $Tag | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start the container.' }

  $readyMs = Wait-Server -Client $Client -Url "$base/healthz" -Stopwatch $clock
  if ($null -eq $readyMs) { throw 'The container did not answer /healthz within 60s.' }

  return $readyMs
}

$client = New-HttpClient -TimeoutSeconds 120

try {
  Write-Heading "--min-instances, measured (BOOT_PROFILE=$BootProfile)"

  # ===========================================================================
  # Scenario A — scale to zero: the visitor creates the instance
  # ===========================================================================
  Write-Step 'A) Scaled to zero - the visitor waits for the whole thing'

  $coldVisits = @()
  for ($i = 0; $i -lt $Visits; $i++) {
    # Provisioning is part of what the visitor waits for, so it is inside the
    # measurement rather than before it.
    $readyMs = Start-Instance -Client $client
    $render = Invoke-Timed -Client $client -Url "$base/"
    $total = $readyMs + $render.TotalMs

    $coldVisits += $total
    Write-Note ('visit {0}: instance ready {1,7:N0} ms + first render {2,6:N0} ms = {3,7:N0} ms' -f `
        ($i + 1), $readyMs, $render.TotalMs, $total)
  }

  $boot = $client.GetStringAsync("$base/api/boot").GetAwaiter().GetResult() | ConvertFrom-Json
  Remove-Container $name
  Write-Host ''

  # ===========================================================================
  # Scenario B — one warm instance already running
  # ===========================================================================
  Write-Step 'B) One instance kept warm - somebody else already paid'

  $readyMs = Start-Instance -Client $client

  # The keep-alive request stands in for what --min-instances does: it makes
  # sure the startup cost is spent by something that is not a real visitor.
  $client.GetAsync("$base/").GetAwaiter().GetResult() | Out-Null

  $warmVisits = @()
  for ($i = 0; $i -lt $Visits; $i++) {
    $render = Invoke-Timed -Client $client -Url "$base/"
    $warmVisits += $render.TotalMs
    Write-Note ('visit {0}: instance already up      + render        {1,6:N0} ms = {2,7:N0} ms' -f `
        ($i + 1), $render.TotalMs, $render.TotalMs)
  }

  Write-Host ''

  # ===========================================================================
  # Verdict
  # ===========================================================================
  $coldAvg = ($coldVisits | Measure-Object -Average).Average
  $warmAvg = ($warmVisits | Measure-Object -Average).Average

  Write-Heading 'What the visitor experienced'

  Write-Metric 'Scaled to zero, mean visit' ('{0:N0} ms' -f $coldAvg)
  Write-Metric 'Warm instance, mean visit' ('{0:N0} ms' -f $warmAvg)

  if ($warmAvg -gt 0) {
    Write-Metric 'Difference' ('{0:N1}x' -f ($coldAvg / $warmAvg))
    Write-Metric 'Removed from the user path' ('{0:N0} ms' -f ($coldAvg - $warmAvg))
  }

  Write-Host ''
  Write-Metric 'Startup work, both scenarios' ('{0:N0} ms' -f $boot.totalMs)
  Write-Note 'Identical. The instance in scenario B did exactly the same work;'
  Write-Note 'it just did it before anyone was watching.'
  Write-Host ''

  Write-Note 'On Cloud Run this is one flag:'
  Write-Note '  gcloud run services update angular-ssr --min-instances 1'
  Write-Host ''
  Write-Note 'It bills continuously, traffic or not - one instance running 24/7.'
  Write-Note 'Whether that is worth it is a question about your traffic pattern:'
  Write-Note 'steady traffic keeps instances warm on its own and needs nothing.'
  Write-Note 'Spiky or low-volume traffic is where every visitor is a first one.'
  Write-Host ''

  if ($BootProfile -ne 'heavy') {
    Write-Note 'Run again with -BootProfile heavy: the warm column will not move,'
    Write-Note 'and the gap is the argument.'
    Write-Host ''
  }
} finally {
  $client.Dispose()
  Remove-Container $name
}
