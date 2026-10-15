export function asNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/**
 * Formata peso (recebido sempre em kg) de forma padronizada: abaixo de
 * 1000kg mostra em kg (sem casas decimais), a partir de 1000kg mostra em
 * toneladas (1 casa decimal). Usada nos cards de peso do Dashboard e de
 * Relatórios pra manter a mesma regra de unidade — antes "Peso total do
 * estoque" convertia pra "t" e "Consumo no período" ficava sempre em "kg",
 * mesmo quando ambos passavam de 1 tonelada.
 */
export function formatWeight(value: unknown): string {
  const number = asNumber(value);
  const abs = Math.abs(number);
  if (abs >= 1000) {
    return `${(number / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} t`;
  }
  return `${number.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} kg`;
}
