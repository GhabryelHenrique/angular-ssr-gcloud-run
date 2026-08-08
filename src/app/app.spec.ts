import { TestBed } from '@angular/core/testing';
import { REQUEST_CONTEXT, TransferState } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { ServerRenderContext, TelemetryStore } from './core/telemetry';
import { MoedaPipe } from './shared/moeda-pipe';

function contextoFalso(sobrescreve: Partial<ServerRenderContext> = {}): ServerRenderContext {
  return {
    instanceId: 'abc12345',
    requestNumber: 1,
    coldStart: true,
    uptimeMs: 1200,
    inFlight: 1,
    peakInFlight: 1,
    port: '8080',
    service: '',
    revision: '',
    platform: 'local',
    renderDelayMs: 0,
    handleStartMs: Date.now(),
    ...sobrescreve,
  };
}

describe('App', () => {
  it('monta o shell com as três modalidades de render na navegação', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const texto = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(texto).toContain('Server');
    expect(texto).toContain('Prerender');
    expect(texto).toContain('Client');
  });
});

describe('TelemetryStore', () => {
  it('grava a telemetria do servidor no TransferState para o cliente reaproveitar', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REQUEST_CONTEXT, useValue: contextoFalso() }],
    });

    const store = TestBed.inject(TelemetryStore);
    const transferState = TestBed.inject(TransferState);

    expect(store.telemetry()?.instanceId).toBe('abc12345');
    // Sem isto, a barra apagaria assim que o bundle assumisse no navegador.
    expect(transferState.toJson()).toContain('abc12345');
  });

  it('sem contexto de requisição, entende que o render foi client-side', () => {
    TestBed.configureTestingModule({});

    const store = TestBed.inject(TelemetryStore);

    expect(store.telemetry()).toBeNull();
    expect(store.renderOrigin()).toBe('navegador (CSR)');
  });
});

describe('MoedaPipe', () => {
  it('formata em real com o mesmo resultado no servidor e no navegador', () => {
    // Espaço não-quebrável é o que o Intl usa entre "R$" e o número.
    expect(new MoedaPipe().transform(489.9).replace(/ /g, ' ')).toBe('R$ 489,90');
  });
});
