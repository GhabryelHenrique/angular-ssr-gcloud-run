import { Component, computed, input } from '@angular/core';
import { formatDuration, type BootReport, type BootStage } from '../../core/boot-report';

interface WaterfallRow extends BootStage {
  /** Where the bar starts, as a percentage of the whole startup. */
  offsetPct: number;
  /** How wide the bar is, floored so a 4 ms stage is still visible. */
  widthPct: number;
  durationLabel: string;
  sharePct: number;
}

/**
 * The startup sequence drawn as a waterfall.
 *
 * A single "cold start: 2.1 s" number tells you nothing actionable. The same
 * 2.1 s split into secret fetch, key derivation, index build and pool connect
 * tells you which one to attack — and which ones `--cpu-boost` can help with,
 * since it only accelerates the CPU-bound stages.
 */
@Component({
  selector: 'app-boot-waterfall',
  templateUrl: './boot-waterfall.html',
  styleUrl: './boot-waterfall.scss',
})
export class BootWaterfall {
  readonly report = input.required<BootReport>();

  protected readonly rows = computed<WaterfallRow[]>(() => {
    const report = this.report();
    const scale = Math.max(1, report.totalMs);

    let offset = 0;

    return report.stages.map((stage) => {
      const offsetPct = (offset / scale) * 100;
      const sharePct = (stage.durationMs / scale) * 100;
      offset += stage.durationMs;

      return {
        ...stage,
        offsetPct,
        widthPct: Math.max(sharePct, 1.2),
        sharePct: Math.round(sharePct),
        durationLabel: formatDuration(stage.durationMs),
      };
    });
  });

  protected readonly eagerLabel = computed(() => formatDuration(this.report().eagerMs));
  protected readonly lazyLabel = computed(() => formatDuration(this.report().lazyMs));
  protected readonly totalLabel = computed(() => formatDuration(this.report().totalMs));
}
