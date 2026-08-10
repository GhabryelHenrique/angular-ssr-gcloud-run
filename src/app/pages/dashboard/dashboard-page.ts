import { Component, afterNextRender, signal } from '@angular/core';

interface InstanceResponse {
  instanceId: string;
  requestNumber: number;
  uptimeMs: number;
  inFlight: number;
  peakInFlight: number;
  port: string;
  revision: string;
  platform: string;
}

/**
 * A `RenderMode.Client` route: nothing is rendered on the server.
 *
 * `view-source:` on this page returns an empty `<app-root>` and some script
 * tags. The user waits for the bundle to download, execute, and only then ask
 * for data — two round trips before the first useful pixel. It exists here as
 * the control group against the server-rendered routes.
 */
@Component({
  selector: 'app-dashboard-page',
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  protected readonly data = signal<InstanceResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly fetchMs = signal<number | null>(null);

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
