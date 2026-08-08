import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogStore } from '../../core/catalog';
import { MoedaPipe } from '../../shared/moeda-pipe';

@Component({
  selector: 'app-catalogo',
  imports: [RouterLink, MoedaPipe],
  templateUrl: './catalogo.html',
  styleUrl: './catalogo.scss',
})
export class Catalogo {
  private readonly store = inject(CatalogStore);

  protected readonly produtos = this.store.produtos;
}
