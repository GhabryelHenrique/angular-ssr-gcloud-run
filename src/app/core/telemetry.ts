import {
  Injectable,
  REQUEST_CONTEXT,
  TransferState,
  computed,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';

/**
 * Dados que o servidor injeta em cada render.
 *
 * O `server.ts` monta este objeto por requisição e passa para
 * `angularApp.handle(req, contexto)`. Dentro do Angular ele chega pelo
 * token `REQUEST_CONTEXT`.
 */
export interface ServerRenderContext {
  /** Identidade do processo Node. Muda quando o container é recriado. */
  instanceId: string;
  /** Quantas requisições este processo já serviu (esta inclusa). */
  requestNumber: number;
  /** `true` apenas na primeira requisição de um processo novo — o cold start. */
  coldStart: boolean;
  /** Há quanto tempo o processo está de pé. */
  uptimeMs: number;
  /** Requisições sendo processadas neste instante por esta instância. */
  inFlight: number;
  /** Pico de concorrência simultânea observado por esta instância. */
  peakInFlight: number;
  /** Porta em que o servidor escuta — no Cloud Run vem da variável PORT. */
  port: string;
  /** `K_SERVICE` no Cloud Run; vazio localmente. */
  service: string;
  /** `K_REVISION` no Cloud Run; vazio localmente. */
  revision: string;
  /** Onde o processo está rodando, deduzido do ambiente. */
  platform: 'cloud-run' | 'local';
  /** Atraso artificial de dados, via RENDER_DELAY_MS (encena o slide 22). */
  renderDelayMs: number;
  /** `Date.now()` no início do handle — base para medir o tempo de render. */
  handleStartMs: number;
}

/** Estado que a barra de telemetria mostra, já normalizado para a tela. */
export interface TelemetryView extends ServerRenderContext {
  /** ISO do instante em que o servidor renderizou. */
  renderedAt: string;
  /** ms entre o início do handle e a montagem deste serviço. */
  renderMs: number;
}

const TELEMETRY_KEY = makeStateKey<TelemetryView>('ssr-telemetry');

/**
 * Faz a telemetria do servidor sobreviver à hidratação.
 *
 * `REQUEST_CONTEXT` só existe durante o SSR — no navegador ele é `null`. Sem
 * cuidado, a barra apagaria assim que o JavaScript assumisse. A ponte é o
 * `TransferState`: o servidor grava, o Angular serializa junto do HTML e o
 * cliente lê de volta sem precisar de uma segunda requisição.
 */
@Injectable({ providedIn: 'root' })
export class TelemetryStore {
  private readonly transferState = inject(TransferState);
  private readonly requestContext = inject(REQUEST_CONTEXT, {
    optional: true,
  }) as ServerRenderContext | null;

  private readonly state = signal<TelemetryView | null>(this.resolve());

  /** Telemetria do render atual, ou `null` numa rota puramente client-side. */
  readonly telemetry = this.state.asReadonly();

  /** `true` depois que o bundle assumiu no navegador. */
  readonly hydrated = signal(false);

  readonly renderOrigin = computed(() => {
    if (!this.state()) {
      return 'navegador (CSR)';
    }
    return this.hydrated() ? 'servidor · hidratado' : 'servidor (SSR)';
  });

  private resolve(): TelemetryView | null {
    // No servidor: lê o contexto da requisição e o deixa gravado para o cliente.
    if (this.requestContext) {
      const view: TelemetryView = {
        ...this.requestContext,
        renderedAt: new Date().toISOString(),
        renderMs: Date.now() - this.requestContext.handleStartMs,
      };
      this.transferState.set(TELEMETRY_KEY, view);

      return view;
    }

    // No cliente: recupera o que o servidor serializou no HTML.
    return this.transferState.get(TELEMETRY_KEY, null);
  }

  markHydrated(): void {
    this.hydrated.set(true);
  }
}
