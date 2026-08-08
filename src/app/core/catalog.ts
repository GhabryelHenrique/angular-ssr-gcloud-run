import { Injectable, PendingTasks, inject, signal } from '@angular/core';
import { TelemetryStore } from './telemetry';

export interface Product {
  id: string;
  nome: string;
  categoria: string;
  preco: number;
  estoque: number;
  descricao: string;
}

/**
 * Catálogo da demo.
 *
 * Preço e estoque são exatamente o tipo de conteúdo que o slide 8 usa para
 * justificar SSR: muda a toda hora, então não cabe num build estático — mas
 * precisa estar no HTML porque o robô de busca não espera o JavaScript.
 */
const CATALOGO: readonly Product[] = [
  {
    id: 'kb-01',
    nome: 'Teclado Mecânico 75%',
    categoria: 'Periféricos',
    preco: 489.9,
    estoque: 12,
    descricao: 'Switch tátil, hot-swap, ABNT2.',
  },
  {
    id: 'ms-02',
    nome: 'Mouse Sem Fio Leve',
    categoria: 'Periféricos',
    preco: 299.0,
    estoque: 4,
    descricao: '58g, sensor óptico de 26k DPI.',
  },
  {
    id: 'mn-03',
    nome: 'Monitor 27" 144Hz',
    categoria: 'Monitores',
    preco: 1899.0,
    estoque: 3,
    descricao: 'IPS, 1440p, calibrado de fábrica.',
  },
  {
    id: 'mn-04',
    nome: 'Monitor Portátil 16"',
    categoria: 'Monitores',
    preco: 1249.0,
    estoque: 0,
    descricao: 'USB-C, 1080p, com capa magnética.',
  },
  {
    id: 'hp-05',
    nome: 'Headset com Cancelamento',
    categoria: 'Áudio',
    preco: 1599.0,
    estoque: 7,
    descricao: '35h de bateria, modo transparência.',
  },
  {
    id: 'mc-06',
    nome: 'Microfone USB Cardioide',
    categoria: 'Áudio',
    preco: 749.0,
    estoque: 15,
    descricao: 'Monitoramento sem latência.',
  },
  {
    id: 'dk-07',
    nome: 'Dock Thunderbolt 4',
    categoria: 'Conectividade',
    preco: 2190.0,
    estoque: 2,
    descricao: '96W de carga, dois monitores 4K.',
  },
  {
    id: 'hb-08',
    nome: 'Hub USB-C 7 em 1',
    categoria: 'Conectividade',
    preco: 389.0,
    estoque: 23,
    descricao: 'HDMI 4K60, leitor SD, RJ45.',
  },
  {
    id: 'ss-09',
    nome: 'SSD NVMe 2TB',
    categoria: 'Armazenamento',
    preco: 1099.0,
    estoque: 9,
    descricao: 'PCIe 4.0, 7.400 MB/s de leitura.',
  },
  {
    id: 'hd-10',
    nome: 'HD Externo 5TB',
    categoria: 'Armazenamento',
    preco: 799.0,
    estoque: 6,
    descricao: 'USB 3.2, alimentado pela porta.',
  },
  {
    id: 'cd-11',
    nome: 'Cadeira Ergonômica',
    categoria: 'Estação',
    preco: 2890.0,
    estoque: 1,
    descricao: 'Encosto em tela, apoio lombar ajustável.',
  },
  {
    id: 'br-12',
    nome: 'Braço Articulado p/ Monitor',
    categoria: 'Estação',
    preco: 559.0,
    estoque: 18,
    descricao: 'VESA 75/100, até 9kg.',
  },
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable({ providedIn: 'root' })
export class CatalogStore {
  private readonly pendingTasks = inject(PendingTasks);
  private readonly telemetry = inject(TelemetryStore);

  private readonly items = signal<readonly Product[]>(CATALOGO);

  readonly produtos = this.items.asReadonly();

  constructor() {
    this.simulateSlowBackend();
  }

  byId(id: string): Product | undefined {
    return CATALOGO.find((produto) => produto.id === id);
  }

  /**
   * Encena o estágio 3 do cold start (slide 22): "Angular monta a rota, resolve
   * os dados e serializa o HTML — chamada externa lenta aparece aqui".
   *
   * `PendingTasks.run` é o que faz o SSR realmente esperar antes de serializar;
   * sem isso o Angular fecharia o HTML antes da resposta chegar. Ligue com
   * `RENDER_DELAY_MS=800` para mostrar um backend lento inflando o render.
   */
  private simulateSlowBackend(): void {
    const delay = this.telemetry.telemetry()?.renderDelayMs ?? 0;
    if (delay <= 0) {
      return;
    }

    this.pendingTasks.run(async () => {
      await sleep(delay);
      this.items.set(CATALOGO);
    });
  }
}
