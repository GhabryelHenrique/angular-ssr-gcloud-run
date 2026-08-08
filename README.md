# Deploy Serverless de Angular SSR — POC de demonstração

Demo ao vivo da palestra **"Deploy Serverless de Angular SSR: escalabilidade
automática com Google Cloud Run"** (slide 27 — *Mão na massa*).

Angular **22.1.3** · Node **22** · roda inteiro em Docker local, sem nuvem e
sem rede.

---

## O que esta POC prova

Cada tese do deck vira um número na tela, não uma afirmação:

| Slide | Tese | Onde se prova |
|---|---|---|
| 5, 8 | SSR devolve HTML pronto; prerender basta para estático | 3 rotas com `RenderMode` diferente, comparadas no `view-source:` |
| 13 | `PORT` injetada, container comum, concorrência alta | `demo\4-concorrencia.ps1` |
| 17 | O build gera estáticos + servidor Node | `demo\1-build.ps1` |
| 18, 19 | Multi-stage, imagem enxuta, cache de camadas | `demo\2-imagem.ps1` |
| 20, 21 | Deploy em um comando; pipeline de CI/CD | `demo\5-deploy.ps1`, `cloudbuild.yaml` |
| 22, 23, 24 | Cold start decomposto; frio vs quente | `demo\3-coldstart.ps1` |
| 26 | Log estruturado em JSON | `docker logs` de qualquer container da demo |
| 14 | O Lambda exige adaptação que o Cloud Run dispensa | [`lambda/`](lambda/README.md) |

## Números medidos nesta máquina

Para você saber o que esperar no palco (Docker Desktop, Windows 11, Node 24):

| Medição | Valor |
|---|---|
| Primeiro acesso, instância fria | **261 ms** |
| Acessos seguintes, instância quente | **19 ms** (mediana) |
| Diferença | **14,1x** |
| Imagem final | **235 MB** (2,37 MB são o seu código) |
| HTML da rota SSR | **18.896 bytes**, catálogo incluso |
| HTML da rota CSR | **1.198 bytes**, casca vazia |
| 50 requisições paralelas | **1 instância**, pico de 50 simultâneas |

---

## Antes de subir ao palco

```powershell
npm install
npm run build
docker build -t angular-ssr-demo:local .
```

Deixe o **Docker Desktop já aberto**: ele leva ~30s para subir e é o único
pré-requisito real da demo.

---

## Roteiro da demo

Os scripts são numerados na ordem de apresentação. Todos aceitam `-?` para ver
os parâmetros.

### 1. O build (slide 17)

```powershell
.\demo\1-build.ps1
```

Mostra o `dist/` separado em `browser/` (estáticos + rotas prerenderizadas) e
`server/` (o processo Node). Repare no `sobre/index.html`: é a rota `Prerender`
virando arquivo de verdade no build.

### 2. A imagem (slides 18 e 19)

```powershell
.\demo\2-imagem.ps1
# ou, para medir também o build do zero (leva ~1-2 min):
.\demo\2-imagem.ps1 -SemCache
```

O ponto alto é a lista de camadas: **2,37 MB de código e nenhum `node_modules`**.
O builder do Angular embute o Express dentro do `server.mjs`, então a imagem
final carrega só o `dist`.

### 3. O cold start (slides 22, 23 e 24)

```powershell
.\demo\3-coldstart.ps1

# Para encenar um backend lento inflando o estágio 3:
.\demo\3-coldstart.ps1 -AtrasoMs 800
```

Decompõe o cold start nos quatro estágios do slide 22 e fecha com a comparação
frio × quente do slide 24.

### 4. A concorrência (slide 13)

```powershell
.\demo\4-concorrencia.ps1
```

Roda **dois cenários** e a diferença entre eles é o argumento inteiro:

- **A) Render puro** — trabalho de CPU, e o Node tem uma thread só. Os renders
  se enfileiram e o pico de simultaneidade fica em ~3.
- **B) Com chamada externa de 500 ms** — enquanto uma requisição espera I/O, o
  event loop atende as outras. Pico de **50** simultâneas, e a rajada que
  levaria 25 s em série termina em ~1 s.

Página real chama API, então o cenário B é o de produção. É por isso que
`--concurrency 80` faz sentido para SSR.

### 5. As três modalidades de render (slides 5, 8 e 15)

```powershell
docker run --rm -e PORT=8080 -p 8080:8080 angular-ssr-demo:local
```

Abra `view-source:` em cada rota — é o momento mais visual da apresentação:

| Rota | Modo | O que aparece no `view-source:` |
|---|---|---|
| `http://localhost:8080/` | `Server` | ~18.900 bytes, os 12 produtos no HTML |
| `http://localhost:8080/sobre` | `Prerender` | HTML completo, congelado no build |
| `http://localhost:8080/painel` | `Client` | **~1.200 bytes**, `<app-root>` vazio |

A barra de telemetria no topo mostra, a cada recarga: origem do render, tempo,
identificador da instância, número da requisição, **COLD START/QUENTE**, `PORT`
e a concorrência do momento.

Vale recarregar `/sobre` algumas vezes: o carimbo de data **não muda**, porque
é do build — o limite do prerender, ao vivo.

### 6. Os logs estruturados (slide 26)

```powershell
docker logs <container>
```

Uma linha JSON por requisição, no formato que o Cloud Logging indexa
nativamente: `severity`, `renderMs`, `coldStart`, `requestNumber`, `status`. Se
houver `GOOGLE_CLOUD_PROJECT`, o campo de trace é preenchido e o log passa a
correlacionar com o Cloud Trace.

### 7. O deploy (slides 20 e 21)

```powershell
.\demo\5-deploy.ps1              # só imprime o comando — não executa nada
.\demo\5-deploy.ps1 -Executar    # exige gcloud e confirmação digitada
```

O `cloudbuild.yaml` cobre o slide 21: build com cache, push para o Artifact
Registry e deploy, com cada revisão imutável.

---

## Duas armadilhas do Angular 22 que valem palco

### 1. `allowedHosts` vazio derruba o deploy

O `ng new --ssr` gera isto no `angular.json`:

```json
"security": { "allowedHosts": [] }
```

Com a lista vazia, o Angular 22 responde **400 Bad Request a qualquer host** —
é a proteção contra SSRF. Localmente ninguém percebe, porque `ng serve` trata
isso à parte. Aí você faz o deploy e **toda requisição volta 400**.

Nesta POC a lista está preenchida:

```json
"security": { "allowedHosts": ["localhost", "127.0.0.1", "*.run.app"] }
```

E como o domínio próprio nem sempre é conhecido no momento do build, o
`src/server.ts` aceita hosts extras por variável de ambiente:

```powershell
gcloud run services update angular-ssr --set-env-vars ALLOWED_HOSTS=loja.exemplo.com
```

### 2. Node 20 não roda Angular 22

O `@angular/core@22` declara `engines: ^22.22.3 || ^24.15.0 || >=26.0.0`. O
suporte ao Node 20 foi removido, e o `node:20-alpine` que aparece em muitos
tutoriais falha no `npm ci`. Por isso o `Dockerfile` desta POC usa
`node:22-alpine`.

> **Os slides 13 e 18 do deck ainda mencionam "Node 20".** Vale corrigir para
> 22 antes da apresentação — alguém na plateia vai tentar reproduzir.

---

## Variáveis de ambiente

| Variável | Padrão | Para quê |
|---|---|---|
| `PORT` | `8080` | Porta de escuta. No Cloud Run é **injetada** — nunca fixe no código. |
| `ALLOWED_HOSTS` | vazio | Hosts extras liberados, separados por vírgula. Somado ao `angular.json`. |
| `TRUST_PROXY_HEADERS` | `false` | Só ligue com um proxy confiável na frente (Cloud CDN, balanceador). |
| `RENDER_DELAY_MS` | `0` | Atraso artificial no carregamento de dados, para encenar o estágio 3 do cold start. |
| `K_SERVICE`, `K_REVISION` | — | Injetadas pelo Cloud Run. Alimentam a barra de telemetria. |
| `GOOGLE_CLOUD_PROJECT` | — | Habilita a correlação de trace nos logs. |

---

## Estrutura

```
├── src/
│   ├── server.ts                    ← telemetria, log JSON, /healthz, /api/instancia
│   ├── index.html
│   └── app/
│       ├── app.routes.server.ts     ← Server | Prerender | Client (o coração da demo)
│       ├── core/
│       │   ├── telemetry.ts         ← REQUEST_CONTEXT → TransferState
│       │   └── catalog.ts
│       ├── shared/telemetry-bar/    ← a barra fixa do topo
│       └── pages/{catalogo,produto,sobre,painel}/
├── demo/                            ← os 5 scripts de palco
├── lambda/                          ← a comparação do slide 14
├── Dockerfile                       ← multi-stage, node:22-alpine
├── .dockerignore                    ← barra os 17 MB do .pptx, entre outros
└── cloudbuild.yaml                  ← pipeline de CI/CD
```

## Plano B

| Se falhar | Faça |
|---|---|
| Docker não sobe | `npm run build; npm run start:ssr` — a demo toda funciona sem container, menos o cold start |
| Porta 8080 ocupada | Todos os scripts aceitam `-Porta 8090` |
| Sem rede | Nada aqui precisa de internet depois do `npm install` |
| `gcloud` ausente | `5-deploy.ps1` detecta e só imprime o comando |
| Acentuação quebrada nos scripts | Os `.ps1` precisam ser UTF-8 **com BOM** para o Windows PowerShell 5.1 |
