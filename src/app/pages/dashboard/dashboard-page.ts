import { Component, afterNextRender, computed, signal } from '@angular/core';
import { emptyBootReport, formatDuration, type BootReport } from '../../core/boot-report';
import { BootWaterfall } from '../../shared/boot-waterfall/boot-waterfall';

interface InstanceResponse {
  instanceId: string;
  requestNumber: number;
  uptimeMs: number;
  inFlight: number;
  peakInFlight: number;
  port: string;
  revision: string;
  platform: string;
  boot: BootReport;
}

/**
 * A `RenderMode.Client` route: nothing is rendered on the server.
 *
 * `view-source:` on this page returns an empty `<app-root>` and some script
 * tags. The user waits for the bundle to download, execute, and only then ask
 * for data — two round trips before the first useful pixel. It exists here as
 * the control group against the server-rendered routes.
 *
 * The startup breakdown below is the same one `/cold-start` shows, fetched
 * instead of rendered — a direct comparison of the two ways to get a number
 * onto a page.
 */
@Component({
  selector: 'app-dashboard-page',
  imports: [BootWaterfall],
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly data = signal<InstanceResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly fetchMs = signal<number | null>(null);

  protected readonly boot = computed<BootReport>(() => this.data()?.boot ?? emptyBootReport());
  protected readonly bootLabel = computed(() => formatDuration(this.boot().totalMs));

  constructor() {
    afterNextRender(() => this.load());
  }

  protected async load(): Promise<void> {
    const start = performance.now();
    this.error.set(null);

    try {
      const response = await fetch('/api/instance');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      this.data.set((await response.json()) as InstanceResponse);
    } catch (cause) {
      this.error.set(cause instanceof Error ? cause.message : 'unknown failure');
    } finally {
      this.fetchMs.set(Math.round(performance.now() - start));
    }
  }
}
