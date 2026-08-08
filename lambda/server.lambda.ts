import { AngularAppEngine, createRequestHandler } from '@angular/ssr';

/**
 * Ponto de entrada de SSR alternativo, para plataformas que não são Node.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ESTE ARQUIVO É O CUSTO DO SLIDE 14.
 *
 * No Cloud Run, o `src/server.ts` que o `ng add @angular/ssr` gerou roda sem
 * uma linha de mudança: é um servidor HTTP comum dentro de um container comum.
 *
 * No Lambda não existe servidor HTTP. Existe uma função que recebe um evento
 * JSON e devolve outro. Então é preciso:
 *
 *   1. este entry point, usando a API web-standard (`AngularAppEngine`) em vez
 *      da API de Node (`AngularNodeAppEngine`);
 *   2. uma configuração de build separada no angular.json, porque o `ssr.entry`
 *      é outro;
 *   3. o `handler.mjs`, que traduz evento da AWS ↔ Request/Response do padrão web;
 *   4. um template de infraestrutura (SAM) para amarrar Function URL e permissões.
 *
 * Quatro artefatos que o Cloud Run dispensou.
 * ─────────────────────────────────────────────────────────────────────────
 */
/**
 * Mesma proteção anti-SSRF do `src/server.ts` — e o mesmo cuidado precisa ser
 * repetido aqui. Cada entry point tem a sua instância do engine, então
 * esquecer esta linha faz toda requisição voltar 400 depois do deploy. É o
 * tipo de detalhe que dois entry points cobram e um só não cobraria.
 *
 * O domínio de uma Function URL só é conhecido depois do primeiro deploy, o
 * que torna a configuração por ambiente praticamente obrigatória aqui.
 */
const allowedHosts = (process.env['ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

const angularApp = new AngularAppEngine({ allowedHosts });

/**
 * Diferente do `AngularNodeAppEngine`, este `handle` fala `Request`/`Response`
 * do padrão web — os mesmos objetos do `fetch`. É o que permite rodar em
 * Lambda, Cloudflare Workers, Deno ou qualquer runtime não-Node.
 */
export const reqHandler = createRequestHandler(async (request: Request) => {
  const response = await angularApp.handle(request);

  return response ?? new Response('Não encontrado', { status: 404 });
});
