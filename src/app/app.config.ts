import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideClientHydration } from '@angular/platform-browser';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // `withComponentInputBinding` faz o :id da rota chegar como input() no componente.
    provideRouter(routes, withComponentInputBinding()),
    // No Angular 22 a hidratação incremental já é o padrão — não precisa de flag.
    provideClientHydration(),
  ],
};
