/**
 * Adaptador Lambda ↔ Angular SSR.
 *
 * Traduz o evento da AWS (API Gateway v2 / Function URL) para o `Request` do
 * padrão web que o Angular entende, e o `Response` de volta para o formato que
 * o Lambda espera.
 *
 * No Cloud Run nada disso existe: o container recebe HTTP de verdade.
 */

// Gerado por: ng build --configuration lambda
import { reqHandler } from './dist/poc-cloud-run/server/server.mjs';

/**
 * Monta a URL absoluta a partir do evento.
 *
 * O Angular precisa de URL absoluta (ele valida o host contra a lista de
 * allowedHosts). O evento da AWS entrega o caminho e o domínio em campos
 * separados, então a reconstrução é manual.
 */
function montarUrl(evento) {
  const dominio = evento.requestContext?.domainName ?? evento.headers?.host ?? 'localhost';
  const caminho = evento.rawPath ?? evento.path ?? '/';
  const query = evento.rawQueryString ? `?${evento.rawQueryString}` : '';

  return `https://${dominio}${caminho}${query}`;
}

function montarRequest(evento) {
  const metodo = evento.requestContext?.http?.method ?? evento.httpMethod ?? 'GET';

  const cabecalhos = new Headers();
  for (const [chave, valor] of Object.entries(evento.headers ?? {})) {
    if (valor !== undefined) {
      cabecalhos.set(chave, valor);
    }
  }
  // Function URL entrega cookies num array à parte, fora dos headers.
  if (evento.cookies?.length) {
    cabecalhos.set('cookie', evento.cookies.join('; '));
  }

  let corpo;
  if (evento.body !== undefined && evento.body !== null && metodo !== 'GET' && metodo !== 'HEAD') {
    corpo = evento.isBase64Encoded ? Buffer.from(evento.body, 'base64') : evento.body;
  }

  return new Request(montarUrl(evento), {
    method: metodo,
    headers: cabecalhos,
    body: corpo,
  });
}

/**
 * Handler com resposta bufferizada.
 *
 * Limite da AWS: 6 MB de payload. Passou disso, a invocação falha — e uma
 * página com muito HTML inline chega perto. Para respostas maiores (ou para
 * enviar o HTML em pedaços, como o Cloud Run faz por padrão), é preciso o
 * modo de streaming abaixo.
 */
export const handler = async (evento) => {
  const resposta = await reqHandler(montarRequest(evento));

  const cabecalhos = {};
  const cookies = [];
  resposta.headers.forEach((valor, chave) => {
    if (chave.toLowerCase() === 'set-cookie') {
      cookies.push(valor);
    } else {
      cabecalhos[chave] = valor;
    }
  });

  const buffer = Buffer.from(await resposta.arrayBuffer());

  return {
    statusCode: resposta.status,
    headers: cabecalhos,
    cookies,
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
};

/**
 * Handler com streaming.
 *
 * `awslambda` é um global que só existe dentro do runtime da AWS — daí a
 * guarda. Exige Function URL com InvokeMode RESPONSE_STREAM: atrás de API
 * Gateway o streaming não funciona.
 *
 * Repare no tamanho desta função comparado ao que o Cloud Run precisou para
 * ter streaming de HTML: nada. É o comportamento padrão de um servidor HTTP.
 */
export const streamingHandler =
  typeof awslambda !== 'undefined'
    ? awslambda.streamifyResponse(async (evento, fluxoResposta) => {
        const resposta = await reqHandler(montarRequest(evento));

        const cabecalhos = {};
        const cookies = [];
        resposta.headers.forEach((valor, chave) => {
          if (chave.toLowerCase() === 'set-cookie') {
            cookies.push(valor);
          } else {
            cabecalhos[chave] = valor;
          }
        });

        const fluxo = awslambda.HttpResponseStream.from(fluxoResposta, {
          statusCode: resposta.status,
          headers: cabecalhos,
          cookies,
        });

        if (!resposta.body) {
          fluxo.end();
          return;
        }

        const leitor = resposta.body.getReader();
        try {
          for (;;) {
            const { done, value } = await leitor.read();
            if (done) break;
            fluxo.write(value);
          }
        } finally {
          fluxo.end();
        }
      })
    : undefined;
