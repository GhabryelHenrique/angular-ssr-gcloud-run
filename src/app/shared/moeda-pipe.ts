import { Pipe, PipeTransform } from '@angular/core';

const formatador = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Formata em real.
 *
 * Usa `Intl` em vez do `CurrencyPipe` do Angular de propósito: assim o mesmo
 * código roda no Node e no navegador sem `registerLocaleData`, e o preço sai
 * idêntico no HTML do servidor e depois da hidratação — divergência ali
 * derrubaria a hidratação.
 */
@Pipe({ name: 'moeda' })
export class MoedaPipe implements PipeTransform {
  transform(valor: number): string {
    return formatador.format(valor);
  }
}
