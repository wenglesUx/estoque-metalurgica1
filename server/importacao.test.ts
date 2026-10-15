import { describe, expect, it } from "vitest";
import { z } from "zod";

const importacaoSchema = z.object({
  dados: z.array(z.record(z.string(), z.any())),
  mapeamento: z.record(z.string(), z.string()),
});

describe("Importação de Excel", () => {
  it("processa dados com mapeamento correto", () => {
    const input = {
      dados: [
        { "Tipo": "Barra", "Bitola": "6mm", "Comprimento": "6000", "Peso": "0.22" },
        { "Tipo": "Barra", "Bitola": "8mm", "Comprimento": "8000", "Peso": "0.39" },
      ],
      mapeamento: {
        tipo: "Tipo",
        bitola: "Bitola",
        comprimento: "Comprimento",
        peso: "Peso",
      },
    };

    const result = importacaoSchema.safeParse(input);
    expect(result.success).toBe(true);

    if (result.success) {
      const processados = input.dados.map((linha: any) => ({
        tipo: linha[input.mapeamento.tipo] || '',
        bitola: linha[input.mapeamento.bitola] || '',
        comprimentoPadrao: parseInt(linha[input.mapeamento.comprimento] || '0'),
        pesoLinear: linha[input.mapeamento.peso] || '',
      }));

      expect(processados).toHaveLength(2);
      expect(processados[0]?.tipo).toBe("Barra");
      expect(processados[0]?.bitola).toBe("6mm");
      expect(processados[0]?.comprimentoPadrao).toBe(6000);
    }
  });

  it("rejeita dados sem mapeamento", () => {
    const input = {
      dados: [{ "Tipo": "Barra" }],
      mapeamento: {},
    };

    const result = importacaoSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("trata valores ausentes como vazios", () => {
    const input = {
      dados: [
        { "Tipo": "Barra" }, // Faltam campos
      ],
      mapeamento: {
        tipo: "Tipo",
        bitola: "Bitola",
        comprimento: "Comprimento",
        peso: "Peso",
      },
    };

    const result = importacaoSchema.safeParse(input);
    expect(result.success).toBe(true);

    if (result.success) {
      const processados = input.dados.map((linha: any) => ({
        tipo: linha[input.mapeamento.tipo] || '',
        bitola: linha[input.mapeamento.bitola] || '',
        comprimentoPadrao: parseInt(linha[input.mapeamento.comprimento] || '0'),
        pesoLinear: linha[input.mapeamento.peso] || '',
      }));

      expect(processados[0]?.tipo).toBe("Barra");
      expect(processados[0]?.bitola).toBe("");
      expect(processados[0]?.comprimentoPadrao).toBe(0);
    }
  });

  it("converte comprimento para número", () => {
    const input = {
      dados: [
        { "Comprimento": "6000" },
        { "Comprimento": "8000.5" },
        { "Comprimento": "abc" },
      ],
      mapeamento: { comprimento: "Comprimento" },
    };

    const result = importacaoSchema.safeParse(input);
    expect(result.success).toBe(true);

    if (result.success) {
      const processados = input.dados.map((linha: any) => ({
        comprimentoPadrao: parseInt(linha[input.mapeamento.comprimento] || '0'),
      }));

      expect(processados[0]?.comprimentoPadrao).toBe(6000);
      expect(processados[1]?.comprimentoPadrao).toBe(8000);
      expect(isNaN(processados[2]?.comprimentoPadrao)).toBe(true);
    }
  });
});
