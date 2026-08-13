import {
  Injectable,
  PendingTasks,
  REQUEST_CONTEXT,
  TransferState,
  computed,
  inject,
  makeStateKey,
  signal,
} from '@angular/core';
import { CATALOG, featuredSlice, type CatalogSlice, type Product } from './catalog-data';
import { TelemetryStore, type ServerRenderContext } from './telemetry';

export type { Product } from './catalog-data';

const CATALOG_KEY = makeStateKey<CatalogSlice>('ssr-catalog');
const PRODUCT_KEY = makeStateKey<Product | null>('ssr-product');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The catalog as the current page sees it.
 *
 * Nothing is fetched here. The server ran the query against the index it built
 * at boot and handed the answer over through `REQUEST_CONTEXT`, so the results
 * are already in the HTML by the time the browser parses it — the second use of
 * the same TransferState bridge `TelemetryStore` documents.
 */
@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly pendingTasks = inject(PendingTasks);
  private readonly telemetry = inject(TelemetryStore);
  private readonly transferState = inject(TransferState);
  private readonly requestContext = inject(REQUEST_CONTEXT, {
    optional: true,
  }) as ServerRenderContext | null;

  private readonly slice = signal<CatalogSlice>(this.resolveSlice());

  /** The search result, or the curated rows when nobody searched. */
  readonly results = this.slice.asReadonly();

  /** Kept for the templates that only ever wanted the list of products. */
  readonly products = computed(() => this.results().items);

  /**
   * Every product this session has seen, by id.
   *
   * Seeded with the curated rows and topped up from each rendered result page,
   * which is what lets a click on a search result open the product page without
   * a round trip: the row was already on screen, so its data is already here.
   */
  private readonly known = new Map<string, Product>();

  constructor() {
    for (const product of CATALOG) {
      this.known.set(product.id, product);
    }
    this.remember(this.slice().items);

    const resolved = this.resolveProduct();
    if (resolved) {
      this.known.set(resolved.id, resolved);
    }

    this.simulateSlowBackend();
  }

  byId(id: string): Product | undefined {
    return this.known.get(id);
  }

  private remember(items: readonly Product[]): void {
    for (const product of items) {
      this.known.set(product.id, product);
    }
  }

  private resolveSlice(): CatalogSlice {
    if (this.requestContext) {
      const slice = this.requestContext.catalog;

      // Only search results are worth transferring. The curated rows are a
      // constant that already ships inside the bundle, so serializing them
      // into the HTML would send the same twelve products twice — once as
      // markup, once as JSON — for a value the client can produce itself.
      if (!slice.featured) {
        this.transferState.set(CATALOG_KEY, slice);
      }

      return slice;
    }

    // In the browser, or on a route that never reached the server: fall back to
    // the curated rows, which ship inside the bundle.
    return this.transferState.get(CATALOG_KEY, featuredSlice());
  }

  private resolveProduct(): Product | null {
    if (this.requestContext) {
      const product = this.requestContext.product;

      // Same reasoning: a curated product is already in the bundle. Only a
      // generated variant has to travel.
      if (product && !this.known.has(product.id)) {
        this.transferState.set(PRODUCT_KEY, product);
      }

      return product;
    }

    return this.transferState.get(PRODUCT_KEY, null);
  }

  /**
   * Simulates a slow upstream call in the middle of the render.
   *
   * `PendingTasks.run` is what makes SSR actually wait before serializing the
   * HTML; without it Angular would close the document before the response
   * arrived. Set `RENDER_DELAY_MS=800` to watch a slow backend inflate render
   * time — and to see that the cost belongs to the data source, not to SSR.
   *
   * Note how this differs from the startup stages in `src/boot/startup.ts`:
   * this delay is paid on EVERY request, boot work is paid once per process.
   * That distinction is the difference between a caching problem and a cold
   * start problem.
   */
  private simulateSlowBackend(): void {
    const delay = this.telemetry.telemetry()?.renderDelayMs ?? 0;
    if (delay <= 0) {
      return;
    }

    this.pendingTasks.run(async () => {
      await sleep(delay);
      this.slice.set({ ...this.slice() });
    });
  }
}
