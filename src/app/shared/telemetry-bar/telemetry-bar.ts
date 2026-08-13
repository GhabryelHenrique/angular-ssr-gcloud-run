import { Component, afterNextRender, computed, inject } from '@angular/core';
import { formatDuration } from '../../core/boot-report';
import { TelemetryStore } from '../../core/telemetry';

@Component({
  selector: 'app-telemetry-bar',
  templateUrl: './telemetry-bar.html',
  styleUrl: './telemetry-bar.scss',
})
export class TelemetryBar {
  private readonly store = inject(TelemetryStore);

  protected readonly telemetry = this.store.telemetry;
  protected readonly renderOrigin = this.store.renderOrigin;
  protected readonly hydrated = this.store.hydrated;

  protected readonly renderedAtLabel = computed(() => {
    const iso = this.telemetry()?.renderedAt;
    if (!iso) {
      return '--:--:--';
    }
    const date = new Date(iso);
    const pad = (value: number, digits = 2) => String(value).padStart(digits, '0');

    return (
      `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` +
      `.${pad(date.getMilliseconds(), 3)}`
    );
  });

  /**
   * What this instance paid at startup.
   *
   * Shown on every request, warm ones included, because the interesting moment
   * is the reload: the same instance reports the same startup cost next to a
   * render time twenty times smaller.
   */
  protected readonly bootLabel = computed(() => formatDuration(this.store.boot().totalMs));

  protected readonly showBoot = computed(() => this.store.boot().totalMs > 0);

  protected readonly uptimeLabel = computed(() => {
    const ms = this.telemetry()?.uptimeMs ?? 0;
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, '0')}s` : `${seconds}s`;
  });

  constructor() {
    // Runs in the browser only: proof that hydration took over and that the
    // values below came from TransferState, not from a fresh request.
    afterNextRender(() => this.store.markHydrated());
  }
}
