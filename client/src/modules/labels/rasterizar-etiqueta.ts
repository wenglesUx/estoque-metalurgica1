// /modules/labels/rasterizar-etiqueta.ts
// Gera a etiqueta como imagem 1-bit (só preto e branco) na resolução da
// impressora térmica.
//
// Por quê: imprimindo HTML, o navegador desenha texto e imagens com bordas
// suavizadas (tons de cinza). A térmica só tem preto/branco e converte esses
// cinzas em pontilhado — o resultado sai "borrado". Entregando a imagem já em
// preto e branco, ponto a ponto (8 pontos/mm = 203 dpi), não sobra cinza
// nenhum para o driver interpretar.

import html2canvas from "html2canvas-pro";
import QRCode from "qrcode";

/** Honeywell PC42t: 203 dpi ≈ 8 pontos por mm */
export const PONTOS_POR_MM = 8;

const MM_TO_PX = 3.7795275591;

// Renderiza com o dobro da resolução e reduz tirando a média — as bordas das
// letras ficam mais fiéis do que limiarizar direto na resolução final
const SUPERAMOSTRAGEM = 2;

/** Abaixo disso (0–255) o ponto vira preto. Mais alto = traço mais grosso. */
export const LIMIAR_PADRAO = 150;

export async function rasterizarEtiqueta(
  node: HTMLElement,
  larguraMm: number,
  alturaMm: number,
  limiar = LIMIAR_PADRAO
): Promise<string> {
  // Cópia sem a escala do preview, num canto da página (atrás do modal)
  const copia = node.cloneNode(true) as HTMLElement;
  copia.style.transform = "none";

  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;z-index:-1;pointer-events:none;background:#fff;";
  host.appendChild(copia);
  document.body.appendChild(host);

  try {
    await document.fonts?.ready;

    aplicarReticencias(copia);

    // Sublinhados são desenhados depois, na grade de pontos (o html2canvas
    // põe o traço fora da caixa e o overflow:hidden da linha corta)
    const sublinhados = medirSublinhados(copia);

    const escala = (PONTOS_POR_MM * SUPERAMOSTRAGEM) / MM_TO_PX;

    const origem = await html2canvas(copia, {
      scale: escala,
      backgroundColor: "#ffffff",
      logging: false,
    });

    const largura = Math.round(larguraMm * PONTOS_POR_MM);
    const altura = Math.round(alturaMm * PONTOS_POR_MM);

    const ctxOrigem = origem.getContext("2d", { willReadFrequently: true });
    if (!ctxOrigem) throw new Error("Canvas indisponível");

    const pixels = ctxOrigem.getImageData(0, 0, origem.width, origem.height).data;

    const saida = document.createElement("canvas");
    saida.width = largura;
    saida.height = altura;

    const ctx = saida.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível");

    const imagem = ctx.createImageData(largura, altura);
    const fx = origem.width / largura;
    const fy = origem.height / altura;

    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        // Média de luminância do bloco de origem correspondente a este ponto
        const x0 = Math.floor(x * fx);
        const x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx));
        const y0 = Math.floor(y * fy);
        const y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));

        let soma = 0;
        let n = 0;

        for (let sy = y0; sy < y1 && sy < origem.height; sy++) {
          for (let sx = x0; sx < x1 && sx < origem.width; sx++) {
            const i = (sy * origem.width + sx) * 4;
            soma += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
            n++;
          }
        }

        const valor = n && soma / n < limiar ? 0 : 255;
        const o = (y * largura + x) * 4;

        imagem.data[o] = valor;
        imagem.data[o + 1] = valor;
        imagem.data[o + 2] = valor;
        imagem.data[o + 3] = 255;
      }
    }

    ctx.putImageData(imagem, 0, 0);

    redesenharImagens(ctx, copia);
    redesenharQrs(ctx, copia);

    ctx.fillStyle = "#000";
    sublinhados.forEach((s) => ctx.fillRect(s.x, s.y, s.largura, s.espessura));

    return saida.toDataURL("image/png");
  } finally {
    host.remove();
  }
}

/**
 * Mede (em pontos) onde fica o sublinhado de cada texto sublinhado e tira o
 * sublinhado da cópia, pra não sair duplicado nem cortado.
 */
function medirSublinhados(etiqueta: HTMLElement) {
  const base = etiqueta.getBoundingClientRect();
  const paraPontos = (px: number) => (px / MM_TO_PX) * PONTOS_POR_MM;
  const medidas: { x: number; y: number; largura: number; espessura: number }[] = [];

  etiqueta.querySelectorAll<HTMLElement>("*").forEach((el) => {
    const estilo = getComputedStyle(el);
    if (!estilo.textDecorationLine.includes("underline")) return;

    // Só a área ocupada pelo texto, não a largura toda da linha
    const faixa = document.createRange();
    faixa.selectNodeContents(el);
    const texto = faixa.getBoundingClientRect();

    if (texto.width <= 0) return;

    // Linha de base real: um marcador invisível alinhado pela base do texto
    const marcador = document.createElement("span");
    marcador.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;";
    el.appendChild(marcador);
    const linhaBase = marcador.getBoundingClientRect().top;
    marcador.remove();

    const tamanhoFonte = parseFloat(estilo.fontSize) || 10;
    const espessura = Math.max(1, Math.round(paraPontos(tamanhoFonte * 0.08)));
    const fundoCaixa = el.getBoundingClientRect().bottom;

    // Logo abaixo da linha de base, como o navegador faz — sem passar da
    // caixa da linha (que corta o que transborda)
    const yPx = Math.min(linhaBase + tamanhoFonte * 0.1, fundoCaixa - (espessura / PONTOS_POR_MM) * MM_TO_PX);
    const y = Math.round(paraPontos(yPx - base.top));

    medidas.push({
      x: Math.round(paraPontos(texto.left - base.left)),
      y,
      largura: Math.round(paraPontos(Math.min(texto.width, el.getBoundingClientRect().width))),
      espessura,
    });

    el.style.textDecoration = "none";
  });

  return medidas;
}

/**
 * O html2canvas não desenha "text-overflow: ellipsis" — corta a letra no
 * meio. Aqui o texto que não cabe é encurtado de verdade, com "…" no fim.
 */
function aplicarReticencias(etiqueta: HTMLElement) {
  etiqueta.querySelectorAll<HTMLElement>("*").forEach((el) => {
    if (getComputedStyle(el).textOverflow !== "ellipsis") return;
    if (el.scrollWidth <= el.clientWidth) return;

    const original = el.textContent ?? "";
    let min = 0;
    let max = original.length;

    // Maior prefixo que cabe junto com as reticências
    while (min < max) {
      const meio = Math.ceil((min + max) / 2);
      el.textContent = `${original.slice(0, meio).trimEnd()}…`;

      if (el.scrollWidth <= el.clientWidth) min = meio;
      else max = meio - 1;
    }

    el.textContent = `${original.slice(0, min).trimEnd()}…`;
  });
}

/**
 * Imagens (logo) com cores e tons de cinza: o corte simples preto/branco
 * transforma cinza em bloco preto e apaga o laranja. Aqui elas são refeitas
 * com pontilhado (Floyd–Steinberg), que é como a térmica representa tons.
 */
function redesenharImagens(ctx: CanvasRenderingContext2D, etiqueta: HTMLElement) {
  const base = etiqueta.getBoundingClientRect();
  const paraPontos = (px: number) => (px / MM_TO_PX) * PONTOS_POR_MM;

  etiqueta.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
    if (!img.complete || !img.naturalWidth) return;

    const area = img.getBoundingClientRect();
    const x = Math.round(paraPontos(area.left - base.left));
    const y = Math.round(paraPontos(area.top - base.top));
    const largura = Math.round(paraPontos(area.width));
    const altura = Math.round(paraPontos(area.height));

    if (largura <= 0 || altura <= 0) return;

    const temp = document.createElement("canvas");
    temp.width = largura;
    temp.height = altura;

    const tctx = temp.getContext("2d", { willReadFrequently: true });
    if (!tctx) return;

    tctx.fillStyle = "#fff";
    tctx.fillRect(0, 0, largura, altura);
    tctx.imageSmoothingEnabled = true;
    tctx.imageSmoothingQuality = "high";
    tctx.drawImage(img, 0, 0, largura, altura);

    const dados = tctx.getImageData(0, 0, largura, altura);
    const cinza = new Float32Array(largura * altura);

    for (let i = 0; i < cinza.length; i++) {
      const p = i * 4;
      cinza[i] = 0.299 * dados.data[p] + 0.587 * dados.data[p + 1] + 0.114 * dados.data[p + 2];
    }

    for (let py = 0; py < altura; py++) {
      for (let px = 0; px < largura; px++) {
        const i = py * largura + px;
        const novo = cinza[i] < 128 ? 0 : 255;
        const erro = cinza[i] - novo;

        cinza[i] = novo;

        if (px + 1 < largura) cinza[i + 1] += (erro * 7) / 16;
        if (py + 1 < altura) {
          if (px > 0) cinza[i + largura - 1] += (erro * 3) / 16;
          cinza[i + largura] += (erro * 5) / 16;
          if (px + 1 < largura) cinza[i + largura + 1] += erro / 16;
        }
      }
    }

    for (let i = 0; i < cinza.length; i++) {
      const p = i * 4;
      dados.data[p] = dados.data[p + 1] = dados.data[p + 2] = cinza[i];
      dados.data[p + 3] = 255;
    }

    ctx.putImageData(dados, x, y);
  });
}

/**
 * Redesenha cada QR direto na grade de pontos, com módulos de tamanho
 * inteiro — sem isso alguns módulos sairiam com 3 pontos e outros com 4,
 * o que atrapalha a leitura.
 */
function redesenharQrs(ctx: CanvasRenderingContext2D, etiqueta: HTMLElement) {
  const base = etiqueta.getBoundingClientRect();

  etiqueta.querySelectorAll<SVGElement>("svg[data-qr-valor]").forEach((svg) => {
    const valor = svg.getAttribute("data-qr-valor");
    const margem = Number(svg.getAttribute("data-qr-margem") || 0);

    if (!valor) return;

    const area = svg.getBoundingClientRect();
    const paraPontos = (px: number) => (px / MM_TO_PX) * PONTOS_POR_MM;

    const x = Math.round(paraPontos(area.left - base.left));
    const y = Math.round(paraPontos(area.top - base.top));
    const lado = Math.round(paraPontos(area.width));

    const qr = QRCode.create(valor, { errorCorrectionLevel: "L" });
    const modulos = qr.modules.size;
    const total = modulos + margem * 2;
    const tamanhoModulo = Math.max(1, Math.floor(lado / total));

    // Centraliza o QR (já em módulos inteiros) dentro da área original
    const sobra = lado - tamanhoModulo * total;
    const inicioX = x + Math.floor(sobra / 2) + margem * tamanhoModulo;
    const inicioY = y + Math.floor(sobra / 2) + margem * tamanhoModulo;

    ctx.fillStyle = "#fff";
    ctx.fillRect(x, y, lado, lado);

    ctx.fillStyle = "#000";

    for (let linha = 0; linha < modulos; linha++) {
      for (let coluna = 0; coluna < modulos; coluna++) {
        if (qr.modules.get(linha, coluna)) {
          ctx.fillRect(
            inicioX + coluna * tamanhoModulo,
            inicioY + linha * tamanhoModulo,
            tamanhoModulo,
            tamanhoModulo
          );
        }
      }
    }
  });
}
