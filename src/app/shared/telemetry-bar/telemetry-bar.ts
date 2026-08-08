import { Component, afterNextRender, computed, inject } from '@angular/core';
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
    const data = new Date(iso);
    const pad = (valor: number, casas = 2) => String(valor).padStart(casas, '0');

    return (
      `${pad(data.getHours())}:${pad(data.getMinutes())}:${pad(data.getSeconds())}` +
      `.${pad(data.getMilliseconds(), 3)}`
    );
  });

  protected readonly uptimeLabel = computed(() => {
    const ms = this.telemetry()?.uptimeMs ?? 0;
    const totalSegundos = Math.floor(ms / 1000);
    const minutos = Math.floor(totalSegundos / 60);
    const segundos = totalSegundos % 60;

    return minutos > 0 ? `${minutos}m${String(segundos).padStart(2, '0')}s` : `${segundos}s`;
  });

  constructor() {
    // Roda apenas no navegador: é o sinal de que a hidratação assumiu e de que
    // os valores abaixo vieram do TransferState, não de uma nova requisição.
    afterNextRender(() => this.store.markHydrated());
  }
}
