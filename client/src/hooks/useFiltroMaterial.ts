import { useState, useMemo } from "react";

/**
 * Hook de filtro inteligente para materiais.
 * Centraliza a lógica de filtro usada em Materiais, RegistrosSaida e Movimentacoes.
 *
 * Campos cobertos pelo filtro de texto livre:
 *   tipo, bitola, aco, fornecedor, nf, numero_certificado, corrida,
 *   local, obraNome, rua, vao, obraCodigo
 *
 * Filtros dedicados:
 *   tipo exato, aço, obra, local, fornecedor, comprimento
 */

export interface FiltroMaterialState {
  texto:       string;   // busca livre (multi-campo)
  tipo:        string;   // filtro exato de tipo
  aco:         string;   // filtro exato de aço
  obra:        string;   // filtro por obraNome ou obraCodigo
  local:       string;   // filtro por local/rua/vão
  fornecedor:  string;   // filtro por fornecedor
  comprimento: string;   // filtro por comprimento (mm, exato ou parcial)
}

const FILTRO_INICIAL: FiltroMaterialState = {
  texto:       "",
  tipo:        "",
  aco:         "",
  obra:        "",
  local:       "",
  fornecedor:  "",
  comprimento: "",
};

export function useFiltroMaterial<T extends Record<string, any>>(
  itens: T[] | undefined | null
) {
  const [filtro, setFiltroInterno] = useState<FiltroMaterialState>(FILTRO_INICIAL);

  // Wrapper que reseta paginação automaticamente se quem usa o hook chamar onChangePage
  const setFiltro = (update: Partial<FiltroMaterialState>) => {
    setFiltroInterno(prev => ({ ...prev, ...update }));
  };

  const resetFiltro = () => setFiltroInterno(FILTRO_INICIAL);

  const temFiltroAtivo = Object.values(filtro).some(v => v !== "");

  const filtrados = useMemo(() => {
    if (!itens) return [];

    return itens.filter(m => {
      // ── Texto livre — busca em todos os campos relevantes ───────────────────
      if (filtro.texto.trim()) {
        const t = filtro.texto.toLowerCase().trim();
        const campos = [
          m.tipo, m.bitola, m.aco,
          m.fornecedor, m.nf, m.numero_certificado, m.corrida,
          m.local, m.obraNome, m.rua, m.vao,
          m.obraCodigo,                        // vem do JOIN no db.ts
          m.materialDescricao,                  // campo de movimentacoes
          String(m.comprimento ?? ""),
          String(m.largura ?? ""),
          String(m.espessura ?? ""),
        ]
          .filter(Boolean)
          .map(v => String(v).toLowerCase());

        const match = t.split(/\s+/).every(palavra =>
          campos.some(campo => campo.includes(palavra))
        );
        if (!match) return false;
      }

      // ── Tipo exato ──────────────────────────────────────────────────────────
      if (filtro.tipo) {
        const tipoItem = (m.tipo ?? "").toUpperCase();
        if (tipoItem !== filtro.tipo.toUpperCase()) return false;
      }

      // ── Aço ─────────────────────────────────────────────────────────────────
      if (filtro.aco) {
        const acoItem = (m.aco ?? "").toUpperCase();
        if (!acoItem.includes(filtro.aco.toUpperCase())) return false;
      }

      // ── Obra (nome ou código) ────────────────────────────────────────────────
      if (filtro.obra) {
        const q = filtro.obra.toLowerCase();
        const nomeMatch   = (m.obraNome   ?? "").toLowerCase().includes(q);
        const codigoMatch = (m.obraCodigo ?? "").toLowerCase().includes(q);
        const livreMatch  = filtro.obra.toLowerCase() === "livre" && !m.obraNome;
        if (!nomeMatch && !codigoMatch && !livreMatch) return false;
      }

      // ── Local / Rua / Vão ───────────────────────────────────────────────────
      if (filtro.local) {
        const q = filtro.local.toLowerCase();
        const localMatch = (m.local ?? "").toLowerCase().includes(q);
        const ruaMatch   = (m.rua   ?? "").toLowerCase().includes(q);
        const vaoMatch   = (m.vao   ?? "").toLowerCase().includes(q);
        if (!localMatch && !ruaMatch && !vaoMatch) return false;
      }

      // ── Fornecedor ──────────────────────────────────────────────────────────
      if (filtro.fornecedor) {
        const q = filtro.fornecedor.toLowerCase();
        if (!(m.fornecedor ?? "").toLowerCase().includes(q)) return false;
      }

      // ── Comprimento ─────────────────────────────────────────────────────────
      if (filtro.comprimento.trim()) {
        const q = filtro.comprimento.trim();
        const comprStr = String(m.comprimento ?? m.comprimentoBarra ?? "");
        if (!comprStr.includes(q)) return false;
      }

      return true;
    });
  }, [itens, filtro]);

  return { filtro, setFiltro, resetFiltro, filtrados, temFiltroAtivo };
}
