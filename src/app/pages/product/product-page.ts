import { Component, computed, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CatalogStore } from '../../core/catalog';
import { PricePipe } from '../../shared/price-pipe';

@Component({
  selector: 'app-product-page',
  imports: [RouterLink, PricePipe],
  templateUrl: './product-page.html',
  styleUrl: './product-page.scss',
})
export class ProductPage {
  private readonly store = inject(CatalogStore);

  /** Bound from the route parameter by `withComponentInputBinding()`. */
  readonly id = input.required<string>();

  protected readonly product = computed(() => this.store.byId(this.id()));
}
