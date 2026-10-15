/**
 * Motor de alocação de barras para planos de corte
 * Implementa algoritmo de prioridade:
 * 1. Retalhos exatos (offcuts)
 * 2. Barras inteiras
 * 3. Barras de outras obras
 */

export interface BarraEstoque {
  id: number;
  comprimento: number;
  quantidade: number;
  obraId: number | null;
  materialId: number;
}

export interface ItemCorte {
  id: number;
  comprimento: number;
  quantidade: number;
  materialId: number;
  obraId: number;
}

export interface AllocationResult {
  itemId: number;
  allocations: Array<{
    barraId: number;
    quantidade: number;
    comprimentoUsado: number;
    comprimentoSobra: number;
    obraOrigem: number | null;
    crossProject: boolean; // true se barra é de outra obra
  }>;
  status: "allocated" | "partial" | "failed";
  message: string;
}

/**
 * Aloca barras do estoque para um item de corte
 * Segue prioridade: retalhos exatos → barras inteiras → outras obras
 */
export function allocateForItem(
  item: ItemCorte,
  estoque: BarraEstoque[]
): AllocationResult {
  const allocations: AllocationResult["allocations"] = [];
  let quantidadeRestante = item.quantidade;
  let totalAllocated = 0;

  // Criar cópia do estoque para não reutilizar barras
  const estoqueCopy = estoque.map((b) => ({ ...b }));

  // Filtrar barras do mesmo material
  const barrasDisponiveis = estoqueCopy.filter((b) => b.materialId === item.materialId);

  if (barrasDisponiveis.length === 0) {
    return {
      itemId: item.id,
      allocations: [],
      status: "failed",
      message: "Nenhuma barra disponível deste material",
    };
  }

  // Prioridade 1: Retalhos exatos (offcuts)
  const retalhoExato = barrasDisponiveis.find(
    (b) => b.comprimento === item.comprimento && b.obraId === item.obraId
  );

  if (retalhoExato && retalhoExato.quantidade > 0) {
    const qtdAlocada = Math.min(retalhoExato.quantidade, quantidadeRestante);
    allocations.push({
      barraId: retalhoExato.id,
      quantidade: qtdAlocada,
      comprimentoUsado: item.comprimento * qtdAlocada,
      comprimentoSobra: 0,
      obraOrigem: retalhoExato.obraId,
      crossProject: false,
    });
    retalhoExato.quantidade -= qtdAlocada;
    quantidadeRestante -= qtdAlocada;
    totalAllocated += qtdAlocada;
  }

  // Prioridade 2: Barras inteiras da mesma obra
  if (quantidadeRestante > 0) {
    const barrasMesmaObra = barrasDisponiveis.filter(
      (b) => b.obraId === item.obraId && b.quantidade > 0
    );

    for (const barra of barrasMesmaObra) {
      if (quantidadeRestante <= 0) break;
      if (barra.comprimento < item.comprimento) continue;

      const qtdAlocada = Math.min(barra.quantidade, quantidadeRestante);
      const comprimentoSobra = barra.comprimento - item.comprimento;

      allocations.push({
        barraId: barra.id,
        quantidade: qtdAlocada,
        comprimentoUsado: item.comprimento * qtdAlocada,
        comprimentoSobra: comprimentoSobra * qtdAlocada,
        obraOrigem: barra.obraId,
        crossProject: false,
      });

      barra.quantidade -= qtdAlocada;
      quantidadeRestante -= qtdAlocada;
      totalAllocated += qtdAlocada;
    }
  }

  // Prioridade 3: Barras de outras obras
  if (quantidadeRestante > 0) {
    const barrasOutrasObras = barrasDisponiveis.filter(
      (b) => b.obraId !== item.obraId && b.quantidade > 0
    );

    for (const barra of barrasOutrasObras) {
      if (quantidadeRestante <= 0) break;
      if (barra.comprimento < item.comprimento) continue;

      const qtdAlocada = Math.min(barra.quantidade, quantidadeRestante);
      const comprimentoSobra = barra.comprimento - item.comprimento;

      allocations.push({
        barraId: barra.id,
        quantidade: qtdAlocada,
        comprimentoUsado: item.comprimento * qtdAlocada,
        comprimentoSobra: comprimentoSobra * qtdAlocada,
        obraOrigem: barra.obraId,
        crossProject: true,
      });

      barra.quantidade -= qtdAlocada;
      quantidadeRestante -= qtdAlocada;
      totalAllocated += qtdAlocada;
    }
  }

  // Determinar status
  let status: AllocationResult["status"] = "failed";
  let message = "Alocação falhou";

  if (totalAllocated === item.quantidade) {
    status = "allocated";
    message = "Alocação completa";
  } else if (totalAllocated > 0) {
    status = "partial";
    message = `Alocação parcial: ${totalAllocated}/${item.quantidade} unidades`;
  }

  return {
    itemId: item.id,
    allocations,
    status,
    message,
  };
}

/**
 * Aloca todas as barras para todos os itens de um plano de corte
 */
export function allocateFullPlan(
  itens: ItemCorte[],
  estoque: BarraEstoque[]
): AllocationResult[] {
  return itens.map((item) => allocateForItem(item, estoque));
}
