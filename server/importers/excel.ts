/**
 * Importador de planilhas Excel para estoque
 * Suporta mapeamento de colunas e validação linha por linha
 */

export interface ExcelRow {
  [key: string]: string | number | undefined;
}

export interface ImportConfig {
  columnMapping: Record<string, number>; // nome_campo -> índice_coluna
  skipRows: number; // linhas para pular no início
}

export interface ImportResult {
  success: boolean;
  totalRows: number;
  processedRows: number;
  errors: Array<{ row: number; error: string }>;
  data: Array<{
    tipo: string;
    bitola: string;
    comprimentoPadrao: number;
    pesoLinear: string;
    quantidade: number;
    localizacao?: string;
  }>;
}

/**
 * Valida e processa dados de uma planilha Excel
 * Retorna dados validados e lista de erros por linha
 */
export function processExcelData(
  rows: ExcelRow[],
  config: ImportConfig
): ImportResult {
  const errors: Array<{ row: number; error: string }> = [];
  const data: ImportResult["data"] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + config.skipRows + 1;

    try {
      // Mapear colunas
      const tipo = String(row[config.columnMapping.tipo] || "").trim();
      const bitola = String(row[config.columnMapping.bitola] || "").trim();
      const comprimentoPadrao = parseInt(
        String(row[config.columnMapping.comprimentoPadrao] || "0")
      );
      const pesoLinear = String(row[config.columnMapping.pesoLinear] || "").trim();
      const quantidade = parseInt(
        String(row[config.columnMapping.quantidade] || "1")
      );

      // Validar campos obrigatórios
      if (!tipo) throw new Error("Tipo é obrigatório");
      if (!bitola) throw new Error("Bitola é obrigatória");
      if (comprimentoPadrao <= 0) throw new Error("Comprimento deve ser maior que 0");
      if (!pesoLinear) throw new Error("Peso linear é obrigatório");
      if (quantidade <= 0) throw new Error("Quantidade deve ser maior que 0");

      data.push({
        tipo,
        bitola,
        comprimentoPadrao,
        pesoLinear,
        quantidade,
      });
    } catch (error) {
      errors.push({
        row: rowNumber,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      });
    }
  });

  return {
    success: errors.length === 0,
    totalRows: rows.length,
    processedRows: data.length,
    errors,
    data,
  };
}
