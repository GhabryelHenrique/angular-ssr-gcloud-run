import { Component, inject } from '@angular/core';
import { ThemeService } from '../../core/theme';

/**
 * Light/dark switch.
 *
 * Both icons are always present in the DOM and CSS reveals the right one based
 * on `:root[data-theme]`. That keeps the server-rendered markup identical to
 * the client-rendered markup, so a visitor whose stored preference differs
 * from the server default still hydrates cleanly.
 */
@Component({
  selector: 'app-theme-toggle',
  templateUrl: './theme-toggle.html',
  styleUrl: './theme-toggle.scss',
})
export class ThemeToggle {
  private readonly themeService = inject(ThemeService);

  protected toggle(): void {
    this.themeService.toggle();
  }
}
