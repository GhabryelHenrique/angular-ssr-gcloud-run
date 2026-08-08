<#
.SYNOPSIS
  Passo 3 — mede o cold start decomposto, e compara com a instância quente.
.DESCRIPTION
  Corresponde aos slides 22, 23 e 24. Sobe um container do zero e cronometra
  cada estágio do cold start, depois mede a mesma rota já com a instância
  quente. Roda inteiro em Docker local: não precisa de nuvem nem de rede.

  O container local não reproduz a latência de rede nem o download das camadas
  de imagem que o Cloud Run paga no estágio 1 — os números absolutos lá são
  maiores. O que a demo reproduz fielmente é a PROPORÇÃO: a primeira
  requisição custa uma ordem de grandeza a mais que as seguintes.
.PARAMETER AtrasoMs
  Liga o RENDER_DELAY_MS no container, simulando um backend lento no meio do
  render (estágio 3 do slide 22).
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  [int]$Porta = 8080,
  [int]$AtrasoMs = 0,
  [int]$Repeticoes = 20
)

. "$PSScriptRoot\_comum.ps1"

Assert-Docker

$nome = 'ssr-coldstart'
$base = "http://localhost:$Porta"

# Garante que a próxima instância é realmente nova.
Remove-Container $nome

Write-Titulo 'Cold start, estágio por estágio' 'slides 22 e 24'

if ($AtrasoMs -gt 0) {
  Write-Nota "RENDER_DELAY_MS=$AtrasoMs — simulando um backend lento no render."
  Write-Host ''
}

$cliente = New-Cliente

try {
  # =========================================================================
  # Estágios 1 e 2 — provisionar a instância e subir o Node
  # =========================================================================
  Write-Passo '01+02  Provisionar a instância e subir o Node'

  $relogio = [System.Diagnostics.Stopwatch]::StartNew()

  $argumentos = @(
    'run', '-d', '--name', $nome,
    '-e', "PORT=$Porta",
    '-p', "${Porta}:${Porta}"
  )
  if ($AtrasoMs -gt 0) { $argumentos += @('-e', "RENDER_DELAY_MS=$AtrasoMs") }
  $argumentos += $Tag

  docker @argumentos | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir o container.' }

  $containerCriadoMs = $relogio.Elapsed.TotalMilliseconds

  # Espera o processo aceitar a primeira conexão. É exatamente o que o Cloud
  # Run faz antes de encaminhar tráfego para uma instância nova.
  $prontoMs = Wait-Servidor -Cliente $cliente -Url "$base/healthz" -Cronometro $relogio

  if ($null -eq $prontoMs) { throw 'O container não respondeu ao /healthz em 60s.' }

  Write-Nota ('container criado          {0,8:N0} ms' -f $containerCriadoMs)
  Write-Nota ('primeira conexão aceita   {0,8:N0} ms' -f $prontoMs)
  Write-Host ''

  # =========================================================================
  # Estágio 3 — o primeiro render
  # =========================================================================
  Write-Passo '03     Primeiro render (esta requisição pagou o cold start)'

  $frio = Invoke-Medido -Cliente $cliente -Url "$base/"
  Write-Nota ('total do lado do cliente  {0,8:N0} ms' -f $frio.TotalMs)
  Write-Nota ('só o render no servidor   {0,8:N0} ms' -f $frio.RenderMs)
  Write-Nota ("HTML devolvido            {0,8} bytes" -f $frio.Bytes)
  Write-Host ''

  # =========================================================================
  # Estágio 4 — instância quente
  # =========================================================================
  Write-Passo "04     Instância quente ($Repeticoes requisições na mesma rota)"

  $totais = @()
  $renders = @()
  for ($i = 0; $i -lt $Repeticoes; $i++) {
    $m = Invoke-Medido -Cliente $cliente -Url "$base/"
    $totais += $m.TotalMs
    if ($null -ne $m.RenderMs) { $renders += $m.RenderMs }
  }

  $ordenados = $totais | Sort-Object
  $mediana = $ordenados[[int]($ordenados.Count / 2)]
  $p95 = $ordenados[[math]::Min($ordenados.Count - 1, [int][math]::Ceiling($ordenados.Count * 0.95) - 1)]
  $medianaRender = ($renders | Sort-Object)[[int]($renders.Count / 2)]

  Write-Nota ('mediana total             {0,8:N0} ms' -f $mediana)
  Write-Nota ('p95 total                 {0,8:N0} ms' -f $p95)
  Write-Nota ('mediana só do render      {0,8:N0} ms' -f $medianaRender)
  Write-Host ''

  # =========================================================================
  # Veredicto
  # =========================================================================
  Write-Titulo 'Frio contra quente' 'slide 24'

  Write-Destaque 'Primeiro acesso (instância fria)' ('{0:N0} ms' -f $frio.TotalMs)
  Write-Destaque 'Acessos seguintes (quente)' ('{0:N0} ms' -f $mediana)

  if ($mediana -gt 0) {
    Write-Destaque 'Diferença' ('{0:N1}x' -f ($frio.TotalMs / $mediana))
  }

  Write-Host ''
  Write-Nota 'O cold start não desaparece — ele sai do caminho do usuário.'
  Write-Nota '--min-instances 1 mantém uma instância quente e faz o primeiro'
  Write-Nota 'acesso cair na coluna da direita. É o ajuste do slide 23.'
  Write-Host ''

  if ($AtrasoMs -eq 0) {
    Write-Nota 'Dica: rode com -AtrasoMs 800 para ver um backend lento inflar o'
    Write-Nota 'estágio 3 — e note que isso NÃO é culpa do SSR.'
    Write-Host ''
  }
} finally {
  $cliente.Dispose()
  Remove-Container $nome
}
