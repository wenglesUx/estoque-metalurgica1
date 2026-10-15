import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Relatório de Recebimento — modelo de dados e geração do PDF.
 *
 * Um relatório cobre tudo que chegou no dia, então pode ter várias CARGAS
 * (uma por nota fiscal/fornecedor). Cada carga carrega as próprias
 * referências, materiais, observações e fotos, pra nada se misturar.
 */

export type Conferencia = "100%" | "Parcial";

export interface CargaRelatorio {
  id: string;
  fornecedor: string;
  nf: string;
  numeroPedido: string;
  pesoNota: string;
  localDescarga: string;
  conferenciaNota: Conferencia;
  conferenciaPedido: Conferencia;
  observacoes: string;
  itens: any[];
  // Ids das fotos (relatorio_recebimento_imagens) que pertencem a esta carga.
  fotoIds: number[];
}

export interface DadosRelatorio {
  versao: 2;
  cargas: CargaRelatorio[];
  conferidoPor: string;
  vistoQualidade: string;
}

export interface FotoRelatorio {
  base64: string;
  tipo: string;
  cargaId: string | null;
}

export function parsePtBrNumber(value: string): number | null {
  const normalized = String(value ?? "").trim().replace(/\s/g, "");
  if (!normalized) return null;
  const normalizedNumber = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
  const numberValue = Number(normalizedNumber);
  return Number.isFinite(numberValue) ? numberValue : null;
}

export function formatKg(value: number, digits = 2): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const numeroDocumentoRelatorio = (id: number) => `REL-${String(id).padStart(5, "0")}`;

export const pesoDosItens = (itens: any[]) =>
  itens.reduce((sum, item) => sum + (parseFloat(String(item.pesoTotal || 0)) || 0), 0);

const observacoesDosItens = (itens: any[]) =>
  Array.from(new Set(itens.map(item => item.observacoes).filter(Boolean))).join(" | ");

export const descricaoItem = (item: any) => `${item.tipo || ""} ${item.bitola || ""}`.trim() || "-";

export const dimensoesItem = (item: any) =>
  item.categoria === "CHAPA"
    ? `${(item.largura || 0).toLocaleString("pt-BR")} × ${(item.comprimento || 0).toLocaleString("pt-BR")}`
    : (item.comprimento || 0).toLocaleString("pt-BR");

const novaCarga = (indice: number, itens: any[]): CargaRelatorio => {
  const primeiro = itens[0] || {};
  return {
    id: `c${indice + 1}`,
    fornecedor: primeiro.fornecedor || "",
    nf: primeiro.nf || "",
    numeroPedido: itens.find(item => item.numeroPedido)?.numeroPedido || "",
    pesoNota: formatKg(pesoDosItens(itens), 3),
    localDescarga: itens.find(item => item.local)?.local || "",
    conferenciaNota: "100%",
    conferenciaPedido: "100%",
    observacoes: observacoesDosItens(itens),
    itens,
    fotoIds: [],
  };
};

/**
 * Separa os materiais selecionados em cargas: cada combinação de nota
 * fiscal + fornecedor vira uma carga, na ordem em que aparece.
 */
export function agruparItensEmCargas(itens: any[]): CargaRelatorio[] {
  const grupos = new Map<string, any[]>();
  for (const item of itens) {
    const chave = `${String(item.nf || "").trim().toUpperCase()}|${String(item.fornecedor || "").trim().toUpperCase()}`;
    grupos.set(chave, [...(grupos.get(chave) || []), item]);
  }
  return Array.from(grupos.values()).map((grupo, indice) => novaCarga(indice, grupo));
}

/**
 * Lê os dados salvos de um relatório em qualquer formato: o atual (várias
 * cargas) ou o antigo ({ itens, meta }, uma carga só).
 */
export function normalizarDadosRelatorio(dados: any): DadosRelatorio {
  if (Array.isArray(dados?.cargas)) {
    return {
      versao: 2,
      cargas: dados.cargas.map((c: any, indice: number) => ({
        ...novaCarga(indice, c.itens || []),
        ...c,
        id: c.id || `c${indice + 1}`,
        itens: c.itens || [],
        fotoIds: c.fotoIds || [],
      })),
      conferidoPor: dados.conferidoPor || "",
      vistoQualidade: dados.vistoQualidade || "",
    };
  }
  const itens = dados?.itens || [];
  const meta = dados?.meta || {};
  const base = novaCarga(0, itens);
  return {
    versao: 2,
    cargas: [{
      ...base,
      fornecedor: meta.fornecedor || base.fornecedor,
      nf: meta.nf || base.nf,
      numeroPedido: meta.numeroPedido || base.numeroPedido,
      pesoNota: meta.pesoNota || base.pesoNota,
      localDescarga: meta.localDescarga || base.localDescarga,
      conferenciaNota: meta.conferenciaNota || "100%",
      conferenciaPedido: meta.conferenciaPedido || "100%",
      observacoes: (meta.observacoes || "").trim() || base.observacoes,
    }],
    conferidoPor: meta.conferidoPor || "",
    vistoQualidade: meta.vistoQualidade || "",
  };
}

/** Devolve a mensagem do primeiro campo obrigatório faltando, ou null se está tudo certo. */
export function validarDadosRelatorio(dados: DadosRelatorio): string | null {
  if (dados.cargas.length === 0) return "O relatório precisa ter ao menos uma carga.";
  for (let i = 0; i < dados.cargas.length; i++) {
    const carga = dados.cargas[i];
    const rotulo = dados.cargas.length > 1 ? ` da carga ${String(i + 1).padStart(2, "0")}` : "";
    if (carga.itens.length === 0) return `Não sobrou nenhum material${rotulo || " no relatório"}.`;
    if (!carga.fornecedor.trim()) return `Informe o fornecedor${rotulo}.`;
    if (!carga.nf.trim()) return `Informe a Nota Fiscal${rotulo}.`;
    if (!carga.localDescarga.trim()) return `Informe o local físico de descarga${rotulo}.`;
    if (parsePtBrNumber(carga.pesoNota) === null) return `Informe um peso total da nota válido${rotulo}.`;
  }
  return null;
}

// Comprime a imagem no navegador antes do upload — mesma lógica usada em
// Solicitações (reduz uma foto de celular de alguns MB pra poucas centenas
// de KB, redimensionando pro maior lado ficar em até 1600px).
export function comprimirImagemRecebimento(file: File): Promise<{ base64: string; tipo: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX_LADO = 1600;
        let { width, height } = img;
        if (width > MAX_LADO || height > MAX_LADO) {
          const escala = MAX_LADO / Math.max(width, height);
          width = Math.round(width * escala);
          height = Math.round(height * escala);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas indisponível")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        resolve({ base64: dataUrl.split(",")[1] || "", tipo: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = ev.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Carrega a mesma logo usada no login/sidebar (SVG -> canvas -> PNG, formato que o jsPDF aceita).
async function carregarLogo(): Promise<string | null> {
  try {
    const response = await fetch("/brand/hcm-industrial.svg");
    if (!response.ok) return null;
    const svgText = await response.text();
    const blobUrl = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = blobUrl;
    });
    const canvas = document.createElement("canvas");
    const width = 720;
    const ratio = image.width && image.height ? image.width / image.height : 2.5;
    canvas.width = width;
    canvas.height = Math.max(180, Math.round(width / ratio));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(blobUrl);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

type Cor = [number, number, number];

/**
 * Monta o PDF do relatório em A4 retrato. Estrutura:
 *   1. cabeçalho + resumo do dia (e índice das cargas, quando há mais de uma);
 *   2. um bloco por carga — faixa de identificação, referências, materiais e
 *      observações daquela carga;
 *   3. registro fotográfico, separado por carga com a mesma identificação
 *      (continua na mesma página quando cabe);
 *   4. responsáveis (assinaturas), sempre por último.
 */
export async function gerarPdfRecebimento(
  dados: DadosRelatorio,
  numeroDocumento: string,
  fotos: FotoRelatorio[] = [],
  emitidoEm: Date = new Date(),
): Promise<string> {
  const W = 210;
  const H = 297;
  const margin = 12;
  const CW = W - margin * 2;
  const topoContinuacao = 17;
  const limiteInferior = H - 16;

  const graphite: Cor = [26, 35, 50];
  const gold: Cor = [214, 162, 27];
  const warm: Cor = [248, 246, 241];
  const line: Cor = [220, 225, 229];
  const muted: Cor = [98, 111, 124];
  const green: Cor = [35, 126, 80];
  const greenSoft: Cor = [232, 245, 237];
  const amber: Cor = [156, 103, 14];
  const amberSoft: Cor = [255, 248, 226];
  const amberBorder: Cor = [235, 215, 157];

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  doc.setProperties({ title: `Relatório de Recebimento HCM ${numeroDocumento}`, subject: "Controle de entrada e rastreabilidade de materiais" });

  const cargas = dados.cargas;
  const rotuloCarga = (indice: number) => `CARGA ${String(indice + 1).padStart(2, "0")}`;
  const caber = (texto: string, largura: number) => {
    const linhas = doc.splitTextToSize(texto || "-", largura);
    return linhas.length > 1 ? `${String(linhas[0]).replace(/\s+$/, "")}...` : String(linhas[0] ?? "-");
  };

  let y = 0;
  const garantirEspaco = (altura: number) => {
    if (y + altura > limiteInferior) {
      doc.addPage();
      y = topoContinuacao;
    }
  };

  const tituloSecao = (titulo: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...graphite);
    doc.text(titulo.toUpperCase(), margin, y);
    const largura = doc.getTextWidth(titulo.toUpperCase());
    doc.setDrawColor(...line);
    doc.setLineWidth(0.25);
    doc.line(margin + largura + 4, y - 1.2, W - margin, y - 1.2);
    y += 4;
  };

  const pilulaStatus = (valor: string, x: number, yBase: number) => {
    const parcial = valor === "Parcial";
    const largura = parcial ? 25 : 18;
    doc.setFillColor(...(parcial ? amberSoft : greenSoft));
    doc.roundedRect(x, yBase - 4.6, largura, 6, 2.4, 2.4, "F");
    doc.setFillColor(...(parcial ? amber : green));
    doc.circle(x + 3.2, yBase - 1.6, 1, "F");
    doc.setTextColor(...(parcial ? amber : green));
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(valor, x + 6, yBase - 0.7);
  };

  // Faixa que identifica a carga — a MESMA nos dados e nas fotos, pra bater o olho e saber de qual carga é.
  const faixaCarga = (indice: number, complemento?: string) => {
    const carga = cargas[indice];
    const altura = 9;
    doc.setFillColor(...graphite);
    doc.roundedRect(margin, y, CW, altura, 1.5, 1.5, "F");
    doc.setFillColor(...gold);
    doc.roundedRect(margin, y, 25, altura, 1.5, 1.5, "F");
    doc.rect(margin + 3, y, 22, altura, "F");
    doc.setTextColor(...graphite);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(rotuloCarga(indice), margin + 12.5, y + 5.9, { align: "center" });

    const textoDireita = complemento ? `NF ${carga.nf || "-"}  ·  ${complemento}` : `NF ${carga.nf || "-"}`;
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8.5);
    const larguraDireita = doc.getTextWidth(textoDireita);
    doc.text(textoDireita, W - margin - 3, y + 5.9, { align: "right" });
    doc.text(caber(carga.fornecedor || "Fornecedor não informado", CW - 25 - larguraDireita - 12), margin + 28.5, y + 5.9);
    y += altura;
  };

  // ── Cabeçalho institucional HCM ────────────────────────────────────────────
  const logoData = await carregarLogo();
  doc.setFillColor(...warm);
  doc.rect(0, 0, W, 31, "F");
  doc.setFillColor(...gold);
  doc.rect(0, 0, W, 2.5, "F");
  if (logoData) {
    doc.addImage(logoData, "PNG", margin, 8, 28, 16);
  } else {
    doc.setTextColor(...graphite);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("HCM", margin, 18);
    doc.setFontSize(6);
    doc.text("INDUSTRIAL", margin + 1, 23);
  }
  doc.setTextColor(...gold);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text("CONTROLE DE MATERIAIS", 45, 11.5);
  doc.setTextColor(...graphite);
  doc.setFontSize(15);
  doc.text("Relatório de Recebimento", 45, 19);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.2);
  doc.setTextColor(...muted);
  doc.text("Entrada, conferência e rastreabilidade de materiais", 45, 24.5);
  doc.setFontSize(6.2);
  doc.setFont("helvetica", "bold");
  doc.text("IDENTIFICAÇÃO DO DOCUMENTO", W - margin, 11, { align: "right" });
  doc.setTextColor(...graphite);
  doc.setFontSize(11);
  doc.text(numeroDocumento, W - margin, 17.5, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(...muted);
  const dataEmissao = emitidoEm.toLocaleDateString("pt-BR");
  const horaEmissao = emitidoEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  doc.text(`Emitido em ${dataEmissao} às ${horaEmissao}`, W - margin, 23, { align: "right" });

  // ── Resumo do recebimento ──────────────────────────────────────────────────
  const todosItens = cargas.flatMap(c => c.itens);
  const pesoRecebidoTotal = pesoDosItens(todosItens);
  const quantidadeTotal = todosItens.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);
  const pesosNotas = cargas.map(c => parsePtBrNumber(c.pesoNota));
  const pesoNotasTotal = pesosNotas.every(p => p !== null) ? pesosNotas.reduce((sum: number, p) => sum + (p || 0), 0) : null;

  y = 39;
  tituloSecao("Resumo do recebimento");
  const gapMetrica = 3;
  const larguraMetrica = (CW - gapMetrica * 3) / 4;
  const metricas: [string, string, string][] = [
    ["Cargas", String(cargas.length), cargas.length === 1 ? "nota fiscal recebida" : "notas fiscais recebidas"],
    ["Itens", String(todosItens.length), "linhas de material"],
    ["Quantidade", `${quantidadeTotal} PÇ`, "peças recebidas"],
    ["Peso recebido", `${formatKg(pesoRecebidoTotal)} kg`, pesoNotasTotal === null ? "peso das notas não informado" : `notas: ${formatKg(pesoNotasTotal, 3)} kg`],
  ];
  metricas.forEach(([rotulo, valor, nota], indice) => {
    const x = margin + indice * (larguraMetrica + gapMetrica);
    doc.setFillColor(...warm);
    doc.setDrawColor(...line);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, larguraMetrica, 15, 2, 2, "FD");
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.8);
    doc.text(rotulo.toUpperCase(), x + 3, y + 4.5);
    doc.setTextColor(...graphite);
    doc.setFontSize(10);
    doc.text(valor, x + 3, y + 10);
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.6);
    doc.text(caber(nota, larguraMetrica - 6), x + 3, y + 13.3);
  });
  y += 15 + 8;

  // ── Índice das cargas (só faz sentido com mais de uma) ─────────────────────
  if (cargas.length > 1) {
    tituloSecao("Cargas deste relatório");
    autoTable(doc, {
      startY: y,
      head: [["Carga", "Fornecedor", "Nota Fiscal", "Pedido", "Itens", "Peso recebido (kg)", "Peso da nota (kg)", "Conferência"]],
      body: cargas.map((carga, indice) => {
        const pesoNota = parsePtBrNumber(carga.pesoNota);
        const parcial = carga.conferenciaNota === "Parcial" || carga.conferenciaPedido === "Parcial";
        return [
          String(indice + 1).padStart(2, "0"),
          carga.fornecedor || "-",
          carga.nf || "-",
          carga.numeroPedido || "-",
          String(carga.itens.length),
          formatKg(pesoDosItens(carga.itens)),
          pesoNota === null ? "-" : formatKg(pesoNota, 3),
          parcial ? "Parcial" : "100%",
        ];
      }),
      styles: { fontSize: 6.6, cellPadding: 1.7, lineColor: line, lineWidth: 0.2, textColor: graphite, overflow: "linebreak" },
      headStyles: { fillColor: warm, textColor: muted, fontStyle: "bold", fontSize: 5.8 },
      columnStyles: {
        0: { cellWidth: 12, halign: "center", fontStyle: "bold" }, 1: { cellWidth: 56, fontStyle: "bold" },
        2: { cellWidth: 24 }, 3: { cellWidth: 18 }, 4: { cellWidth: 11, halign: "center" },
        5: { cellWidth: 25, halign: "right" }, 6: { cellWidth: 23, halign: "right" }, 7: { cellWidth: 17, halign: "center" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 7) {
          data.cell.styles.textColor = data.cell.raw === "Parcial" ? amber : green;
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { left: margin, right: margin, top: topoContinuacao, bottom: 16 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y) + 9;
  }

  // ── Um bloco por carga ─────────────────────────────────────────────────────
  cargas.forEach((carga, indice) => {
    // Faixa + referências + começo da tabela precisam ficar juntos na mesma página.
    garantirEspaco(9 + 24 + 22);
    faixaCarga(indice, `${carga.itens.length} ${carga.itens.length === 1 ? "item" : "itens"}`);

    const pesoNota = parsePtBrNumber(carga.pesoNota);
    const pesoRecebido = pesoDosItens(carga.itens);
    const alturaCelula = 12;
    const larguraCelula = CW / 3;
    const campos: { rotulo: string; valor: string; pilula?: boolean }[] = [
      { rotulo: "Nº do pedido de compra", valor: carga.numeroPedido || "Não informado" },
      { rotulo: "Local físico de descarga", valor: carga.localDescarga || "Não informado" },
      { rotulo: "Peso total da nota", valor: pesoNota === null ? "Não informado" : `${formatKg(pesoNota, 3)} kg` },
      { rotulo: "Conferência nota × material físico", valor: carga.conferenciaNota, pilula: true },
      { rotulo: "Conferência nota × pedido", valor: carga.conferenciaPedido, pilula: true },
      { rotulo: "Peso recebido (calculado)", valor: `${formatKg(pesoRecebido)} kg` },
    ];
    campos.forEach((campo, posicao) => {
      const x = margin + (posicao % 3) * larguraCelula;
      const yCelula = y + Math.floor(posicao / 3) * alturaCelula;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(...line);
      doc.setLineWidth(0.25);
      doc.rect(x, yCelula, larguraCelula, alturaCelula, "FD");
      doc.setTextColor(...muted);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.6);
      doc.text(campo.rotulo.toUpperCase(), x + 3, yCelula + 4.2);
      if (campo.pilula) {
        pilulaStatus(campo.valor, x + 3, yCelula + 9.4);
      } else {
        doc.setTextColor(...graphite);
        doc.setFontSize(8);
        doc.text(caber(campo.valor, larguraCelula - 6), x + 3, yCelula + 9.4);
      }
    });
    y += alturaCelula * 2;

    const quantidadeCarga = carga.itens.reduce((sum, item) => sum + (Number(item.quantidade) || 0), 0);
    autoTable(doc, {
      startY: y + 2,
      head: [["Tipo / Bitola", "Aço", "Qtd", "Dimensões (mm)", "Peso (kg)", "Obra / destino", "Local", "Certificado", "Corrida"]],
      body: carga.itens.map(item => [
        descricaoItem(item),
        item.aco || "-",
        String(item.quantidade || 0),
        dimensoesItem(item),
        formatKg(parseFloat(String(item.pesoTotal || 0)) || 0),
        item.obraNome || "LIVRE",
        item.local || "-",
        item.numero_certificado || item.numeroCertificado || "-",
        item.corrida || "-",
      ]),
      foot: [[`Total da ${rotuloCarga(indice).toLowerCase()}`, "", String(quantidadeCarga), "", formatKg(pesoRecebido), "", "", "", ""]],
      showFoot: "lastPage",
      styles: { fontSize: 6.4, cellPadding: 1.6, lineColor: line, lineWidth: 0.2, textColor: graphite, overflow: "linebreak" },
      headStyles: { fillColor: [236, 239, 243], textColor: graphite, fontStyle: "bold", fontSize: 6 },
      footStyles: { fillColor: warm, textColor: graphite, fontStyle: "bold", fontSize: 6.4 },
      alternateRowStyles: { fillColor: [250, 251, 252] },
      columnStyles: {
        0: { fontStyle: "bold", cellWidth: 32 }, 1: { cellWidth: 17 }, 2: { halign: "center", cellWidth: 11 },
        3: { halign: "center", cellWidth: 21 }, 4: { halign: "right", fontStyle: "bold", cellWidth: 21 },
        5: { cellWidth: 24 }, 6: { cellWidth: 20 }, 7: { cellWidth: 21 }, 8: { cellWidth: 19 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") {
          if (data.column.index === 2 || data.column.index === 3) data.cell.styles.halign = "center";
          if (data.column.index === 4) data.cell.styles.halign = "right";
        }
      },
      margin: { left: margin, right: margin, top: topoContinuacao, bottom: 16 },
    });
    y = ((doc as any).lastAutoTable?.finalY || y) + 3;

    // Observações desta carga — ficam coladas nela, nunca num bloco geral.
    const observacoes = (carga.observacoes || "").trim();
    if (observacoes) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      const linhas: string[] = doc.splitTextToSize(observacoes, CW - 8);
      const altura = 8 + linhas.length * 3.3;
      garantirEspaco(altura + 2);
      doc.setFillColor(...amberSoft);
      doc.setDrawColor(...amberBorder);
      doc.setLineWidth(0.25);
      doc.roundedRect(margin, y, CW, altura, 1.5, 1.5, "FD");
      doc.setTextColor(...amber);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.8);
      doc.text(`OBSERVAÇÕES E DIVERGÊNCIAS · ${rotuloCarga(indice)}`, margin + 4, y + 4.6);
      doc.setTextColor(...graphite);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.2);
      doc.text(linhas, margin + 4, y + 8.6);
      y += altura;
    } else {
      garantirEspaco(6);
      doc.setTextColor(...muted);
      doc.setFont("helvetica", "italic");
      doc.setFontSize(6.6);
      doc.text("Sem observações ou divergências registradas para esta carga.", margin + 1, y + 2.6);
      y += 4;
    }
    y += 9;
  });

  // ── Registro fotográfico, separado por carga ───────────────────────────────
  const idsCargas = new Set(cargas.map(c => c.id));
  const fotosDaCarga = (indice: number) => fotos.filter(foto => {
    const dona = foto.cargaId && idsCargas.has(foto.cargaId) ? foto.cargaId : null;
    // Foto sem carga definida (relatório antigo) fica com a primeira carga.
    return dona ? dona === cargas[indice].id : indice === 0;
  });

  if (fotos.length > 0) {
    const colunas = 3;
    const gap = 4;
    const larguraFoto = (CW - gap * (colunas - 1)) / colunas;
    const alturaFoto = larguraFoto * 0.75;
    const alturaLinha = alturaFoto + 8;

    // Continua na mesma página quando cabe o título + faixa + 1ª linha de
    // fotos — antes sempre abria página nova, deixando sobra em branco
    garantirEspaco(8 + 9 + 3 + alturaLinha);
    tituloSecao("Registro fotográfico");

    cargas.forEach((_, indice) => {
      const lista = fotosDaCarga(indice);
      if (lista.length === 0) return;

      // A faixa nunca fica sozinha no fim da página — vai junto com a 1ª linha de fotos.
      garantirEspaco(9 + 3 + alturaLinha);
      faixaCarga(indice, `${lista.length} ${lista.length === 1 ? "foto" : "fotos"}`);
      y += 3;

      lista.forEach((foto, posicao) => {
        const coluna = posicao % colunas;
        if (coluna === 0 && posicao > 0) y += alturaLinha;
        if (coluna === 0 && y + alturaLinha > limiteInferior) {
          doc.addPage();
          y = topoContinuacao;
          faixaCarga(indice, "fotos (continuação)");
          y += 3;
        }
        const x = margin + coluna * (larguraFoto + gap);
        doc.setFillColor(244, 245, 247);
        doc.setDrawColor(...line);
        doc.setLineWidth(0.25);
        doc.rect(x, y, larguraFoto, alturaFoto, "FD");
        try {
          const dataUrl = `data:${foto.tipo};base64,${foto.base64}`;
          // Mantém a proporção original da foto dentro da moldura (sem esticar).
          const props = doc.getImageProperties(dataUrl);
          const escala = Math.min((larguraFoto - 1) / props.width, (alturaFoto - 1) / props.height);
          const w = props.width * escala;
          const h = props.height * escala;
          doc.addImage(dataUrl, /png/i.test(foto.tipo) ? "PNG" : "JPEG", x + (larguraFoto - w) / 2, y + (alturaFoto - h) / 2, w, h);
        } catch { /* formato inesperado — fica só a moldura vazia */ }
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5.8);
        doc.text(`${rotuloCarga(indice)} · NF ${cargas[indice].nf || "-"} · Foto ${posicao + 1} de ${lista.length}`, x, y + alturaFoto + 3.4);
      });
      y += alturaLinha + 6;
    });
  }

  // ── Responsáveis — sempre no fim do documento, depois das fotos ────────────
  garantirEspaco(34);
  tituloSecao("Responsáveis pelo recebimento");
  const larguraAssinatura = (CW - 16) / 2;
  const assinaturas = [
    { rotulo: "Conferido por", valor: dados.conferidoPor || "Nome, cargo e data" },
    { rotulo: "Visto da Qualidade / Almoxarifado", valor: dados.vistoQualidade || "Nome, cargo e data" },
  ];
  assinaturas.forEach((assinatura, indice) => {
    const x = margin + indice * (larguraAssinatura + 16);
    doc.setDrawColor(135, 147, 160);
    doc.setLineWidth(0.25);
    doc.line(x, y + 11, x + larguraAssinatura, y + 11);
    doc.setTextColor(...graphite);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(7);
    doc.text(`${assinatura.rotulo}:`, x, y + 15.5);
    doc.setTextColor(...muted);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(caber(assinatura.valor, larguraAssinatura), x, y + 19.5);
  });
  y += 23;

  // ── Topo e rodapé de todas as páginas ──────────────────────────────────────
  const totalPaginas = doc.getNumberOfPages();
  for (let pagina = 1; pagina <= totalPaginas; pagina++) {
    doc.setPage(pagina);
    doc.setDrawColor(...line);
    doc.setLineWidth(0.25);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(...muted);
    if (pagina > 1) {
      doc.text("HCM Industrial · Relatório de Recebimento", margin, 9);
      doc.text(`${numeroDocumento} · ${dataEmissao}`, W - margin, 9, { align: "right" });
      doc.line(margin, 11.5, W - margin, 11.5);
    }
    doc.line(margin, H - 11, W - margin, H - 11);
    doc.text("HCM Industrial · Controle de Estoque", margin, H - 6.5);
    doc.text(`Página ${pagina} de ${totalPaginas}`, W - margin, H - 6.5, { align: "right" });
  }

  const nomeArquivo = `relatorio_recebimento_${numeroDocumento}.pdf`;
  doc.save(nomeArquivo);
  return nomeArquivo;
}
