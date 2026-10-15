// /modules/labels/templates/industrial-80x50.ts
// Definição de tipos e templates de etiqueta

export interface LabelData {
  tipo: string;
  bitola: string;
  comprimento: string;   // ex: "12.000 mm"
  aco: string;
  nf: string;
  corrida: string;
  certificado: string;
  obra: string;
  quantidade: number;
  fornecedor: string;
  peso: string;          // ex: "1.872,000 kg"
  local: string;
  qrConteudo?: string;   // texto do QR code (ver modules/labels/qr-material.ts)
}

export interface LabelTemplate {
  id: string;
  nome: string;
  largura: string;  // CSS: "80mm"
  altura: string;   // CSS: "50mm"
  pageSize?: string; // CSS @page size: "80mm 50mm"; ausente = usa o papel do driver
  orientacao: "horizontal" | "vertical";
}

export const TEMPLATES: LabelTemplate[] = [
  {
    // Sem pageSize: um @page mais largo que alto faz o Chrome mandar o
    // trabalho como "paisagem" e o driver da Honeywell gira a página
    // (vira 50mm de largura). O tamanho vem do papel configurado no driver.
    id: "industrial-80x50-h",
    nome: "80×50mm (Horizontal)",
    largura: "80mm",
    altura: "50mm",
    orientacao: "horizontal",
  },
  {
    id: "industrial-80x50-v",
    nome: "80×50mm (Vertical - Rotacionado)",
    largura: "50mm",
    altura: "80mm",
    pageSize: "50mm 80mm",
    orientacao: "vertical",
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[0];

// Converte dados brutos do material para LabelData
export function materialToLabelData(material: any): LabelData {
  const comprMm = material.comprimento || 0;
  // Comprimento em mm, sem casas decimais (padrão do sistema)
  const comprFormatado = comprMm
    ? `${comprMm.toLocaleString("pt-BR")}MM`
    : "-";

  const peso = parseFloat(String(material.pesoTotal || "0"));
  const pesoFormatado = peso
    ? `${peso.toLocaleString("pt-BR", { minimumFractionDigits: 3 })} kg`
    : "-";

  return {
    tipo: material.tipo || "",
    bitola: material.bitola || "",
    comprimento: comprFormatado,
    aco: material.aco || "",
    nf: material.nf || "-",
    corrida: material.corrida || "-",
    certificado: material.numero_certificado || material.numeroCertificado || "-",
    obra: material.obraNome || "LIVRE",
    quantidade: material.quantidade || 1,
    fornecedor: material.fornecedor || "-",
    peso: pesoFormatado,
    local: material.local || "-",
  };
}
