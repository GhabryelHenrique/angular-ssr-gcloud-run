import { Component, computed, inject } from '@angular/core';
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

  protected readonly results = this.store.results;
  protected readonly products = this.store.products;

  protected readonly total = computed(() => this.results().total.toLocaleString('en-US'));
  protected readonly indexed = computed(() => this.results().indexedSkus.toLocaleString('en-US'));

  /**
   * True when the visitor is looking at search results rather than the
   * curated rows, which is the only case where the index actually did work.
   */
  protected readonly searched = computed(() => !this.results().featured);

  /** Everything the current query already has, minus the category filter. */
  protected readonly clearCategoryLink = computed(() => {
    const query = this.results().query;
    return query ? `/?q=${encodeURIComponent(query)}` : '/';
  });

  protected categoryLink(name: string): string {
    const query = this.results().query;
    const parts = [`category=${encodeURIComponent(name)}`];
    if (query) {
      parts.unshift(`q=${encodeURIComponent(query)}`);
    }

    return `/?${parts.join('&')}`;
  }
}
