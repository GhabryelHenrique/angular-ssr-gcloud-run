import { Injectable, PendingTasks, inject, signal } from '@angular/core';
import { TelemetryStore } from './telemetry';

export interface Product {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
  description: string;
}

/**
 * The demo catalog.
 *
 * Price and stock are exactly the kind of content that justifies SSR: they
 * change constantly, so they cannot be baked into a build — yet they must be
 * present in the HTML, because search engine crawlers do not wait for
 * JavaScript to run.
 */
const CATALOG: readonly Product[] = [
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly pendingTasks = inject(PendingTasks);
  private readonly telemetry = inject(TelemetryStore);

  private readonly items = signal<readonly Product[]>(CATALOG);

  readonly products = this.items.asReadonly();

  constructor() {
    this.simulateSlowBackend();
  }

  byId(id: string): Product | undefined {
    return CATALOG.find((product) => product.id === id);
  }

  /**
   * Simulates a slow upstream call in the middle of the render.
   *
   * `PendingTasks.run` is what makes SSR actually wait before serializing the
   * HTML; without it Angular would close the document before the response
   * arrived. Set `RENDER_DELAY_MS=800` to watch a slow backend inflate render
   * time — and to see that the cost belongs to the data source, not to SSR.
   */
  private simulateSlowBackend(): void {
    const delay = this.telemetry.telemetry()?.renderDelayMs ?? 0;
    if (delay <= 0) {
      return;
    }

    this.pendingTasks.run(async () => {
      await sleep(delay);
      this.items.set(CATALOG);
    });
  }
}
