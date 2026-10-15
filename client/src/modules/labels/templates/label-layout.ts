// /modules/labels/templates/label-layout.ts
// Estrutura editável da etiqueta (tamanhos em mm) e persistência por navegador

import type { LabelData } from "./industrial-80x50";

export type LabelLineKey =
  | "fornecedor"
  | "nf"
  | "comprimento"
  | "corrida"
  | "obra"
  | "aco"
  | "certificado"
  | "peso"
  | "local"
  | "quantidade";

export interface LabelLineLayout {
  key: LabelLineKey;
  rotulo: string;
  visivel: boolean;
  fontSize: number;
  sublinhado: boolean;
}

export interface LabelLayout {
  // Geral
  paddingVertical: number;
  paddingHorizontal: number;
  espacoLinhas: number;
  bordaVisivel: boolean;
  bordaEspessura: number;
  bordaRaio: number;

  // Cabeçalho
  logoVisivel: boolean;
  logoLargura: number;
  logoProporcional: boolean; // true = altura segue a largura
  logoAltura: number;
  logoDeslocX: number;       // deslocamento em mm (negativo = esquerda)
  logoDeslocY: number;       // deslocamento em mm (negativo = cima)
  tituloTexto: string;
  tituloFontSize: number;
  perfilFontSize: number;

  // QR code (à direita das linhas de dados)
  qrVisivel: boolean;
  qrTamanho: number;

  // Corpo: a ordem do array é a ordem de impressão
  linhas: LabelLineLayout[];
}

const linha = (
  key: LabelLineKey,
  rotulo: string,
  visivel: boolean,
  sublinhado = false
): LabelLineLayout => ({
  key,
  rotulo,
  visivel,
  fontSize: 3,
  sublinhado,
});

export const DEFAULT_LAYOUT: LabelLayout = {
  paddingVertical: 2.5,
  paddingHorizontal: 3,
  espacoLinhas: 0.9,
  bordaVisivel: true,
  bordaEspessura: 0.5,
  bordaRaio: 2.5,

  logoVisivel: true,
  logoLargura: 12,
  logoProporcional: true,
  logoAltura: 18.5,
  logoDeslocX: 0,
  logoDeslocY: 0,
  tituloTexto: "MATÉRIA-PRIMA",
  tituloFontSize: 6.5,
  perfilFontSize: 4.8,

  qrVisivel: true,
  qrTamanho: 22,

  linhas: [
    linha("fornecedor", "FORNECEDOR", true),
    linha("nf", "NOTA FISCAL", true),
    linha("comprimento", "COMPRIMENTO", true),
    linha("corrida", "CORRIDA", true),
    linha("obra", "OBRA", true, true),
    linha("aco", "AÇO", false),
    linha("certificado", "CERTIFICADO", false),
    linha("peso", "PESO", false),
    linha("local", "LOCAL", false),
    linha("quantidade", "QTD", false),
  ],
};

// Valor impresso de cada linha
export function lineValue(key: LabelLineKey, data: LabelData): string {
  if (key === "comprimento" && (data as any).categoria === "CHAPA") {
    return `${(data as any).largura}MM X ${data.comprimento}`;
  }

  const value = data[key];

  return value === null || value === undefined ? "" : String(value);
}

const LAYOUT_STORAGE_KEY = "etiqueta.layout";

// Mescla o layout salvo com o padrão, para que campos e linhas criados
// em versões novas apareçam mesmo em quem já tinha um layout salvo
function mergeWithDefault(stored: Partial<LabelLayout>): LabelLayout {
  const storedLines = Array.isArray(stored.linhas) ? stored.linhas : [];

  const linhas: LabelLineLayout[] = [];

  for (const item of storedLines) {
    const base = DEFAULT_LAYOUT.linhas.find((l) => l.key === item?.key);

    if (base && !linhas.some((l) => l.key === base.key)) {
      linhas.push({ ...base, ...item });
    }
  }

  for (const base of DEFAULT_LAYOUT.linhas) {
    if (!linhas.some((l) => l.key === base.key)) {
      linhas.push({ ...base });
    }
  }

  return { ...DEFAULT_LAYOUT, ...stored, linhas };
}

export function loadLayout(): LabelLayout {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);

    return raw ? mergeWithDefault(JSON.parse(raw)) : DEFAULT_LAYOUT;
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(layout: LabelLayout): void {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // armazenamento indisponível: o layout vale só para esta sessão
  }
}
