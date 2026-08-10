/**
 * Lambda ↔ Angular SSR adapter.
 *
 * Translates an AWS event (API Gateway v2 / Function URL) into the
 * web-standard `Request` Angular understands, and the resulting `Response`
 * back into the shape Lambda expects.
 *
 * None of this exists on Cloud Run: the container receives real HTTP.
 */

// Produced by: npm run build:lambda
import { reqHandler } from './dist/angular-ssr-cloud-run/server/server.mjs';

/**
 * Rebuilds the absolute URL from the event.
 *
 * Angular needs an absolute URL because it validates the host against its
 * allowedHosts list. The AWS event delivers path and domain in separate
 * fields, so the reconstruction is manual.
 */
function buildUrl(event) {
  const domain = event.requestContext?.domainName ?? event.headers?.host ?? 'localhost';
  const path = event.rawPath ?? event.path ?? '/';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';

  return `https://${domain}${path}${query}`;
}

function buildRequest(event) {
  const method = event.requestContext?.http?.method ?? event.httpMethod ?? 'GET';

  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }
  // Function URLs deliver cookies in a separate array, outside the headers.
  if (event.cookies?.length) {
    headers.set('cookie', event.cookies.join('; '));
  }

  let body;
  if (event.body !== undefined && event.body !== null && method !== 'GET' && method !== 'HEAD') {
    body = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : event.body;
  }

  return new Request(buildUrl(event), { method, headers, body });
}

/**
 * Buffered handler.
 *
 * AWS caps the payload at 6 MB. Exceed it and the invocation fails — and a
 * page with a lot of inline HTML gets closer to that than you would expect.
 * Larger responses, or sending HTML in chunks the way Cloud Run does by
 * default, require the streaming handler below.
 */
export const handler = async (event) => {
  const response = await reqHandler(buildRequest(event));

  const headers = {};
  const cookies = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      cookies.push(value);
    } else {
      headers[key] = value;
    }
  });

  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    statusCode: response.status,
    headers,
    cookies,
    body: buffer.toString('base64'),
    isBase64Encoded: true,
  };
};

/**
 * Streaming handler.
 *
 * `awslambda` is a global that only exists inside the AWS runtime, hence the
 * guard. It requires a Function URL with `InvokeMode: RESPONSE_STREAM`;
 * behind API Gateway, streaming does not work at all.
 *
 * Compare the size of this function with what Cloud Run needed to stream
 * HTML: nothing. It is the default behaviour of an HTTP server.
 */
export const streamingHandler =
  typeof awslambda !== 'undefined'
    ? awslambda.streamifyResponse(async (event, responseStream) => {
        const response = await reqHandler(buildRequest(event));

        const headers = {};
        const cookies = [];
        response.headers.forEach((value, key) => {
          if (key.toLowerCase() === 'set-cookie') {
            cookies.push(value);
          } else {
            headers[key] = value;
          }
        });

        const stream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: response.status,
          headers,
          cookies,
        });

        if (!response.body) {
          stream.end();
          return;
        }

        const reader = response.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            stream.write(value);
          }
        } finally {
          stream.end();
        }
      })
    : undefined;
