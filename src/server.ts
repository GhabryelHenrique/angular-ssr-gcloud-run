import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ServerRenderContext } from './app/core/telemetry';

const browserDistFolder = join(import.meta.dirname, '../browser');

/**
 * Hosts extras liberados em tempo de execução, separados por vírgula.
 *
 * O Angular 22 recusa com 400 qualquer requisição cujo `Host` não esteja
 * autorizado — é a proteção contra SSRF. A lista base fica no `angular.json`
 * (`security.allowedHosts`) e já cobre `localhost` e `*.run.app`.
 *
 * O problema é que a lista do `angular.json` é decidida no BUILD, e o domínio
 * próprio muitas vezes só se conhece depois. Sem esta variável, apontar um
 * domínio para o serviço exigiria rebuildar a imagem. Com ela, é só um
 * `gcloud run services update --set-env-vars ALLOWED_HOSTS=loja.exemplo.com`.
 */
const allowedHosts = (process.env['ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const app = express();
const angularApp = new AngularNodeAppEngine({
  // Somado à lista do angular.json, não substitui.
  allowedHosts,
  /**
   * Só confie em X-Forwarded-* se houver de fato um proxy confiável na frente
   * (Cloud CDN, balanceador). O Cloud Run puro preserva o `Host`, então o
   * padrão aqui é `false` — ligar sem proxy deixaria o cliente forjar o host.
   */
  trustProxyHeaders: process.env['TRUST_PROXY_HEADERS'] === 'true',
});

// ---------------------------------------------------------------------------
// Identidade e contadores do processo
//
// Tudo aqui vive na memória de UMA instância. Quando o Cloud Run recicla o
// container, esse estado morre junto — e é exatamente isso que a demo mostra:
// `instanceId` mudando é a prova visual de que uma instância nova subiu.
// ---------------------------------------------------------------------------

/** Muda a cada processo novo. É o "impressão digital" da instância no telão. */
const instanceId = randomUUID().slice(0, 8);

/** `Date.now()` no instante em que o módulo foi avaliado — estágio 2 do slide 22. */
const bootTime = Date.now();

const K_SERVICE = process.env['K_SERVICE'] ?? '';
const K_REVISION = process.env['K_REVISION'] ?? '';

/**
 * A variável PORT (slide 13).
 *
 * O Cloud Run injeta PORT no ambiente e espera que o container escute nela.
 * Fixar a porta no código é o erro que faz o deploy falhar com "the container
 * failed to start and listen on the port". O padrão 8080 aqui é só para rodar
 * na sua máquina — em produção quem manda é o ambiente.
 */
const port = Number(process.env['PORT'] ?? 8080);

/** `K_SERVICE` só existe dentro do Cloud Run — serve de detector de ambiente. */
const platform: 'cloud-run' | 'local' = K_SERVICE ? 'cloud-run' : 'local';

/**
 * Atraso artificial na resolução dos dados, para encenar o estágio 3 do slide 22
 * ("chamada externa lenta aparece aqui"). Padrão 0 — ligue com RENDER_DELAY_MS=800.
 */
const renderDelayMs = Number(process.env['RENDER_DELAY_MS'] ?? 0) || 0;

let requestCount = 0;
let inFlight = 0;
let peakInFlight = 0;

// ---------------------------------------------------------------------------
// Log estruturado (slide 26)
// ---------------------------------------------------------------------------

const GCP_PROJECT = process.env['GOOGLE_CLOUD_PROJECT'] ?? '';

/**
 * Uma linha JSON por evento, no formato que o Cloud Logging entende nativamente.
 *
 * O Cloud Run lê o stdout do container: se a linha for JSON, os campos viram
 * campos indexados e `severity` vira o nível de verdade — dá para alertar em
 * `severity=ERROR` sem parsear texto. Se for texto solto, tudo vira uma string
 * só e você depura no escuro.
 */
function log(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  message: string,
  extra: Record<string, unknown> = {},
  traceHeader?: string,
): void {
  const entry: Record<string, unknown> = {
    severity,
    message,
    instanceId,
    ...extra,
  };

  // Correlaciona a linha de log com o trace distribuído do Cloud Trace, o que
  // permite pular do log para a requisição inteira no console do GCP.
  const traceId = traceHeader?.split('/')[0];
  if (traceId && GCP_PROJECT) {
    entry['logging.googleapis.com/trace'] = `projects/${GCP_PROJECT}/traces/${traceId}`;
  }

  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

// ---------------------------------------------------------------------------
// Endpoints de infraestrutura
// ---------------------------------------------------------------------------

/**
 * Health check. O script `3-coldstart.ps1` cronometra quanto tempo esta rota
 * demora a responder num container recém-criado: é o tempo de provisionar a
 * instância mais o de subir o Node (estágios 1 e 2 do slide 22).
 */
app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok', instanceId, uptimeMs: Date.now() - bootTime });
});

/**
 * Telemetria em JSON, consumida pela rota /painel e pelo script de concorrência.
 * É por aqui que se prova que 50 requisições paralelas foram atendidas por uma
 * instância só (slide 13).
 */
app.get('/api/instancia', (_req, res) => {
  res.json({
    instanceId,
    requestNumber: requestCount,
    uptimeMs: Date.now() - bootTime,
    inFlight,
    peakInFlight,
    port: String(port),
    service: K_SERVICE,
    revision: K_REVISION,
    platform,
  });
});

/**
 * Arquivos estáticos do /browser.
 *
 * `maxAge: '1y'` é seguro porque o build gera nomes com hash: quando o conteúdo
 * muda, o nome muda. É o cache do slide 23 — a maioria dos acessos nem chega
 * a acordar o renderizador.
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Render do Angular, instrumentado.
 */
app.use((req, res, next) => {
  const handleStartMs = Date.now();
  const requestNumber = ++requestCount;

  // A primeira requisição de um processo é, por definição, a que pagou o
  // cold start: ela esperou provisionar a instância e subir o Node.
  const coldStart = requestNumber === 1;

  inFlight++;
  peakInFlight = Math.max(peakInFlight, inFlight);

  const contexto: ServerRenderContext = {
    instanceId,
    requestNumber,
    coldStart,
    uptimeMs: handleStartMs - bootTime,
    inFlight,
    peakInFlight,
    port: String(port),
    service: K_SERVICE,
    revision: K_REVISION,
    platform,
    renderDelayMs,
    handleStartMs,
  };

  const traceHeader = req.header('x-cloud-trace-context');

  angularApp
    // O segundo argumento chega no Angular pelo token REQUEST_CONTEXT.
    .handle(req, contexto)
    .then((response) => {
      if (!response) {
        return next();
      }

      const renderMs = Date.now() - handleStartMs;

      // Expõe o tempo real de render no DevTools e para o curl. É a fonte
      // precisa que os scripts da demo leem.
      res.setHeader('Server-Timing', `render;dur=${renderMs}`);
      res.setHeader('X-Instance-Id', instanceId);
      res.setHeader('X-Cold-Start', String(coldStart));

      log(
        'INFO',
        `${req.method} ${req.url}`,
        {
          renderMs,
          coldStart,
          requestNumber,
          inFlight,
          path: req.url,
          status: response.status,
        },
        traceHeader,
      );

      return writeResponseToNodeResponse(response, res);
    })
    .catch((erro: unknown) => {
      log(
        'ERROR',
        `Falha ao renderizar ${req.url}`,
        {
          path: req.url,
          erro: erro instanceof Error ? erro.message : String(erro),
          stack: erro instanceof Error ? erro.stack : undefined,
        },
        traceHeader,
      );
      next(erro);
    })
    .finally(() => {
      inFlight--;
    });
});

if (isMainModule(import.meta.url) || process.env['pm_id']) {
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    log('INFO', 'Servidor pronto para receber requisições', {
      port,
      platform,
      service: K_SERVICE,
      revision: K_REVISION,
      renderDelayMs,
      bootMs: Date.now() - bootTime,
      node: process.version,
    });
  });
}

/**
 * Handler usado pelo Angular CLI (dev-server e build).
 */
export const reqHandler = createNodeRequestHandler(app);
