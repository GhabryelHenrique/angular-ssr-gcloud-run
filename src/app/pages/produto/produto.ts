import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogStore } from '../../core/catalog';
import { MoedaPipe } from '../../shared/moeda-pipe';

@Component({
  selector: 'app-produto',
  imports: [RouterLink, MoedaPipe],
  templateUrl: './produto.html',
  styleUrl: './produto.scss',
})
export class Produto {
  private readonly store = inject(CatalogStore);

  /** Vem de `withComponentInputBinding()` — o :id da rota vira input. */
  readonly id = input.required<string>();

  protected readonly produto = computed(() => this.store.byId(this.id()));
}
