import { DOCUMENT, Injectable, inject, signal } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'preferred-theme';

/**
 * Light/dark theme control.
 *
 * The theme lives in a `data-theme` attribute on `<html>`, which the token
 * layer in `styles.scss` reacts to. Two details make this safe under SSR:
 *
 * 1. The attribute is applied by a tiny inline script in `index.html`, before
 *    first paint. Waiting for Angular to boot would show a flash of the wrong
 *    theme on every load.
 * 2. Nothing in the rendered markup depends on the current theme — the toggle
 *    ships both icons and lets CSS pick one. A server render and a client
 *    render therefore produce identical HTML, so hydration never mismatches
 *    even when the visitor's stored preference differs from the default.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);

  private readonly current = signal<Theme>(this.read());

  readonly theme = this.current.asReadonly();

  toggle(): void {
    this.apply(this.current() === 'dark' ? 'light' : 'dark');
  }

  private apply(theme: Theme): void {
    this.current.set(theme);

    const root = this.document.documentElement;
    root.setAttribute('data-theme', theme);

    // Storage can throw in private browsing modes; a failed write should not
    // break the toggle itself.
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference simply will not persist across reloads.
    }
  }

  private read(): Theme {
    const attribute = this.document.documentElement.getAttribute('data-theme');

    return attribute === 'dark' || attribute === 'light' ? attribute : 'light';
  }
}
