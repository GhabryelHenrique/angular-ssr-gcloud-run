import { Pipe, PipeTransform } from '@angular/core';

const formatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

/**
 * Formats a price.
 *
 * Uses `Intl` rather than Angular's `CurrencyPipe` on purpose: the same code
 * then runs in Node and in the browser without `registerLocaleData`, and the
 * formatted output is byte-identical on both sides. A mismatch between the
 * server-rendered HTML and the client render would break hydration.
 */
@Pipe({ name: 'price' })
export class PricePipe implements PipeTransform {
  transform(value: number): string {
    return formatter.format(value);
  }
}
