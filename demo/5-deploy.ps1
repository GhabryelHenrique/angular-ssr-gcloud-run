<#
.SYNOPSIS
  Step 5 — deploy to Cloud Run.
.DESCRIPTION
  Does NOT run anything without explicit confirmation: this is the only script
  here that spends money and touches a real project.

  By default it just prints the command. Pass -Execute to actually deploy.
.PARAMETER Execute
  Actually performs the deploy. Without this flag the script only prints.
#>

param(
  [string]$Service = 'angular-ssr',
  [string]$Region = 'southamerica-east1',
  [switch]$Execute
)

. "$PSScriptRoot\_common.ps1"

$root = Get-ProjectRoot
Set-Location $root

Write-Heading 'Deploy in one command'

$command = @"
gcloud run deploy $Service ``
    --source . ``
    --region $Region ``
    --allow-unauthenticated ``
    --cpu 1 --memory 512Mi ``
    --concurrency 80 ``
    --min-instances 1 --max-instances 20 ``
    --cpu-boost
"@

Write-Host $command -ForegroundColor Cyan
Write-Host ''
Write-Note '--source .        Cloud Build packages it for you. Dockerfile present?'
Write-Note '                  It uses yours. Absent? A buildpack detects Node.'
Write-Note '--concurrency 80  one instance serves up to 80 simultaneous requests.'
Write-Note '--min-instances 1 one always-warm instance keeps cold starts off the'
Write-Note '                  user path. It is the only fixed line on the bill.'
Write-Note '--cpu-boost       extra CPU during startup only.'
Write-Host ''

# -----------------------------------------------------------------------------
# Preflight checks
# -----------------------------------------------------------------------------
$hasGcloud = $null -ne (Get-Command gcloud -ErrorAction SilentlyContinue)

if (-not $hasGcloud) {
  Write-Host '  gcloud is not installed on this machine.' -ForegroundColor Yellow
  Write-Note 'Install it from: https://cloud.google.com/sdk/docs/install'
  Write-Host ''
  return
}

if (-not $Execute) {
  Write-Host '  Dry run: nothing was executed.' -ForegroundColor Yellow
  Write-Note 'To deploy for real:  .\demo\5-deploy.ps1 -Execute'
  Write-Host ''
  return
}

# -----------------------------------------------------------------------------
# Confirmation — everything below touches a real project and costs money
# -----------------------------------------------------------------------------
$project = (gcloud config get-value project 2>$null)
$account = (gcloud config get-value account 2>$null)

Write-Heading 'Confirmation'
Write-Metric 'Project' $project
Write-Metric 'Account' $account
Write-Metric 'Region' $Region
Write-Metric 'Service' $Service
Write-Host ''
Write-Host '  --min-instances 1 keeps one instance running 24/7 and bills' -ForegroundColor Yellow
Write-Host '  continuously, even with zero traffic. Remember to tear it down:' -ForegroundColor Yellow
Write-Note "gcloud run services delete $Service --region $Region"
Write-Host ''

$answer = Read-Host "Type the service name ($Service) to confirm the deploy"
if ($answer -ne $Service) {
  Write-Host '  Cancelled.' -ForegroundColor Yellow
  return
}

# -----------------------------------------------------------------------------
# Deploy
# -----------------------------------------------------------------------------
gcloud run deploy $Service `
  --source . `
  --region $Region `
  --allow-unauthenticated `
  --cpu 1 --memory 512Mi `
  --concurrency 80 `
  --min-instances 1 --max-instances 20 `
  --cpu-boost

if ($LASTEXITCODE -ne 0) { throw 'The deploy failed.' }

Write-Host ''
Write-Heading 'Live'

$url = gcloud run services describe $Service --region $Region --format 'value(status.url)'
Write-Metric 'URL' $url
Write-Host ''
Write-Note 'Every deploy creates an immutable revision. To split traffic 90/10:'
Write-Note "gcloud run services update-traffic $Service --to-revisions LATEST=10 --region $Region"
Write-Host ''
Write-Note 'If requests come back 400, the host is not authorized: check'
Write-Note 'security.allowedHosts in angular.json or the ALLOWED_HOSTS variable.'
Write-Host ''
