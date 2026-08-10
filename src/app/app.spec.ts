import { TestBed } from '@angular/core/testing';
import { REQUEST_CONTEXT, TransferState } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { ServerRenderContext, TelemetryStore } from './core/telemetry';
import { PricePipe } from './shared/price-pipe';

function fakeContext(overrides: Partial<ServerRenderContext> = {}): ServerRenderContext {
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
    ...overrides,
  };
}

describe('App', () => {
  it('renders the three render modes in the navigation', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideRouter([])],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Server');
    expect(text).toContain('Prerender');
    expect(text).toContain('Client');
  });
});

describe('TelemetryStore', () => {
  it('writes server telemetry into TransferState so the client can reuse it', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REQUEST_CONTEXT, useValue: fakeContext() }],
    });

    const store = TestBed.inject(TelemetryStore);
    const transferState = TestBed.inject(TransferState);

    expect(store.telemetry()?.instanceId).toBe('abc12345');
    // Without this, the telemetry bar would go blank as soon as the bundle
    // took over in the browser.
    expect(transferState.toJson()).toContain('abc12345');
  });

  it('reports a client-side render when no request context is present', () => {
    TestBed.configureTestingModule({});

    const store = TestBed.inject(TelemetryStore);

    expect(store.telemetry()).toBeNull();
    expect(store.renderOrigin()).toBe('browser (CSR)');
  });
});

describe('PricePipe', () => {
  it('formats identically on the server and in the browser', () => {
    expect(new PricePipe().transform(129.9)).toBe('$129.90');
  });
});
