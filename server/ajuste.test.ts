import { describe, expect, it } from "vitest";
import { z } from "zod";

const ajusteSchema = z.object({
  estoqueId: z.number().positive("Selecione um item de estoque"),
  quantidade: z.string().refine((val) => !isNaN(parseFloat(val)) && parseFloat(val) !== 0, "Quantidade inválida"),
  observacao: z.string().min(10, "Observação deve ter pelo menos 10 caracteres"),
});

describe("Ajuste de Estoque", () => {
  it("valida ajuste com dados corretos", () => {
    const validData = {
      estoqueId: 1,
      quantidade: "50.5",
      observacao: "Recontagem física identificou diferença de 5kg",
    };

    const result = ajusteSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("rejeita ajuste sem estoqueId", () => {
    const invalidData = {
      estoqueId: 0,
      quantidade: "50.5",
      observacao: "Recontagem física identificou diferença de 5kg",
    };

    const result = ajusteSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejeita quantidade zero", () => {
    const invalidData = {
      estoqueId: 1,
      quantidade: "0",
      observacao: "Recontagem física identificou diferença de 5kg",
    };

    const result = ajusteSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejeita quantidade inválida", () => {
    const invalidData = {
      estoqueId: 1,
      quantidade: "abc",
      observacao: "Recontagem física identificou diferença de 5kg",
    };

    const result = ajusteSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("rejeita observação muito curta", () => {
    const invalidData = {
      estoqueId: 1,
      quantidade: "50.5",
      observacao: "Curta",
    };

    const result = ajusteSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });

  it("aceita quantidade negativa", () => {
    const validData = {
      estoqueId: 1,
      quantidade: "-25.0",
      observacao: "Perda por oxidação em barra de 6mm",
    };

    const result = ajusteSchema.safeParse(validData);
    expect(result.success).toBe(true);
  });

  it("calcula saldo posterior corretamente", () => {
    const saldoAnterior = "100.0";
    const quantidade = "50.5";
    const saldoPosterior = (parseFloat(saldoAnterior) + parseFloat(quantidade)).toString();

    expect(saldoPosterior).toBe("150.5");
  });

  it("calcula saldo posterior com quantidade negativa", () => {
    const saldoAnterior = "100.0";
    const quantidade = "-25.0";
    const saldoPosterior = (parseFloat(saldoAnterior) + parseFloat(quantidade)).toString();

    expect(saldoPosterior).toBe("75");
  });
});
