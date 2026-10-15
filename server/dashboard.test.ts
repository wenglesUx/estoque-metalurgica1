import { describe, expect, it } from "vitest";

describe("Dashboard Alertas", () => {
  it("identifica itens com saldo menor que 50kg", () => {
    const items = [
      { id: 1, saldoAtual: "100", materialId: 1, comprimentoBarra: 6000, quantidade: 5 },
      { id: 2, saldoAtual: "30", materialId: 2, comprimentoBarra: 8000, quantidade: 2 },
      { id: 3, saldoAtual: "45", materialId: 3, comprimentoBarra: 10000, quantidade: 1 },
      { id: 4, saldoAtual: "150", materialId: 1, comprimentoBarra: 6000, quantidade: 8 },
    ];

    const alertas = items
      .filter((item: any) => parseFloat(item.saldoAtual || "0") < 50)
      .map((item: any) => ({
        id: item.id,
        materialId: item.materialId,
        saldoAtual: item.saldoAtual,
      }));

    expect(alertas).toHaveLength(2);
    expect(alertas[0]?.id).toBe(2);
    expect(alertas[1]?.id).toBe(3);
  });

  it("calcula total de kg corretamente", () => {
    const items = [
      { saldoAtual: "100.5" },
      { saldoAtual: "50.25" },
      { saldoAtual: "75.75" },
    ];

    const totalKg = items.reduce((sum: number, item: any) => {
      return sum + parseFloat(item.saldoAtual || "0");
    }, 0);

    expect(totalKg).toBe(226.5);
  });

  it("calcula total de barras corretamente", () => {
    const items = [
      { quantidade: 5 },
      { quantidade: 3 },
      { quantidade: 7 },
    ];

    const totalBarras = items.reduce((sum: number, item: any) => {
      return sum + (item.quantidade || 0);
    }, 0);

    expect(totalBarras).toBe(15);
  });

  it("retorna array vazio quando nenhum alerta", () => {
    const items = [
      { id: 1, saldoAtual: "100", materialId: 1 },
      { id: 2, saldoAtual: "200", materialId: 2 },
    ];

    const alertas = items
      .filter((item: any) => parseFloat(item.saldoAtual || "0") < 50)
      .map((item: any) => ({ id: item.id }));

    expect(alertas).toHaveLength(0);
  });

  it("trata saldoAtual nulo como 0", () => {
    const items = [
      { id: 1, saldoAtual: null, materialId: 1 },
      { id: 2, saldoAtual: "30", materialId: 2 },
    ];

    const alertas = items
      .filter((item: any) => parseFloat(item.saldoAtual || "0") < 50)
      .map((item: any) => ({ id: item.id }));

    expect(alertas).toHaveLength(2);
  });
});
