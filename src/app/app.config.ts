import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideClientHydration } from '@angular/platform-browser';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // `withComponentInputBinding` turns route params into component inputs,
    // which is how ProductPage receives `:id`.
    provideRouter(routes, withComponentInputBinding()),
    // Angular 22 enables incremental hydration by default — no flag needed.
    provideClientHydration(),
  ],
};
