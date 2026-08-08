import { RenderMode, ServerRoute } from '@angular/ssr';

/**
 * Renderização híbrida — a escolha é por rota, não por projeto (slides 8 e 15).
 *
 * Este arquivo é o argumento inteiro do capítulo 1 em vinte linhas: a mesma
 * aplicação serve HTML gerado sob demanda, HTML congelado no build e HTML
 * nenhum, dependendo do que cada rota precisa.
 */
export const serverRoutes: ServerRoute[] = [
  // Preço e estoque mudam a toda hora: precisa renderizar a cada requisição.
  {
    path: '',
    renderMode: RenderMode.Server,
  },
  {
    path: 'produto/:id',
    renderMode: RenderMode.Server,
  },

  // Conteúdo igual para todo mundo, muda só no deploy: o build resolve.
  // É o "talvez você não precise de SSR nenhum" do slide 15.
  {
    path: 'sobre',
    renderMode: RenderMode.Prerender,
  },

  // Deliberadamente sem SSR, para servir de contraste no palco: o
  // `view-source:` desta rota vem vazio.
  {
    path: 'painel',
    renderMode: RenderMode.Client,
  },

  {
    path: '**',
    renderMode: RenderMode.Server,
  },
];
