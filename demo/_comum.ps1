# Helpers compartilhados pelos scripts da demo.
# Carregado com: . "$PSScriptRoot\_comum.ps1"

# 'Continue', não 'Stop': no Windows PowerShell 5.1 qualquer coisa que um
# executável nativo escreva em stderr vira NativeCommandError e mataria o
# script — e o docker usa stderr para progresso normal. Aqui o controle de
# falha é explícito, via $LASTEXITCODE.
$ErrorActionPreference = 'Continue'

# O Windows PowerShell 5.1 não carrega System.Net.Http por padrão. Usamos
# HttpClient em vez de Invoke-WebRequest porque a demo precisa de precisão de
# milissegundos e de disparar dezenas de requisições realmente em paralelo.
Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue

# Cores aproximando a paleta do deck no terminal.
$script:CorTitulo = 'Green'
$script:CorDado = 'Cyan'
$script:CorAviso = 'Yellow'
$script:CorFraco = 'DarkGray'

function Write-Titulo {
  param([string]$Texto, [string]$Slide = '')

  $sufixo = if ($Slide) { "  [$Slide]" } else { '' }
  Write-Host ''
  Write-Host ('═' * 78) -ForegroundColor $script:CorTitulo
  Write-Host "  $Texto$sufixo" -ForegroundColor $script:CorTitulo
  Write-Host ('═' * 78) -ForegroundColor $script:CorTitulo
  Write-Host ''
}

function Write-Passo {
  param([string]$Texto)
  Write-Host "→ $Texto" -ForegroundColor $script:CorDado
}

function Write-Nota {
  param([string]$Texto)
  Write-Host "  $Texto" -ForegroundColor $script:CorFraco
}

function Write-Destaque {
  param([string]$Rotulo, [string]$Valor)
  Write-Host ("  {0,-34} " -f $Rotulo) -NoNewline -ForegroundColor $script:CorFraco
  Write-Host $Valor -ForegroundColor $script:CorTitulo
}

function Get-RaizProjeto {
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
  Faz uma requisição e devolve o tempo total, o status e o Server-Timing.
.DESCRIPTION
  Usa HttpClient em vez de Invoke-WebRequest porque precisamos de precisão de
  milissegundos e da leitura de headers customizados sem o overhead do parser
  de HTML do PowerShell.
#>
function Invoke-Medido {
  param(
    [Parameter(Mandatory)][System.Net.Http.HttpClient]$Cliente,
    [Parameter(Mandatory)][string]$Url
  )

  $cronometro = [System.Diagnostics.Stopwatch]::StartNew()
  $resposta = $Cliente.GetAsync($Url).GetAwaiter().GetResult()
  $corpo = $resposta.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  $cronometro.Stop()

  $renderMs = $null
  $cabecalho = $null
  if ($resposta.Headers.TryGetValues('Server-Timing', [ref]$cabecalho)) {
    if (($cabecalho -join '') -match 'dur=(\d+)') { $renderMs = [int]$Matches[1] }
  }

  $instancia = $null
  $valorInstancia = $null
  if ($resposta.Headers.TryGetValues('X-Instance-Id', [ref]$valorInstancia)) {
    $instancia = ($valorInstancia -join '')
  }

  [pscustomobject]@{
    TotalMs   = [math]::Round($cronometro.Elapsed.TotalMilliseconds, 1)
    RenderMs  = $renderMs
    Status    = [int]$resposta.StatusCode
    Bytes     = $corpo.Length
    Instancia = $instancia
  }
}

function New-Cliente {
  param(
    [int]$TimeoutSegundos = 30,
    [int]$ConexoesMaximas = 200
  )

  # O .NET Framework limita a DUAS conexões simultâneas por host. Sem levantar
  # esse teto, o teste de concorrência mediria o limite do cliente, não o do
  # servidor — e a instância pareceria atender 2 requisições de cada vez.
  [System.Net.ServicePointManager]::DefaultConnectionLimit = $ConexoesMaximas

  $manipulador = [System.Net.Http.HttpClientHandler]::new()
  try {
    $manipulador.MaxConnectionsPerServer = $ConexoesMaximas
  } catch {
    # Propriedade ausente em runtimes antigos; o ServicePointManager acima
    # já resolve nesses casos.
  }

  $cliente = [System.Net.Http.HttpClient]::new($manipulador)
  $cliente.Timeout = [TimeSpan]::FromSeconds($TimeoutSegundos)
  return $cliente
}

function Assert-Docker {
  docker info 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw 'O daemon do Docker não está respondendo. Abra o Docker Desktop e tente de novo.'
  }
}

<#
.SYNOPSIS
  Remove um container, sem reclamar se ele não existir.
.DESCRIPTION
  `docker rm -f` de um container inexistente escreve em stderr. Consultar
  antes evita esse ruído no meio da demo.
#>
function Remove-Container {
  param([Parameter(Mandatory)][string]$Nome)

  $existente = docker ps -aq --filter "name=^/$Nome$" 2>&1
  if ($LASTEXITCODE -eq 0 -and $existente) {
    docker rm -f $Nome 2>&1 | Out-Null
  }
}

<#
.SYNOPSIS
  Espera o servidor aceitar conexões, devolvendo em quanto tempo ficou pronto.
.OUTPUTS
  Milissegundos até a primeira resposta bem-sucedida, ou $null se estourou.
#>
function Wait-Servidor {
  param(
    [Parameter(Mandatory)][System.Net.Http.HttpClient]$Cliente,
    [Parameter(Mandatory)][string]$Url,
    [System.Diagnostics.Stopwatch]$Cronometro,
    [int]$TimeoutSegundos = 60
  )

  if (-not $Cronometro) { $Cronometro = [System.Diagnostics.Stopwatch]::StartNew() }

  while ($Cronometro.Elapsed.TotalSeconds -lt $TimeoutSegundos) {
    try {
      $resposta = $Cliente.GetAsync($Url).GetAwaiter().GetResult()
      if ($resposta.IsSuccessStatusCode) { return $Cronometro.Elapsed.TotalMilliseconds }
    } catch {
      # Conexão recusada enquanto o processo ainda não escuta: esperado.
    }
    Start-Sleep -Milliseconds 25
  }

  return $null
}
