import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogStore } from '../../core/catalog';
import { PricePipe } from '../../shared/price-pipe';

@Component({
  selector: 'app-catalog-page',
  imports: [RouterLink, PricePipe],
  templateUrl: './catalog-page.html',
  styleUrl: './catalog-page.scss',
})
export class CatalogPage {
  private readonly store = inject(CatalogStore);

  protected readonly products = this.store.products;
}
