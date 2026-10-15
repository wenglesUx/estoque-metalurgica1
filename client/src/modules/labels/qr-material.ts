// /modules/labels/qr-material.ts
// Conteúdo do QR code da etiqueta e leitura do código de volta.
//
// O QR é uma linha única de texto legível por qualquer leitor (câmera do
// celular mostra as informações direto). O sistema só precisa do trecho
// "HCM-MAT-<id>" para achar o material e buscar os dados atualizados.
//
// Linha única e sem acentos de propósito: leitores USB/Bluetooth "digitam" o
// conteúdo como teclado — uma quebra de linha viraria um Enter no meio da
// leitura, e caracteres acentuados mudam conforme o layout do teclado.

const PREFIXO = "HCM-MAT-";

export interface MaterialParaQr {
  id: number | string;
  categoria?: string | null;
  tipo?: string | null;
  bitola?: string | null;
  aco?: string | null;
  comprimento?: number | null;
  largura?: number | null;
  nf?: string | null;
  corrida?: string | null;
  obraNome?: string | null;
  obraCompraNome?: string | null;
  createdAt?: string | Date | null;
}

// Tira acentos e troca o que sobrar fora do ASCII (travessão, aspas curvas)
const semAcento = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\x20-\x7E]/g, "-");

const limpo = (valor: unknown) =>
  valor === null || valor === undefined || String(valor).trim() === ""
    ? "-"
    : semAcento(String(valor).trim()).replace(/\|/g, "/");

const dataBr = (valor: string | Date | null | undefined) => {
  if (!valor) return "-";

  const data = new Date(valor);

  return isNaN(data.getTime())
    ? "-"
    : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
};

export function montarConteudoQr(
  material: MaterialParaQr,
  quantidade: number | string,
  grds: string[] = []
): string {
  const dimensao =
    material.categoria === "CHAPA"
      ? `${material.largura ?? "-"}X${material.comprimento ?? "-"}MM`
      : `${material.comprimento ?? "-"}MM`;

  return [
    `${PREFIXO}${material.id}`,
    `${limpo(material.categoria || "PERFIL")} ${limpo(material.tipo)} ${limpo(material.bitola)}`,
    `ACO ${limpo(material.aco)}`,
    `QTD ${limpo(quantidade)} PC`,
    `DIM ${dimensao}`,
    `NF ${limpo(material.nf)}`,
    `CORRIDA ${limpo(material.corrida)}`,
    `GRD ${grds.length ? limpo(grds.join(",")) : "-"}`,
    `OBRA ${limpo(material.obraNome || "LIVRE")}`,
    `COMPRA ${limpo(material.obraCompraNome)}`,
    `ENTRADA ${dataBr(material.createdAt)}`,
  ].join(" | ");
}

/**
 * Extrai o id do material de uma leitura. Aceita o QR completo, só o código
 * ("HCM-MAT-123", tolerando separador trocado pelo layout do teclado do
 * leitor) ou só o número digitado à mão.
 */
export function lerCodigoMaterial(texto: string): number | null {
  const valor = texto.trim();

  const match = valor.match(/HCM[^0-9A-Z]{0,2}MAT[^0-9A-Z]{0,2}(\d+)/i);

  if (match) return Number(match[1]);

  if (/^\d+$/.test(valor)) return Number(valor);

  return null;
}
