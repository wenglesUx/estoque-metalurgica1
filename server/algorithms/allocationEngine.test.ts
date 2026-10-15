import { describe, expect, it } from "vitest";
import { allocateForItem, type BarraEstoque, type ItemCorte } from "./allocationEngine";

describe("Allocation Engine - Algoritmo de Alocação", () => {
  const mockEstoque: BarraEstoque[] = [
    // Retalho exato (prioridade 1)
    { id: 1, comprimento: 1000, quantidade: 2, obraId: 1, materialId: 1 },
    // Barra inteira da mesma obra (prioridade 2)
    { id: 2, comprimento: 6000, quantidade: 3, obraId: 1, materialId: 1 },
    // Barra de outra obra (prioridade 3)
    { id: 3, comprimento: 6000, quantidade: 2, obraId: 2, materialId: 1 },
  ];

  describe("Prioridade 1: Retalhos Exatos", () => {
    it("deve alocar retalho exato quando disponível", () => {
      const item: ItemCorte = {
        id: 1,
        comprimento: 1000,
        quantidade: 1,
        materialId: 1,
        obraId: 1,
      };

      const result = allocateForItem(item, mockEstoque);

      expect(result.status).toBe("allocated");
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0]?.barraId).toBe(1);
      expect(result.allocations[0]?.crossProject).toBe(false);
    });
  });

  describe("Prioridade 2: Barras Inteiras da Mesma Obra", () => {
    it("deve alocar barra inteira quando retalho não disponível", () => {
      const item: ItemCorte = {
        id: 1,
        comprimento: 2000,
        quantidade: 1,
        materialId: 1,
        obraId: 1,
      };

      const result = allocateForItem(item, mockEstoque);

      expect(result.status).toBe("allocated");
      expect(result.allocations.length).toBeGreaterThan(0);
      expect(result.allocations.some((a) => a.crossProject === false)).toBe(true);
    });
  });

  describe("Prioridade 3: Barras de Outras Obras", () => {
    it("deve alocar barra de outra obra quando necessário", () => {
      const estoque: BarraEstoque[] = [
        { id: 1, comprimento: 6000, quantidade: 0, obraId: 1, materialId: 1 },
        { id: 2, comprimento: 6000, quantidade: 1, obraId: 2, materialId: 1 },
      ];

      const item: ItemCorte = {
        id: 1,
        comprimento: 2000,
        quantidade: 1,
        materialId: 1,
        obraId: 1,
      };

      const result = allocateForItem(item, estoque);

      expect(result.allocations.some((a) => a.crossProject === true)).toBe(true);
    });

    it("deve marcar como crossProject quando usa barra de outra obra", () => {
      const estoque: BarraEstoque[] = [
        { id: 1, comprimento: 6000, quantidade: 1, obraId: 2, materialId: 1 },
      ];

      const item: ItemCorte = {
        id: 1,
        comprimento: 2000,
        quantidade: 1,
        materialId: 1,
        obraId: 1,
      };

      const result = allocateForItem(item, estoque);

      expect(result.allocations[0]?.crossProject).toBe(true);
    });
  });

  describe("Alocação Parcial", () => {
    it("deve retornar status 'partial' quando quantidade insuficiente", () => {
      const estoque: BarraEstoque[] = [
        { id: 1, comprimento: 1000, quantidade: 1, obraId: 1, materialId: 1 },
      ];

      const item: ItemCorte = {
        id: 1,
        comprimento: 1000,
        quantidade: 5,
        materialId: 1,
        obraId: 1,
      };

      const result = allocateForItem(item, estoque);

      expect(result.status).toBe("partial");
      expect(result.message).toContain("parcial");
    });
  });

  describe("Falha de Alocação", () => {
    it("deve falhar quando material não está em estoque", () => {
      const item: ItemCorte = {
        id: 1,
        comprimento: 1000,
        quantidade: 1,
        materialId: 999, // Material não existe
        obraId: 1,
      };

      const result = allocateForItem(item, mockEstoque);

      expect(result.status).toBe("failed");
      expect(result.allocations).toHaveLength(0);
    });
  });

  describe("Cálculo de Sobras", () => {
    it("deve calcular comprimento de sobra corretamente", () => {
      const estoque: BarraEstoque[] = [
        { id: 1, comprimento: 6000, quantidade: 1, obraId: 1, materialId: 1 },
      ];

      const item: ItemCorte = {
        id: 1,
        comprimento: 2000,
        quantidade: 1,
        materialId: 1,
        obraId: 1,
      };

      const result = allocateForItem(item, estoque);

      // Sobra = (6000 - 2000) = 4000
      expect(result.allocations[0]?.comprimentoSobra).toBe(4000);
    });
  });
});
