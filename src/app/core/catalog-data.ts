/**
 * Catalog types and seed data, deliberately free of any framework import.
 *
 * Both sides of the application need this file: Angular renders it, and the
 * Node process indexes it at boot (see `src/boot/inventory.ts`). Keeping it
 * framework-free is what allows the server module to import it without
 * dragging `@angular/core` into a plain Node code path.
 */

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
}

/** One entry of the category facet returned alongside a search. */
export interface CategoryFacet {
  name: string;
  count: number;
}

/**
 * A page of catalog data resolved by the server for the current request.
 *
 * The server runs the query against the boot-time index and hands the result
 * to Angular through `REQUEST_CONTEXT`, so the HTML already contains the
 * results — no client round trip, and crawlers see the same page a user does.
 */
export interface CatalogSlice {
  /** The `?q=` term, empty when the visitor has not searched. */
  query: string;
  /** The `?category=` filter, empty when unfiltered. */
  category: string;
  /** The products to render. */
  items: readonly Product[];
  /** How many SKUs matched in total, before the page limit. */
  total: number;
  /** How many SKUs the boot-time index holds. */
  indexedSkus: number;
  /** How long the index lookup took. Distinct from the cost of building it. */
  searchMs: number;
  /** Category counts for the matched set, used to render the facet chips. */
  categories: readonly CategoryFacet[];
  /** True when no query ran and these are the curated products below. */
  featured: boolean;
}

/**
 * The curated catalog — what `/` shows when nobody has searched.
 *
 * Price and stock are exactly the kind of content that justifies SSR: they
 * change constantly, so they cannot be baked into a build — yet they must be
 * present in the HTML, because search engine crawlers do not wait for
 * JavaScript to run.
 *
 * At boot the server expands these twelve rows into tens of thousands of
 * variants and indexes them, which is where a realistic share of the cold
 * start comes from.
 */
export const CATALOG: readonly Product[] = [
  {
    id: 'kb-01',
    name: 'Mechanical Keyboard 75%',
    category: 'Peripherals',
    price: 129.9,
    stock: 12,
    description: 'Tactile switches, hot-swappable, aluminium case.',
  },
  {
    id: 'ms-02',
    name: 'Lightweight Wireless Mouse',
    category: 'Peripherals',
    price: 79.0,
    stock: 4,
    description: '58g, 26k DPI optical sensor.',
  },
  {
    id: 'mn-03',
    name: '27" 144Hz Monitor',
    category: 'Displays',
    price: 449.0,
    stock: 3,
    description: 'IPS, 1440p, factory calibrated.',
  },
  {
    id: 'mn-04',
    name: '16" Portable Monitor',
    category: 'Displays',
    price: 299.0,
    stock: 0,
    description: 'USB-C, 1080p, magnetic cover included.',
  },
  {
    id: 'hp-05',
    name: 'Noise Cancelling Headset',
    category: 'Audio',
    price: 349.0,
    stock: 7,
    description: '35h battery life, transparency mode.',
  },
  {
    id: 'mc-06',
    name: 'USB Cardioid Microphone',
    category: 'Audio',
    price: 159.0,
    stock: 15,
    description: 'Zero latency monitoring.',
  },
  {
    id: 'dk-07',
    name: 'Thunderbolt 4 Dock',
    category: 'Connectivity',
    price: 389.0,
    stock: 2,
    description: '96W charging, dual 4K displays.',
  },
  {
    id: 'hb-08',
    name: '7-in-1 USB-C Hub',
    category: 'Connectivity',
    price: 69.0,
    stock: 23,
    description: 'HDMI 4K60, SD reader, gigabit ethernet.',
  },
  {
    id: 'ss-09',
    name: '2TB NVMe SSD',
    category: 'Storage',
    price: 189.0,
    stock: 9,
    description: 'PCIe 4.0, 7,400 MB/s read.',
  },
  {
    id: 'hd-10',
    name: '5TB External Drive',
    category: 'Storage',
    price: 139.0,
    stock: 6,
    description: 'USB 3.2, bus powered.',
  },
  {
    id: 'ch-11',
    name: 'Ergonomic Chair',
    category: 'Workspace',
    price: 549.0,
    stock: 1,
    description: 'Mesh back, adjustable lumbar support.',
  },
  {
    id: 'ar-12',
    name: 'Monitor Arm',
    category: 'Workspace',
    price: 99.0,
    stock: 18,
    description: 'VESA 75/100, supports up to 9kg.',
  },
];

/** The slice used when there is no server index to query — the curated rows. */
export function featuredSlice(): CatalogSlice {
  return {
    query: '',
    category: '',
    items: CATALOG,
    total: CATALOG.length,
    indexedSkus: CATALOG.length,
    searchMs: 0,
    categories: [],
    featured: true,
  };
}
