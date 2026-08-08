<#
.SYNOPSIS
  Passo 5 — deploy no Cloud Run.
.DESCRIPTION
  Corresponde aos slides 20 e 23. NÃO executa nada sem confirmação explícita:
  este é o único script da demo que gasta dinheiro e mexe num projeto real.

  Use -Simular (padrão) para só imprimir o comando, que é o suficiente para
  mostrar no palco. Passe -Executar para rodar de verdade.
.PARAMETER Executar
  Executa o deploy de fato. Sem esta flag o script apenas mostra o comando.
#>

param(
  [string]$Servico = 'angular-ssr',
  [string]$Regiao = 'southamerica-east1',
  [switch]$Executar
)

. "$PSScriptRoot\_comum.ps1"

$raiz = Get-RaizProjeto
Set-Location $raiz

Write-Titulo 'Deploy em um comando' 'slides 20 e 23'

# Montado como texto para caber no telão de forma legível.
$comando = @"
gcloud run deploy $Servico ``
    --source . ``
    --region $Regiao ``
    --allow-unauthenticated ``
    --cpu 1 --memory 512Mi ``
    --concurrency 80 ``
    --min-instances 1 --max-instances 20 ``
    --cpu-boost
"@

Write-Host $comando -ForegroundColor Cyan
Write-Host ''
Write-Nota '--source .        o Cloud Build empacota por você. Existe Dockerfile?'
Write-Nota '                  Ele usa o seu. Não existe? O buildpack detecta o Node.'
Write-Nota '--concurrency 80  uma instância atende 80 requisições simultâneas.'
Write-Nota '--min-instances 1 uma instância sempre quente: tira o cold start do'
Write-Nota '                  caminho do usuário. É o único item fixo da fatura.'
Write-Nota '--cpu-boost       CPU extra só durante a inicialização.'
Write-Host ''

# -----------------------------------------------------------------------------
# Verificações antes de qualquer coisa
# -----------------------------------------------------------------------------
$temGcloud = $null -ne (Get-Command gcloud -ErrorAction SilentlyContinue)

if (-not $temGcloud) {
  Write-Host '  gcloud não está instalado nesta máquina.' -ForegroundColor Yellow
  Write-Nota 'Instale em: https://cloud.google.com/sdk/docs/install'
  Write-Nota 'Para a demo, mostrar o comando acima já cumpre o papel do slide 20.'
  Write-Host ''
  return
}

if (-not $Executar) {
  Write-Host '  Modo simulação: nada foi executado.' -ForegroundColor Yellow
  Write-Nota 'Para rodar de verdade:  .\demo\5-deploy.ps1 -Executar'
  Write-Host ''
  return
}

# -----------------------------------------------------------------------------
# Confirmação — daqui para baixo mexe num projeto real e gera custo
# -----------------------------------------------------------------------------
$projeto = (gcloud config get-value project 2>$null)
$conta = (gcloud config get-value account 2>$null)

Write-Titulo 'Confirmação'
Write-Destaque 'Projeto' $projeto
Write-Destaque 'Conta' $conta
Write-Destaque 'Região' $Regiao
Write-Destaque 'Serviço' $Servico
Write-Host ''
Write-Host '  --min-instances 1 mantém uma instância ligada 24/7 e gera custo' -ForegroundColor Yellow
Write-Host '  contínuo, mesmo sem tráfego. Lembre de derrubar depois da palestra:' -ForegroundColor Yellow
Write-Nota "gcloud run services delete $Servico --region $Regiao"
Write-Host ''

$resposta = Read-Host "Digite o nome do serviço ($Servico) para confirmar o deploy"
if ($resposta -ne $Servico) {
  Write-Host '  Cancelado.' -ForegroundColor Yellow
  return
}

# -----------------------------------------------------------------------------
# Deploy
# -----------------------------------------------------------------------------
gcloud run deploy $Servico `
  --source . `
  --region $Regiao `
  --allow-unauthenticated `
  --cpu 1 --memory 512Mi `
  --concurrency 80 `
  --min-instances 1 --max-instances 20 `
  --cpu-boost

if ($LASTEXITCODE -ne 0) { throw 'O deploy falhou.' }

Write-Host ''
Write-Titulo 'No ar'

$url = gcloud run services describe $Servico --region $Regiao --format 'value(status.url)'
Write-Destaque 'URL' $url
Write-Host ''
Write-Nota 'Cada deploy cria uma revisão imutável. Para dividir tráfego 90/10:'
Write-Nota "gcloud run services update-traffic $Servico --to-revisions LATEST=10 --region $Regiao"
Write-Host ''
Write-Nota 'Se as requisições voltarem 400, o host não está autorizado: veja'
Write-Nota 'security.allowedHosts no angular.json ou a variável ALLOWED_HOSTS.'
Write-Host ''
