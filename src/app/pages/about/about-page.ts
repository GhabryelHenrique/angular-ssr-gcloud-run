import { Component } from '@angular/core';

/**
 * A `RenderMode.Prerender` route: this page's HTML is produced during
 * `ng build` and shipped as a static file inside `dist/browser`. In production
 * it never wakes the renderer.
 */
@Component({
  selector: 'app-about-page',
  templateUrl: './about-page.html',
  styleUrl: './about-page.scss',
})
export class AboutPage {
  protected readonly generatedAtBuildTime = new Date().toISOString();
}
