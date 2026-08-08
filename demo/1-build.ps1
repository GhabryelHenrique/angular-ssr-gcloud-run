<#
.SYNOPSIS
  Passo 1 — o build do SSR produz um artefato só: estáticos + servidor Node.
.DESCRIPTION
  Corresponde ao slide 17. Roda o `ng build` e mostra a árvore do dist,
  separando o que vai para o navegador do que roda no servidor.
#>

. "$PSScriptRoot\_comum.ps1"

$raiz = Get-RaizProjeto
Set-Location $raiz

Write-Titulo 'O build do SSR' 'slide 17'

Write-Passo 'ng build'
Write-Nota 'Um comando só. Sem webpack custom, sem config de bundler.'
Write-Host ''

$cronometro = [System.Diagnostics.Stopwatch]::StartNew()
npm run build
$cronometro.Stop()

if ($LASTEXITCODE -ne 0) { throw 'O build falhou.' }

$dist = Join-Path $raiz 'dist\poc-cloud-run'
$browser = Join-Path $dist 'browser'
$server = Join-Path $dist 'server'

Write-Titulo 'O que saiu do build'

function Get-Tamanho {
  param([string]$Caminho)
  if (-not (Test-Path $Caminho)) { return 0 }
  (Get-ChildItem $Caminho -Recurse -File | Measure-Object -Property Length -Sum).Sum
}

$tamanhoBrowser = Get-Tamanho $browser
$tamanhoServer = Get-Tamanho $server

Write-Host '  dist/poc-cloud-run/' -ForegroundColor White
Write-Host ('    browser/   {0,-12} ' -f (Format-Bytes $tamanhoBrowser)) -NoNewline -ForegroundColor Cyan
Write-Host 'estáticos com hash + rotas prerenderizadas' -ForegroundColor DarkGray
Write-Host ('    server/    {0,-12} ' -f (Format-Bytes $tamanhoServer)) -NoNewline -ForegroundColor Cyan
Write-Host 'server.mjs — o processo Node que renderiza' -ForegroundColor DarkGray
Write-Host ''

# As rotas Prerender viram arquivos .html de verdade dentro do browser/.
$prerenderizados = Get-ChildItem $browser -Recurse -Filter '*.html' -File |
  Where-Object { $_.Name -ne 'index.csr.html' }

if ($prerenderizados) {
  Write-Passo 'Rotas congeladas no build (RenderMode.Prerender)'
  foreach ($arquivo in $prerenderizados) {
    $relativo = $arquivo.FullName.Substring($browser.Length + 1)
    Write-Nota ("{0,-34} {1}" -f $relativo, (Format-Bytes $arquivo.Length))
  }
  Write-Host ''
}

Write-Passo 'Ponto de entrada do servidor'
$entrada = Join-Path $server 'server.mjs'
Write-Nota "node dist/poc-cloud-run/server/server.mjs   ($(Format-Bytes (Get-Item $entrada).Length))"
Write-Host ''

Write-Destaque 'Tempo de build' ('{0:N1}s' -f $cronometro.Elapsed.TotalSeconds)
Write-Destaque 'Total do artefato' (Format-Bytes ($tamanhoBrowser + $tamanhoServer))
Write-Host ''
Write-Nota 'É este diretório inteiro que entra na imagem Docker — e nada mais.'
Write-Host ''
