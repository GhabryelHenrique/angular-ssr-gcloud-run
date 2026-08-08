# Angular SSR na AWS Lambda — o que o Cloud Run não pediu

Material de apoio do **slide 14**. O objetivo desta pasta não é competir com o
Cloud Run: é tornar concreto o custo de adaptação, mostrando o código que
precisou existir de um lado e não do outro.

## O placar

| | Cloud Run | AWS Lambda |
|---|---|---|
| Entry point de SSR | `src/server.ts`, **gerado pelo `ng add`** | `lambda/server.lambda.ts`, escrito à mão |
| Configuração de build | a padrão | uma configuração `lambda` extra no `angular.json` |
| Adaptação de protocolo | nenhuma | `handler.mjs` — 120 linhas traduzindo evento ↔ HTTP |
| Infraestrutura | um comando `gcloud run deploy` | `template.yaml` (SAM) |
| Streaming de HTML | padrão | só via Function URL com `InvokeMode: RESPONSE_STREAM` |
| Requisições por instância | até 80 simultâneas | **uma por execução** |
| Teto de resposta | o do HTTP | 6 MB bufferizado / 20 MB com streaming |
| Estáticos (JS, CSS) | o mesmo container serve | na prática, CloudFront + S3 na frente |

O ponto do slide 14 em uma frase: **no Cloud Run, o artefato que roda no seu
terminal é o mesmo que roda em produção.** No Lambda, existe uma camada de
tradução no meio — e essa camada é código seu, que você mantém e depura.

## Os arquivos

| Arquivo | Para quê |
|---|---|
| `server.lambda.ts` | Entry point alternativo. Usa `AngularAppEngine` (API web-standard) em vez de `AngularNodeAppEngine`. |
| `handler.mjs` | Converte o evento da AWS em `Request` e o `Response` de volta em resposta Lambda. Traz a versão bufferizada e a de streaming. |
| `Dockerfile` | Imagem sobre `public.ecr.aws/lambda/nodejs:22`, não sobre o Node oficial. |
| `template.yaml` | SAM: função, Function URL, alias e concorrência provisionada. |

## Rodando local, sem conta AWS

O build do Lambda **sobrescreve** o `dist/`, então rebuilde o normal depois:

```powershell
# 1. Gera o dist com o entry point do Lambda
npm run build:lambda

# 2. Monta o layout que o Lambda espera (handler.mjs ao lado de dist/)
$t = "$env:TEMP\lambda-teste"
New-Item -ItemType Directory -Force $t | Out-Null
Copy-Item .\dist "$t\dist" -Recurse -Force
Copy-Item .\lambda\handler.mjs "$t\handler.mjs" -Force

# 3. Invoca com um evento sintético de Function URL
$env:ALLOWED_HOSTS = "abc123.lambda-url.us-east-1.on.aws"
# (veja o snippet de invocação no README da raiz)

# 4. IMPORTANTE: devolve o dist para a variante do Cloud Run
npm run build
```

Resultado verificado nesta máquina: `statusCode 200`, `17.309 bytes` de HTML com
o catálogo renderizado, em `205 ms`.

## Duas ressalvas honestas

**1. A telemetria não foi portada.** O `src/server.ts` do Cloud Run instrumenta
cada requisição (instância, cold start, contadores, log JSON) e injeta esses
dados no render via `REQUEST_CONTEXT`. O `server.lambda.ts` não faz isso — a
barra de telemetria cai no modo "sem dados do servidor" quando servida pelo
Lambda.

Isso não é descuido, é o argumento: **cada entry point carrega a sua própria
instrumentação.** Manter os dois significa escrever e manter duas vezes.

**2. O `allowedHosts` precisou ser repetido.** Cada engine tem a sua instância,
então a proteção anti-SSRF do Angular 22 teve de ser configurada nos dois
arquivos. Esquecer num deles faz toda requisição voltar `400` — e só depois do
deploy, quando o domínio real aparece.

## Quando o Lambda é a escolha certa

Nada aqui diz que o Lambda é ruim. Ele ganha quando:

- a organização já é toda AWS, com IAM, VPC e observabilidade montados ali;
- o tráfego é muito esporádico e a granularidade de cobrança por invocação
  compensa;
- a aplicação já vive atrás de CloudFront, que resolve os estáticos e o cache.

O que o slide 14 defende é mais estreito: **para hospedar Angular SSR
especificamente**, o Cloud Run pede menos código porque o artefato do Angular
já é exatamente o que ele espera — um processo HTTP num container.
