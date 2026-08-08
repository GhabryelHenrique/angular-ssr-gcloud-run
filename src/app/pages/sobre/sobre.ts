import { Component } from '@angular/core';

/**
 * Rota `Prerender`: o HTML desta página é gerado no `ng build` e vira um
 * arquivo estático no `dist/browser`. Em produção ela nem acorda o servidor.
 */
@Component({
  selector: 'app-sobre',
  templateUrl: './sobre.html',
  styleUrl: './sobre.scss',
})
export class Sobre {
  protected readonly geradoNoBuild = new Date().toISOString();
}
