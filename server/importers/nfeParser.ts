/**
 * Motor de Extração Inteligente para XML de NF-e
 * Focado em materiais siderúrgicos (Perfis, Chapas, etc.)
 */

export interface NfeItem {
  tipo: string;
  bitola: string;
  comprimento: number;
  largura: number;
  aco: string;
  quantidade: number;
  pesoTotal: string;
  categoria: string;
  descricaoOriginal: string;
  /**
   * "nota"     — peso veio direto da NF (unidade KG/T reconhecida), confiável.
   * "calcular" — unidade da NF é de contagem (UN, PÇ...) ou desconhecida; o
   *              peso precisa ser calculado a partir da especificação
   *              (tipo+bitola+aço), igual já acontece no cadastro manual.
   *              pesoTotal aqui vem "0.000" até esse cálculo rodar.
   */
  pesoOrigem: "nota" | "calcular";
  /** @deprecated mantido só por compatibilidade — use pesoOrigem === "calcular" */
  pesoIncerto?: boolean;
}

// Fatores de conversão para KG. Cobre as variações mais comuns encontradas em NF-e de material siderúrgico.
const FATORES_PARA_KG: Record<string, number> = {
  KG: 1,
  KGM: 1,
  G: 0.001,
  T: 1000,
  TO: 1000,
  TON: 1000,
  TONELADA: 1000,
  TONELADAS: 1000,
};

// Unidades de CONTAGEM — o número da NF aqui é quantidade de peças, nunca peso.
const UNIDADES_DE_CONTAGEM = new Set([
  "UN", "UND", "UNID", "UNIDADE", "UNIDADES",
  "PC", "PÇ", "PC.", "PÇ.", "PEC", "PECA", "PEÇA", "PECAS", "PEÇAS",
]);

/**
 * Resolve peso (kg) e quantidade (peças) de um item da NF, considerando a
 * unidade comercial (uCom/qCom) e, como apoio, a unidade tributável
 * (uTrib/qTrib).
 */
function resolverPesoEQuantidade(
  qCom: string,
  uCom: string | undefined,
  qTrib: string | undefined,
  uTrib: string | undefined
): { pesoKg: number; quantidade: number; origem: "nota" | "calcular" } {
  const uComNorm = (uCom || '').trim().toUpperCase();
  const uTribNorm = (uTrib || '').trim().toUpperCase();
  const qComNum = parseFloat(qCom) || 0;

  // 1) Unidade comercial já reconhecida como PESO (KG, T, etc.) — fonte mais direta.
  if (uComNorm in FATORES_PARA_KG) {
    return { pesoKg: qComNum * FATORES_PARA_KG[uComNorm], quantidade: 1, origem: "nota" };
  }

  // 2) Unidade tributável reconhecida como peso (comum: uTrib=KG mesmo quando uCom é T, PC, etc.)
  if (qTrib && uTribNorm in FATORES_PARA_KG) {
    return { pesoKg: parseFloat(qTrib) * FATORES_PARA_KG[uTribNorm], quantidade: 1, origem: "nota" };
  }

  // 3) Unidade comercial é de CONTAGEM (UN, PÇ...) — qCom é quantidade de
  //    peças, não peso. O peso precisa ser calculado pela especificação.
  if (UNIDADES_DE_CONTAGEM.has(uComNorm)) {
    return { pesoKg: 0, quantidade: Math.max(1, Math.round(qComNum)), origem: "calcular" };
  }

  // 4) Unidade totalmente desconhecida — não dá pra confiar no número como
  //    peso nem como quantidade certa. Assume 1 peça e deixa o peso pendente
  //    de cálculo pela especificação (nunca mais "adivinha" que é KG).
  return { pesoKg: 0, quantidade: 1, origem: "calcular" };
}

export interface NfeData {
  nf: string;
  fornecedor: string;
  itens: NfeItem[];
}

export function parseNfeXml(xmlContent: string): NfeData {
  const nfMatch = xmlContent.match(/<nNF>(\d+)<\/nNF>/);
  const fornecedorMatch = xmlContent.match(/<xNome>([^<]+)<\/xNome>/);

  const nf = nfMatch ? nfMatch[1].replace(/^0+/, '') : '';
  const fornecedor = fornecedorMatch ? fornecedorMatch[1].trim() : '';

  const itens: NfeItem[] = [];

  const detBlocks = xmlContent.match(/<det nItem="\d+">[\s\S]*?<\/det>/g) || [];

  for (const block of detBlocks) {
    const xProdMatch = block.match(/<xProd>([^<]+)<\/xProd>/);
    const qComMatch  = block.match(/<qCom>([^<]+)<\/qCom>/);
    const uComMatch  = block.match(/<uCom>([^<]+)<\/uCom>/);
    const qTribMatch = block.match(/<qTrib>([^<]+)<\/qTrib>/);
    const uTribMatch = block.match(/<uTrib>([^<]+)<\/uTrib>/);

    if (xProdMatch && qComMatch) {
      const descricao = xProdMatch[1].toUpperCase();
      const { pesoKg, quantidade, origem } = resolverPesoEQuantidade(
        qComMatch[1],
        uComMatch?.[1],
        qTribMatch?.[1],
        uTribMatch?.[1]
      );
      const peso = pesoKg.toFixed(3);

      let tipo = 'OUTRO';
      let bitola = '';
      let comprimento = 0;
      let largura = 0;
      let aco = 'A36';
      let categoria = 'PERFIL';

      // ── Detectar categoria ────────────────────────────────────────────
      const isChapa = /\bCHAPA\b|\bPLACA\b|\bFL\b|\bFLAT BAR\b/.test(descricao);
      if (isChapa) categoria = 'CHAPA';

      // ── Extrair Aço ───────────────────────────────────────────────────
      if (descricao.includes('A572') || descricao.includes('GR 50')) aco = 'A572-Gr 50';
      else if (descricao.includes('A36')) aco = 'A36';
      else if (descricao.includes('A514')) aco = 'A514';
      else if (descricao.includes('A516')) aco = 'A516';

      if (categoria === 'CHAPA') {
        // ── CHAPA: espessura × largura × comprimento ──────────────────
        tipo = 'CHAPA';

        // Ex: "CHAPA 3/16 X 1200 X 6000" ou "CHAPA 6,35 X 1500 X 6000"
        const chapaMatch = descricao.match(
          /(\d+[\/,.]?\d*)\s*[Xx]\s*(\d+[,.]?\d*)\s*[Xx]\s*(\d+[,.]?\d*)/
        );
        if (chapaMatch) {
          const espStr = chapaMatch[1].replace(',', '.');
          const larg   = parseFloat(chapaMatch[2].replace(',', '.'));
          const comp   = parseFloat(chapaMatch[3].replace(',', '.'));

          // Fração de polegada → mm (ex: 3/16 → 4.76mm)
          if (espStr.includes('/')) {
            const [num, den] = espStr.split('/').map(Number);
            bitola = String(+((num / den) * 25.4).toFixed(2));
          } else {
            bitola = espStr;
          }

          largura = larg > 50 ? larg : larg * 1000;
          comprimento = comp > 50 ? comp : comp * 1000;
        } else {
          // Fallback: espessura apenas
          const espMatch = descricao.match(/(?:CHAPA|CH|FL)\s+([0-9]+[\/,.]?[0-9]*)/i);
          if (espMatch) bitola = espMatch[1].replace(',', '.');
        }
      } else {
        // ── PERFIL LINEAR ─────────────────────────────────────────────
        const tiposComuns = ['WH', 'W', 'HP', 'U', 'H', 'I', 'L', 'T', 'CS', 'HS'];
        for (const t of tiposComuns) {
          if (
            descricao.includes(` ${t} `) ||
            descricao.startsWith(`${t} `) ||
            descricao.includes(`PERFIL ${t}`)
          ) {
            tipo = t;
            break;
          }
        }

        // Comprimento (ex: 12 M, 12M, 6.000M)
        const compMatch = descricao.match(/(\d+[.,]?\d*)\s*M(?:\b|$)/);
        if (compMatch) {
          comprimento = parseFloat(compMatch[1].replace(',', '.')) * 1000;
        }

        // Bitola (ex: 310 X 79,0 ou 310X79)
        const bitolaMatch = descricao.match(/(\d+)\s*[X]\s*(\d+[,.]?\d*)/);
        if (bitolaMatch) {
          bitola = `${bitolaMatch[1]}X${bitolaMatch[2].replace(',', '.')}`;
        } else {
          const genericMatch = descricao.match(new RegExp(`${tipo}\\s+([^A-Z]+)`));
          if (genericMatch) bitola = genericMatch[1].trim();
        }
      }

      itens.push({
        tipo,
        bitola: bitola || 'N/D',
        comprimento: comprimento || 12000,
        largura: largura || 0,
        aco,
        quantidade,
        pesoTotal: peso,
        categoria,
        descricaoOriginal: descricao,
        pesoOrigem: origem,
        pesoIncerto: origem === "calcular",
      });
    }
  }

  return { nf, fornecedor, itens };
}
