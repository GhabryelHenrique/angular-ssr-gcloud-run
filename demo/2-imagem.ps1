<#
.SYNOPSIS
  Passo 2 — empacota o build num container e mede o resultado.
.DESCRIPTION
  Corresponde aos slides 18 e 19. Constrói a imagem duas vezes para deixar
  visível o efeito do cache de camadas: a segunda passada não reinstala nada.
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  # Mede também um build totalmente sem cache. É o número honesto do "custo
  # real", mas leva um a dois minutos — pesado para rodar ao vivo.
  [switch]$SemCache
)

. "$PSScriptRoot\_comum.ps1"

$raiz = Get-RaizProjeto
Set-Location $raiz

Assert-Docker

Write-Titulo 'Do código ao container' 'slides 18 e 19'

# --- Tamanho do contexto enviado ao daemon -----------------------------------
Write-Passo 'Contexto de build'
$pptx = Get-ChildItem $raiz -Filter '*.pptx' -File -ErrorAction SilentlyContinue |
  Measure-Object -Property Length -Sum
if ($pptx.Sum) {
  Write-Nota "O .dockerignore está barrando $(Format-Bytes $pptx.Sum) só de slides."
}
Write-Nota 'node_modules, .angular, .git e dist também ficam de fora.'
Write-Host ''

# --- Build sem cache nenhum (opcional) ---------------------------------------
$semCacheSegundos = $null

if ($SemCache) {
  Write-Passo 'docker build --no-cache — o custo real, sem reaproveitar nada'
  Write-Host ''

  $relogioFrio = [System.Diagnostics.Stopwatch]::StartNew()
  docker build --no-cache -t $Tag . | Out-Null
  $relogioFrio.Stop()

  if ($LASTEXITCODE -ne 0) { throw 'O docker build --no-cache falhou.' }
  $semCacheSegundos = $relogioFrio.Elapsed.TotalSeconds

  Write-Nota ('{0:N1}s — é isso que a CI paga quando o cache não existe.' -f $semCacheSegundos)
  Write-Host ''
}

# --- Build normal ------------------------------------------------------------
Write-Passo "docker build -t $Tag ."
Write-Host ''

$cronometro = [System.Diagnostics.Stopwatch]::StartNew()
docker build -t $Tag .
$cronometro.Stop()

if ($LASTEXITCODE -ne 0) { throw 'O docker build falhou.' }
$comCache = $cronometro.Elapsed.TotalSeconds

# --- Resultado ---------------------------------------------------------------
Write-Titulo 'A imagem'

$tamanho = docker images $Tag --format '{{.Size}}'

Write-Destaque 'Tamanho final' $tamanho

if ($null -ne $semCacheSegundos) {
  Write-Destaque 'Build sem cache' ('{0:N1}s' -f $semCacheSegundos)
  Write-Destaque 'Build com cache' ('{0:N1}s' -f $comCache)
  if ($comCache -gt 0) {
    Write-Destaque 'Ganho do cache' ('{0:N1}x mais rápido' -f ($semCacheSegundos / $comCache))
  }
} else {
  Write-Destaque 'Build (camadas em cache)' ('{0:N1}s' -f $comCache)
  Write-Nota 'Rode com -SemCache para medir também o build do zero.'
}

Write-Host ''
Write-Passo 'Camadas da imagem final'

# Separador explícito: dentro de aspas simples a crase não escapa nada, então
# um "`t" sairia literal no terminal.
docker history $Tag --format '{{.Size}}|{{.CreatedBy}}' --no-trunc |
  Select-Object -First 6 |
  ForEach-Object {
    $partes = $_ -split '\|', 2
    $comando = $partes[1]
    if ($comando.Length -gt 56) { $comando = $comando.Substring(0, 56) + '…' }
    Write-Nota ('{0,-10} {1}' -f $partes[0], $comando)
  }

Write-Host ''
Write-Nota 'Repare no que NÃO está aqui: node_modules. O builder do Angular embute'
Write-Nota 'o Express dentro do server.mjs, então a imagem final só carrega o dist.'
Write-Host ''
