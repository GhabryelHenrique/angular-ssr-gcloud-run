<#
.SYNOPSIS
  Step 4 — many simultaneous requests, a single instance.
.DESCRIPTION
  Fires N parallel requests at one container and counts how many distinct
  instances answered. The answer is always: one.

  It runs TWO scenarios, because the difference between them is the real
  argument for high concurrency settings:

    A) Pure render, no upstream wait. This is CPU work, and Node has a single
       thread, so renders queue up. Peak simultaneity stays low even with 50
       clients waiting.

    B) The same render with an upstream call in the middle (RENDER_DELAY_MS).
       While one request waits on I/O the event loop serves the others, so peak
       simultaneity climbs to roughly N.

  Real pages call APIs, so scenario B is what happens in production — and it is
  why a single instance can hold dozens of concurrent requests.
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  [int]$Port = 8080,
  [int]$Requests = 50,
  [int]$DelayMs = 500
)

. "$PSScriptRoot\_common.ps1"

Assert-Docker

$name = 'ssr-concurrency'
$base = "http://localhost:$Port"

<#
.SYNOPSIS
  Starts a clean instance, fires the burst and returns the measurements.
#>
function Measure-Burst {
  param(
    [int]$Delay,
    [string]$Label
  )

  Remove-Container $name

  $arguments = @(
    'run', '-d', '--name', $name,
    '-e', "PORT=$Port",
    '-p', "${Port}:${Port}"
  )
  if ($Delay -gt 0) { $arguments += @('-e', "RENDER_DELAY_MS=$Delay") }
  $arguments += $Tag

  docker @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Failed to start the container.' }

  $client = New-HttpClient -TimeoutSeconds 120

  try {
    if ($null -eq (Wait-Server -Client $client -Url "$base/healthz")) {
      throw 'The container did not answer /healthz within 60s.'
    }

    # Warm-up: the first request pays the cold start, and this test is about
    # concurrency, not startup.
    $client.GetAsync("$base/").GetAwaiter().GetResult() | Out-Null

    Write-Step "$Label - firing $Requests parallel requests"

    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()

    $listType = 'System.Collections.Generic.List[System.Threading.Tasks.Task[System.Net.Http.HttpResponseMessage]]'
    $tasks = New-Object $listType
    for ($i = 0; $i -lt $Requests; $i++) {
      $tasks.Add($client.GetAsync("$base/"))
    }

    [System.Threading.Tasks.Task]::WaitAll($tasks.ToArray())
    $stopwatch.Stop()

    $instances = @{}
    $failures = 0
    foreach ($task in $tasks) {
      $response = $task.Result
      if (-not $response.IsSuccessStatusCode) { $failures++; continue }

      $header = $null
      if ($response.Headers.TryGetValues('X-Instance-Id', [ref]$header)) {
        $id = ($header -join '')
        if ($instances.ContainsKey($id)) { $instances[$id]++ } else { $instances[$id] = 1 }
      }
    }

    $telemetry = $client.GetStringAsync("$base/api/instance").GetAwaiter().GetResult() | ConvertFrom-Json

    return [pscustomobject]@{
      Label     = $Label
      TotalMs   = $stopwatch.Elapsed.TotalMilliseconds
      Instances = $instances.Count
      Peak      = $telemetry.peakInFlight
      Completed = $Requests - $failures
      Failures  = $failures
      # How long it would take if each request waited for the previous one.
      SerialMs  = $Requests * $Delay
    }
  } finally {
    $client.Dispose()
    Remove-Container $name
  }
}

try {
  Write-Heading "$Requests simultaneous requests, one instance"

  $a = Measure-Burst -Delay 0 -Label 'A) Pure render (CPU bound)'
  Write-Host ''
  $b = Measure-Burst -Delay $DelayMs -Label "B) With a ${DelayMs}ms upstream call"

  Write-Heading 'Result'

  $format = '  {0,-32} {1,10} {2,10}'
  Write-Host ($format -f '', 'SCENARIO A', 'SCENARIO B') -ForegroundColor DarkGray
  Write-Host ($format -f 'Requests completed', $a.Completed, $b.Completed) -ForegroundColor White
  Write-Host ($format -f 'Instances that answered', $a.Instances, $b.Instances) -ForegroundColor Green
  Write-Host ($format -f 'Peak simultaneous requests', $a.Peak, $b.Peak) -ForegroundColor Green
  Write-Host ($format -f 'Total burst time', ('{0:N0} ms' -f $a.TotalMs), ('{0:N0} ms' -f $b.TotalMs)) -ForegroundColor White

  Write-Host ''
  Write-Note 'A) Rendering is CPU work and Node has one thread, so renders queue'
  Write-Note '   up and peak simultaneity stays low.'
  Write-Host ''
  Write-Note "B) With I/O in the mix, one instance holds $($b.Peak) requests at once."

  if ($b.SerialMs -gt 0) {
    $speedup = $b.SerialMs / $b.TotalMs
    Write-Note ('   Serially this would take {0:N0} ms; it took {1:N0} ms - {2:N0}x faster.' -f `
        $b.SerialMs, $b.TotalMs, $speedup)
  }

  Write-Host ''
  Write-Note 'Either way: ONE instance. That is what --concurrency 80 buys you -'
  Write-Note 'fewer instances for the same traffic, and fewer instances is a'
  Write-Note 'smaller bill. Dropping concurrency to 1 multiplies cost for nothing.'
  Write-Host ''
} finally {
  Remove-Container $name
}
