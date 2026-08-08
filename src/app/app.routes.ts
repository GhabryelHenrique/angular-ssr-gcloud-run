import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Catálogo · SSR no Cloud Run',
    loadComponent: () => import('./pages/catalogo/catalogo').then((m) => m.Catalogo),
  },
  {
    path: 'produto/:id',
    title: 'Produto · SSR no Cloud Run',
    loadComponent: () => import('./pages/produto/produto').then((m) => m.Produto),
  },
  {
    path: 'sobre',
    title: 'Sobre · SSR no Cloud Run',
    loadComponent: () => import('./pages/sobre/sobre').then((m) => m.Sobre),
  },
  {
    path: 'painel',
    title: 'Painel · SSR no Cloud Run',
    loadComponent: () => import('./pages/painel/painel').then((m) => m.Painel),
  },
  { path: '**', redirectTo: '' },
];
