# Shared helpers for the measurement scripts.
# Load with: . "$PSScriptRoot\_common.ps1"

# 'Continue', not 'Stop': in Windows PowerShell 5.1 anything a native
# executable writes to stderr becomes a NativeCommandError and would abort the
# script — and docker uses stderr for ordinary progress output. Failure
# handling here is explicit, via $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

# Windows PowerShell 5.1 does not load System.Net.Http by default. These
# scripts use HttpClient rather than Invoke-WebRequest because they need
# millisecond precision and genuinely parallel requests.
Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue

$script:ColorHeading = 'Green'
$script:ColorData = 'Cyan'
$script:ColorWarn = 'Yellow'
$script:ColorMuted = 'DarkGray'

function Write-Heading {
  param([string]$Text)

  Write-Host ''
  Write-Host ('=' * 78) -ForegroundColor $script:ColorHeading
  Write-Host "  $Text" -ForegroundColor $script:ColorHeading
  Write-Host ('=' * 78) -ForegroundColor $script:ColorHeading
  Write-Host ''
}

function Write-Step {
  param([string]$Text)
  Write-Host "-> $Text" -ForegroundColor $script:ColorData
}

function Write-Note {
  param([string]$Text)
  Write-Host "  $Text" -ForegroundColor $script:ColorMuted
}

function Write-Metric {
  param([string]$Label, [string]$Value)
  Write-Host ("  {0,-34} " -f $Label) -NoNewline -ForegroundColor $script:ColorMuted
  Write-Host $Value -ForegroundColor $script:ColorHeading
}

function Get-ProjectRoot {
  Split-Path -Parent $PSScriptRoot
}

function Format-Bytes {
  param([long]$Bytes)

  if ($Bytes -ge 1MB) { return '{0:N1} MB' -f ($Bytes / 1MB) }
  if ($Bytes -ge 1KB) { return '{0:N1} kB' -f ($Bytes / 1KB) }
  return "$Bytes B"
}

<#
.SYNOPSIS
  Issues a request and returns total time, status and Server-Timing.
.DESCRIPTION
  Uses HttpClient rather than Invoke-WebRequest because these measurements need
  millisecond precision and access to custom headers, without the overhead of
  PowerShell's HTML parser.
#>
function Invoke-Timed {
  param(
    [Parameter(Mandatory)][System.Net.Http.HttpClient]$Client,
    [Parameter(Mandatory)][string]$Url
  )

  $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
  $response = $Client.GetAsync($Url).GetAwaiter().GetResult()
  $body = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $stopwatch.Stop()

  $renderMs = $null
  $timingHeader = $null
  if ($response.Headers.TryGetValues('Server-Timing', [ref]$timingHeader)) {
    if (($timingHeader -join '') -match 'dur=(\d+)') { $renderMs = [int]$Matches[1] }
  }

  $instance = $null
  $instanceHeader = $null
  if ($response.Headers.TryGetValues('X-Instance-Id', [ref]$instanceHeader)) {
    $instance = ($instanceHeader -join '')
  }

  [pscustomobject]@{
    TotalMs  = [math]::Round($stopwatch.Elapsed.TotalMilliseconds, 1)
    RenderMs = $renderMs
    Status   = [int]$response.StatusCode
    Bytes    = $body.Length
    Instance = $instance
  }
}

function New-HttpClient {
  param(
    [int]$TimeoutSeconds = 30,
    [int]$MaxConnections = 200
  )

  # .NET Framework caps outbound connections at TWO per host. Without raising
  # that ceiling, the concurrency test would measure the client's limit rather
  # than the server's, and one instance would appear to serve 2 requests at a
  # time.
  [System.Net.ServicePointManager]::DefaultConnectionLimit = $MaxConnections

  $handler = [System.Net.Http.HttpClientHandler]::new()
  try {
    $handler.MaxConnectionsPerServer = $MaxConnections
  } catch {
    # Property missing on older runtimes; ServicePointManager above covers it.
  }

  $client = [System.Net.Http.HttpClient]::new($handler)
  $client.Timeout = [TimeSpan]::FromSeconds($TimeoutSeconds)
  return $client
}

function Assert-Docker {
  docker info 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'The Docker daemon is not responding. Start Docker Desktop and try again.'
  }
}

<#
.SYNOPSIS
  Removes a container without complaining when it does not exist.
.DESCRIPTION
  `docker rm -f` on a missing container writes to stderr. Checking first keeps
  that noise out of the output.
#>
function Remove-Container {
  param([Parameter(Mandatory)][string]$Name)

  $existing = docker ps -aq --filter "name=^/$Name$" 2>&1
  if ($LASTEXITCODE -eq 0 -and $existing) {
    docker rm -f $Name 2>&1 | Out-Null
  }
}

<#
.SYNOPSIS
  Waits for the server to accept connections and reports how long it took.
.OUTPUTS
  Milliseconds until the first successful response, or $null on timeout.
#>
function Wait-Server {
  param(
    [Parameter(Mandatory)][System.Net.Http.HttpClient]$Client,
    [Parameter(Mandatory)][string]$Url,
    [System.Diagnostics.Stopwatch]$Stopwatch,
    [int]$TimeoutSeconds = 60
  )

  if (-not $Stopwatch) { $Stopwatch = [System.Diagnostics.Stopwatch]::StartNew() }

  while ($Stopwatch.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
    try {
      $response = $Client.GetAsync($Url).GetAwaiter().GetResult()
      if ($response.IsSuccessStatusCode) { return $Stopwatch.Elapsed.TotalMilliseconds }
    } catch {
      # Connection refused while the process is not listening yet: expected.
    }
    Start-Sleep -Milliseconds 25
  }

  return $null
}
