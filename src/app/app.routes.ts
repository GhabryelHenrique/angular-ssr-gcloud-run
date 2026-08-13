import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    title: 'Catalog · Angular SSR on Cloud Run',
    loadComponent: () => import('./pages/catalog/catalog-page').then((m) => m.CatalogPage),
  },
  {
    path: 'product/:id',
    title: 'Product · Angular SSR on Cloud Run',
    loadComponent: () => import('./pages/product/product-page').then((m) => m.ProductPage),
  },
  {
    path: 'cold-start',
    title: 'Cold start · Angular SSR on Cloud Run',
    loadComponent: () => import('./pages/cold-start/cold-start-page').then((m) => m.ColdStartPage),
  },
  {
    path: 'about',
    title: 'About · Angular SSR on Cloud Run',
    loadComponent: () => import('./pages/about/about-page').then((m) => m.AboutPage),
  },
  {
    path: 'dashboard',
    title: 'Dashboard · Angular SSR on Cloud Run',
    loadComponent: () => import('./pages/dashboard/dashboard-page').then((m) => m.DashboardPage),
  },
  { path: '**', redirectTo: '' },
];
