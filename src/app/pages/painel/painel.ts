import { Component, afterNextRender, signal } from '@angular/core';

interface InstanciaResposta {
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
 * Rota `Client`: nada é renderizado no servidor.
 *
 * O `view-source:` desta página vem sem conteúdo — só o `<app-root>` vazio e as
 * tags de script. É o cenário do slide 5: o usuário espera o bundle baixar,
 * executar e só então pedir os dados. Duas viagens até o primeiro pixel útil.
 */
@Component({
  selector: 'app-painel',
  templateUrl: './painel.html',
  styleUrl: './painel.scss',
})
export class Painel {
  protected readonly dados = signal<InstanciaResposta | null>(null);
  protected readonly erro = signal<string | null>(null);
  protected readonly buscaMs = signal<number | null>(null);

  constructor() {
    afterNextRender(() => this.carregar());
  }

  protected async carregar(): Promise<void> {
    const inicio = performance.now();
    this.erro.set(null);

    try {
      const resposta = await fetch('/api/instancia');
      if (!resposta.ok) {
        throw new Error(`HTTP ${resposta.status}`);
      }
      this.dados.set((await resposta.json()) as InstanciaResposta);
    } catch (causa) {
      this.erro.set(causa instanceof Error ? causa.message : 'falha desconhecida');
    } finally {
      this.buscaMs.set(Math.round(performance.now() - inicio));
    }
  }
}
