import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Hybrid rendering — the render strategy is chosen per route, not per project.
 *
 * This file is the whole argument in twenty lines: one application serves HTML
 * generated on demand, HTML frozen at build time, and no HTML at all,
 * depending on what each route actually needs.
 */
export const serverRoutes: ServerRoute[] = [
  // Price and stock change constantly, so these must render per request.
  {
    path: '',
    renderMode: RenderMode.Server,
  },
  {
    path: 'product/:id',
    renderMode: RenderMode.Server,
  },

  // Same content for everyone, changes only on deploy: the build can handle it.
  // If your whole site looks like this, you may not need SSR at all.
  {
    path: 'about',
    renderMode: RenderMode.Prerender,
  },

  // Deliberately server-rendering nothing, as a control group: `view-source:`
  // on this route comes back empty.
  {
    path: 'dashboard',
    renderMode: RenderMode.Client,
  },

  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
