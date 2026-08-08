<#
.SYNOPSIS
  Passo 4 — muitas requisições simultâneas, uma instância só.
.DESCRIPTION
  Corresponde ao slide 13. Dispara N requisições em paralelo contra o mesmo
  container e conta quantas instâncias distintas responderam. A resposta é
  sempre: uma.

  Roda o teste em DOIS cenários, porque a diferença entre eles é o argumento
  de verdade a favor de --concurrency 80:

    A) Render puro, sem espera externa. É trabalho de CPU, e o Node tem uma
       thread só — então os renders se enfileiram. O pico de simultaneidade
       fica baixo mesmo com 50 clientes esperando.

    B) O mesmo render, agora com uma chamada externa no meio (RENDER_DELAY_MS).
       Enquanto uma requisição espera I/O, o event loop atende as outras. O
       pico de simultaneidade sobe para perto de N.

  Página real faz chamada de API, então o cenário B é o que acontece em
  produção — e é por isso que uma instância segura dezenas de requisições.
#>

param(
  [string]$Tag = 'angular-ssr-demo:local',
  [int]$Porta = 8080,
  [int]$Requisicoes = 50,
  [int]$AtrasoMs = 500
)

. "$PSScriptRoot\_comum.ps1"

Assert-Docker

$nome = 'ssr-concorrencia'
$base = "http://localhost:$Porta"

<#
.SYNOPSIS
  Sobe uma instância limpa, dispara a rajada e devolve as medições.
#>
function Measure-Rajada {
  param(
    [int]$Atraso,
    [string]$Rotulo
  )

  Remove-Container $nome

  $argumentos = @(
    'run', '-d', '--name', $nome,
    '-e', "PORT=$Porta",
    '-p', "${Porta}:${Porta}"
  )
  if ($Atraso -gt 0) { $argumentos += @('-e', "RENDER_DELAY_MS=$Atraso") }
  $argumentos += $Tag

  docker @argumentos | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao subir o container.' }

  $cliente = New-Cliente -TimeoutSegundos 120

  try {
    if ($null -eq (Wait-Servidor -Cliente $cliente -Url "$base/healthz")) {
      throw 'O container não respondeu ao /healthz em 60s.'
    }

    # Aquecimento: a primeira requisição paga o cold start, e aqui queremos
    # medir concorrência.
    $cliente.GetAsync("$base/").GetAwaiter().GetResult() | Out-Null

    Write-Passo "$Rotulo — disparando $Requisicoes requisições em paralelo"

    $cronometro = [System.Diagnostics.Stopwatch]::StartNew()

    $tipo = 'System.Collections.Generic.List[System.Threading.Tasks.Task[System.Net.Http.HttpResponseMessage]]'
    $tarefas = New-Object $tipo
    for ($i = 0; $i -lt $Requisicoes; $i++) {
      $tarefas.Add($cliente.GetAsync("$base/"))
    }

    [System.Threading.Tasks.Task]::WaitAll($tarefas.ToArray())
    $cronometro.Stop()

    $instancias = @{}
    $falhas = 0
    foreach ($tarefa in $tarefas) {
      $resposta = $tarefa.Result
      if (-not $resposta.IsSuccessStatusCode) { $falhas++; continue }

      $valor = $null
      if ($resposta.Headers.TryGetValues('X-Instance-Id', [ref]$valor)) {
        $id = ($valor -join '')
        if ($instancias.ContainsKey($id)) { $instancias[$id]++ } else { $instancias[$id] = 1 }
      }
    }

    $telemetria = $cliente.GetStringAsync("$base/api/instancia").GetAwaiter().GetResult() | ConvertFrom-Json

    return [pscustomobject]@{
      Rotulo      = $Rotulo
      TotalMs     = $cronometro.Elapsed.TotalMilliseconds
      Instancias  = $instancias.Count
      Pico        = $telemetria.peakInFlight
      Concluidas  = $Requisicoes - $falhas
      Falhas      = $falhas
      # Quanto levaria se cada requisição esperasse a anterior terminar.
      SerialMs    = $Requisicoes * $Atraso
    }
  } finally {
    $cliente.Dispose()
    Remove-Container $nome
  }
}

try {
  Write-Titulo "$Requisicoes requisições ao mesmo tempo, uma instância só" 'slide 13'

  $a = Measure-Rajada -Atraso 0 -Rotulo 'A) Render puro (CPU)'
  Write-Host ''
  $b = Measure-Rajada -Atraso $AtrasoMs -Rotulo "B) Com chamada externa de ${AtrasoMs}ms"

  Write-Titulo 'Resultado'

  $formato = '  {0,-32} {1,10} {2,10}'
  Write-Host ($formato -f '', 'CENÁRIO A', 'CENÁRIO B') -ForegroundColor DarkGray
  Write-Host ($formato -f 'Requisições concluídas', $a.Concluidas, $b.Concluidas) -ForegroundColor White
  Write-Host ($formato -f 'Instâncias que responderam', $a.Instancias, $b.Instancias) -ForegroundColor Green
  Write-Host ($formato -f 'Pico de requisições simultâneas', $a.Pico, $b.Pico) -ForegroundColor Green
  Write-Host ($formato -f 'Tempo total da rajada', ('{0:N0} ms' -f $a.TotalMs), ('{0:N0} ms' -f $b.TotalMs)) -ForegroundColor White

  Write-Host ''
  Write-Nota 'A) Render é trabalho de CPU e o Node tem uma thread só: os renders'
  Write-Nota '   se enfileiram, então o pico de simultaneidade fica baixo.'
  Write-Host ''
  Write-Nota "B) Com I/O no meio, a instância segura $($b.Pico) requisições ao mesmo tempo."

  if ($b.SerialMs -gt 0) {
    $ganho = $b.SerialMs / $b.TotalMs
    Write-Nota ('   Uma de cada vez levaria {0:N0} ms; levou {1:N0} ms — {2:N0}x mais rápido.' -f `
        $b.SerialMs, $b.TotalMs, $ganho)
  }

  Write-Host ''
  Write-Nota 'Nos dois casos: UMA instância. É isso que --concurrency 80 compra —'
  Write-Nota 'menos instâncias para o mesmo tráfego, e menos instâncias é menos'
  Write-Nota 'fatura. Baixar a concorrência para 1 multiplicaria o custo sem ganho.'
  Write-Host ''
} finally {
  Remove-Container $nome
}
