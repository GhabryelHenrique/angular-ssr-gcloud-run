import { TestBed } from '@angular/core/testing';
import { REQUEST_CONTEXT, TransferState } from '@angular/core';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { CatalogStore } from './core/catalog';
import { CATALOG, featuredSlice, type CatalogSlice } from './core/catalog-data';
import { emptyBootReport, formatDuration, type BootReport } from './core/boot-report';
import { ServerRenderContext, TelemetryStore } from './core/telemetry';
import { PricePipe } from './shared/price-pipe';
import { buildInventory } from '../boot/inventory';

function fakeBoot(overrides: Partial<BootReport> = {}): BootReport {
  return {
    ...emptyBootReport(),
    profile: 'realistic',
    stages: [
      {
        id: 'inventory-index',
        label: 'Build the product index',
        kind: 'cpu',
        when: 'eager',
        durationMs: 300,
        detail: '24,000 SKUs',
      },
      {
        id: 'db-pool',
        label: 'Open the connection pool',
        kind: 'io',
        when: 'lazy',
        durationMs: 350,
        detail: 'simulated handshake',
      },
    ],
    eagerMs: 300,
    lazyMs: 350,
    totalMs: 650,
    processReadyMs: 900,
    indexedSkus: 24_000,
    warm: true,
    ...overrides,
  };
}

function fakeContext(overrides: Partial<ServerRenderContext> = {}): ServerRenderContext {
  return {
    telemetry: {
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
      boot: fakeBoot(),
      warmupWaitMs: 350,
      firstRenderMs: null,
      warmRenderAvgMs: null,
      warmSamples: 0,
    },
    catalog: featuredSlice(),
    product: null,
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

  it('exposes the startup cost the rendering instance paid', () => {
    TestBed.configureTestingModule({
      providers: [{ provide: REQUEST_CONTEXT, useValue: fakeContext() }],
    });

    const store = TestBed.inject(TelemetryStore);

    expect(store.boot().totalMs).toBe(650);
    // A cold render made the visitor wait for the eager stages too.
    expect(store.totalServerMs()).toBeGreaterThanOrEqual(300);
  });

  it('falls back to an empty startup report on a client-only route', () => {
    TestBed.configureTestingModule({});

    expect(TestBed.inject(TelemetryStore).boot().stages).toEqual([]);
  });
});

describe('CatalogStore', () => {
  it('renders the search results the server already resolved', () => {
    const slice: CatalogSlice = {
      query: 'cobalt',
      category: '',
      items: [
        {
          id: 'kb-01-000123',
          name: 'Mechanical Keyboard 75% — Cobalt Pro',
          category: 'Peripherals',
          price: 118.4,
          stock: 6,
          description: 'Tactile switches. Gen 3, cobalt finish.',
        },
      ],
      total: 812,
      indexedSkus: 24_000,
      searchMs: 1.4,
      categories: [{ name: 'Peripherals', count: 812 }],
      featured: false,
    };

    TestBed.configureTestingModule({
      providers: [{ provide: REQUEST_CONTEXT, useValue: fakeContext({ catalog: slice }) }],
    });

    const store = TestBed.inject(CatalogStore);

    expect(store.results().total).toBe(812);
    // The rendered rows are cached, which is what lets a click on a result open
    // the product page without another round trip.
    expect(store.byId('kb-01-000123')?.stock).toBe(6);
    expect(TestBed.inject(TransferState).toJson()).toContain('kb-01-000123');
  });

  it('falls back to the curated rows with no server context', () => {
    TestBed.configureTestingModule({});

    const store = TestBed.inject(CatalogStore);

    expect(store.products().length).toBe(CATALOG.length);
    expect(store.byId('kb-01')?.name).toBe('Mechanical Keyboard 75%');
  });
});

describe('inventory index', () => {
  const index = buildInventory(2_000);

  it('keeps the curated ids addressable so their links never break', () => {
    expect(index.byId('kb-01')?.name).toBe('Mechanical Keyboard 75%');
    expect(index.skus.length).toBe(2_000);
  });

  it('matches every term of a query, not just one', () => {
    const both = index.search({ query: 'monitor portable', category: '', limit: 5 });
    const one = index.search({ query: 'monitor', category: '', limit: 5 });

    expect(both.total).toBeGreaterThan(0);
    expect(both.total).toBeLessThan(one.total);
  });

  it('counts facets over the whole match, not over the visible page', () => {
    const slice = index.search({ query: 'usb', category: '', limit: 3 });
    const counted = slice.categories.reduce((sum, facet) => sum + facet.count, 0);

    expect(slice.items.length).toBeLessThanOrEqual(3);
    expect(counted).toBe(slice.total);
  });

  it('does not drop documents a prefix reaches through two tokens', () => {
    // 'mon' prefixes both `monitor` and `monitoring`; scoring the term twice
    // would push the document past the term count and exclude it entirely.
    expect(index.search({ query: 'mon', category: '', limit: 5 }).total).toBeGreaterThan(0);
  });

  it('narrows results to the requested category', () => {
    const slice = index.search({ query: '', category: 'Displays', limit: 5 });

    expect(slice.total).toBeGreaterThan(0);
    expect(slice.items.every((item) => item.category === 'Displays')).toBe(true);
  });
});

describe('formatDuration', () => {
  it('switches to seconds once a number stops being readable in milliseconds', () => {
    expect(formatDuration(19)).toBe('19 ms');
    expect(formatDuration(1284)).toBe('1.28 s');
  });
});

describe('PricePipe', () => {
  it('formats identically on the server and in the browser', () => {
    expect(new PricePipe().transform(129.9)).toBe('$129.90');
  });
});
