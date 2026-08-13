import { Component, computed, inject } from '@angular/core';
import { formatDuration } from '../../core/boot-report';
import { TelemetryStore } from '../../core/telemetry';
import { BootWaterfall } from '../../shared/boot-waterfall/boot-waterfall';

/**
 * The cold start, rendered by the instance that paid for it.
 *
 * Server-rendered on purpose: every number on this page describes the process
 * that produced the HTML, so fetching them afterwards would describe a
 * different moment. Reload it and watch the same instance report a warm render
 * beside the startup cost it will never pay again.
 */
@Component({
  selector: 'app-cold-start-page',
  imports: [BootWaterfall],
  templateUrl: './cold-start-page.html',
  styleUrl: './cold-start-page.scss',
})
export class ColdStartPage {
  private readonly store = inject(TelemetryStore);

  protected readonly telemetry = this.store.telemetry;
  protected readonly boot = this.store.boot;

  /**
   * What a visitor waits for when the service has scaled to zero.
   *
   * Not the same thing as "startup time": the eager stages are already inside
   * `processReadyMs`, the first request then waits for the lazy stages, and
   * only after that does anything render.
   */
  protected readonly scaleToZeroMs = computed(() => {
    const report = this.boot();
    const render = this.telemetry()?.firstRenderMs ?? 0;

    return report.processReadyMs + report.lazyMs + render;
  });

  /** What the same visit costs against an instance that is already up. */
  protected readonly warmMs = computed(() => {
    const view = this.telemetry();
    if (!view) {
      return 0;
    }

    return view.warmRenderAvgMs ?? (view.coldStart ? 0 : view.renderMs);
  });

  protected readonly ratio = computed(() => {
    const warm = this.warmMs();
    if (warm <= 0) {
      return null;
    }

    return (this.scaleToZeroMs() / warm).toFixed(1);
  });

  protected readonly scaleToZeroLabel = computed(() => formatDuration(this.scaleToZeroMs()));
  protected readonly warmLabel = computed(() => {
    const warm = this.warmMs();
    return warm > 0 ? formatDuration(warm) : 'not measured yet';
  });
  protected readonly readyLabel = computed(() => formatDuration(this.boot().processReadyMs));

  protected format(ms: number | null | undefined): string {
    return ms === null || ms === undefined ? '—' : formatDuration(ms);
  }
}
