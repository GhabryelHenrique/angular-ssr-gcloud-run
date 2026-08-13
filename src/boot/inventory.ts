/**
 * The in-memory product index.
 *
 * This is the honest, boring reason so many services have a slow cold start:
 * something has to be in memory before the first request can be answered, and
 * building it costs real CPU. Here it is a search index; in your application it
 * is an ORM metadata graph, a compiled template cache, a feature-flag snapshot
 * or a dependency-injection container.
 *
 * The important property is that the cost is paid ONCE per process. Every
 * request after the first reads a structure that already exists — which is why
 * the warm numbers are so much lower, and why keeping an instance alive is
 * worth more than any micro-optimisation of the render itself.
 */

import {
  CATALOG,
  type CatalogSlice,
  type CategoryFacet,
  type Product,
} from '../app/core/catalog-data';

const FINISHES = [
  'Graphite',
  'Silver',
  'Midnight',
  'Sand',
  'Forest',
  'Cobalt',
  'Ivory',
  'Copper',
] as const;

const EDITIONS = ['Standard', 'Pro', 'Max', 'Lite', 'Studio', 'Field'] as const;

const GENERATIONS = ['Gen 1', 'Gen 2', 'Gen 3', 'Gen 4', 'Gen 5'] as const;

/**
 * Deterministic pseudo-random numbers.
 *
 * The catalog has to look varied without being random: two processes started
 * from the same image must index the same data, otherwise comparing a cold
 * instance against a warm one would compare two different catalogs.
 */
function hash32(seed: number): number {
  let value = seed + 0x9e3779b9;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0;
}

/** Splits text into the lowercase tokens the index is keyed by. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

/** Expands one curated row into the variant at position `index`. */
function makeVariant(index: number): Product {
  const base = CATALOG[index % CATALOG.length];
  const noise = hash32(index);

  const finish = FINISHES[(noise >>> 3) % FINISHES.length];
  const edition = EDITIONS[(noise >>> 7) % EDITIONS.length];
  const generation = GENERATIONS[(noise >>> 11) % GENERATIONS.length];

  // ±35% around the curated price, rounded to something a shop would print.
  const priceFactor = 0.65 + ((noise >>> 5) % 700) / 1000;

  return {
    id: `${base.id}-${String(index).padStart(6, '0')}`,
    name: `${base.name} — ${finish} ${edition}`,
    category: base.category,
    price: Math.round(base.price * priceFactor * 100) / 100,
    stock: (noise >>> 13) % 40,
    description: `${base.description} ${generation}, ${finish.toLowerCase()} finish.`,
  };
}

export interface SearchInput {
  query: string;
  category: string;
  limit: number;
}

export interface InventoryIndex {
  /** Every SKU held in memory, curated rows first. */
  readonly skus: readonly Product[];
  /** Distinct tokens in the inverted index. */
  readonly tokenCount: number;
  /** Total token→SKU entries. The real measure of how much work the build did. */
  readonly postingCount: number;
  search(input: SearchInput): CatalogSlice;
  byId(id: string): Product | undefined;
}

/**
 * Builds the inverted index. This function is the CPU stage of the cold start.
 *
 * `size` is the number of SKUs to materialise; see `BOOT_PROFILE` in
 * `startup.ts` for the values each profile uses.
 */
export function buildInventory(size: number): InventoryIndex {
  const skuCount = Math.max(CATALOG.length, size);
  const skus: Product[] = new Array<Product>(skuCount);
  const byId = new Map<string, Product>();
  const postings = new Map<string, number[]>();

  let postingCount = 0;

  for (let i = 0; i < skuCount; i++) {
    // The curated rows keep their original ids so `/product/kb-01` — the link
    // printed in the README and in every talk — never breaks.
    const product = i < CATALOG.length ? CATALOG[i] : makeVariant(i);

    skus[i] = product;
    byId.set(product.id, product);

    const tokens = tokenize(
      `${product.name} ${product.category} ${product.description} ${product.id}`,
    );

    // A Set per document: repeating a token inside one product must not create
    // duplicate postings, or the relevance score would count it twice.
    for (const token of new Set(tokens)) {
      const list = postings.get(token);
      if (list) {
        list.push(i);
      } else {
        postings.set(token, [i]);
      }
      postingCount++;
    }
  }

  /**
   * The SKUs one query term matches, deduplicated.
   *
   * The Set is not decoration: the prefix fallback below can reach the same
   * product through two different tokens (`monitor` and `monitoring`), and a
   * term that counted twice would push a document's score past the number of
   * terms — excluding it from the AND match instead of ranking it higher.
   */
  function resolveTerm(term: string): ReadonlySet<number> {
    const exact = postings.get(term);
    if (exact) {
      return new Set(exact);
    }

    // Nothing matched exactly, so fall back to a prefix scan. Linear over the
    // vocabulary rather than over the catalog, which keeps it in microseconds.
    const matches = new Set<number>();
    for (const [candidate, list] of postings) {
      if (candidate.startsWith(term)) {
        for (const index of list) {
          matches.add(index);
        }
      }
    }
    return matches;
  }

  function search(input: SearchInput): CatalogSlice {
    const startedAt = performance.now();
    const query = input.query.trim();
    const category = input.category.trim();
    const terms = [...new Set(tokenize(query))];

    let candidates: Iterable<number>;

    if (terms.length === 0) {
      candidates = skus.keys();
    } else {
      // Score by how many query terms each SKU matched, then keep only the
      // documents that matched every term — an AND search, scored.
      const scores = new Map<number, number>();
      for (const term of terms) {
        for (const index of resolveTerm(term)) {
          scores.set(index, (scores.get(index) ?? 0) + 1);
        }
      }

      const matched: number[] = [];
      for (const [index, score] of scores) {
        if (score === terms.length) {
          matched.push(index);
        }
      }
      candidates = matched;
    }

    const wantedCategory = category.toLowerCase();

    // One pass over the matched set does everything: the facet counts, the
    // total, and the page itself. Sorting the full set instead would put tens
    // of thousands of comparisons on the warm path, which is the number this
    // whole project is trying to keep small.
    const counts = new Map<string, number>();
    const inStock: Product[] = [];
    const soldOut: Product[] = [];
    let total = 0;

    for (const index of candidates) {
      const product = skus[index];
      if (wantedCategory && product.category.toLowerCase() !== wantedCategory) {
        continue;
      }

      total++;
      // Counted over the whole matched set, not over the visible page:
      // "412 in Displays" has to stay true while you look at the first 24.
      counts.set(product.category, (counts.get(product.category) ?? 0) + 1);

      // In stock first — an out-of-stock row at the top is a bad answer even
      // when it is the most relevant one.
      if (product.stock > 0) {
        if (inStock.length < input.limit) {
          inStock.push(product);
        }
      } else if (soldOut.length < input.limit) {
        soldOut.push(product);
      }
    }

    const categories: CategoryFacet[] = [...counts]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const items = [...inStock, ...soldOut]
      .slice(0, input.limit)
      .sort((a, b) => Number(b.stock > 0) - Number(a.stock > 0) || a.price - b.price);

    return {
      query,
      category,
      items,
      total,
      indexedSkus: skus.length,
      searchMs: Math.round((performance.now() - startedAt) * 100) / 100,
      categories,
      featured: false,
    };
  }

  return {
    skus,
    tokenCount: postings.size,
    postingCount,
    search,
    byId: (id: string) => byId.get(id),
  };
}
