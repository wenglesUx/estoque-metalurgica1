// /modules/separacao-producao/qr-decoder.ts
// Decodificação de QR a partir da câmera ao vivo ou de uma foto.
//
// Usa o leitor nativo do navegador (BarcodeDetector — Chrome no Android)
// quando existe: é bem mais tolerante a foco e ângulo. Senão, cai no jsQR.

import jsQR from "jsqr";

let detectorPromise: Promise<any | null> | null = null;

/** Leitor nativo de QR, ou null se o navegador não tiver */
export function obterDetectorNativo(): Promise<any | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const BarcodeDetector = (window as any).BarcodeDetector;

      if (!BarcodeDetector) return null;

      try {
        const formatos: string[] | undefined = await BarcodeDetector.getSupportedFormats?.();

        if (formatos && !formatos.includes("qr_code")) return null;

        return new BarcodeDetector({ formats: ["qr_code"] });
      } catch {
        return null;
      }
    })();
  }

  return detectorPromise;
}

const canvas = typeof document !== "undefined" ? document.createElement("canvas") : null;
const ctx = canvas?.getContext("2d", { willReadFrequently: true }) ?? null;

/**
 * Roda o jsQR numa região da imagem. `fracao` < 1 recorta um quadrado no
 * centro — o QR mirado ocupa mais pixels do que se a imagem toda fosse
 * reduzida, o que faz muita diferença com etiqueta pequena.
 */
export function lerRegiaoComJsQr(
  fonte: CanvasImageSource,
  largura: number,
  altura: number,
  fracao: number,
  maxLado: number,
  tentarInvertido = false
): string | null {
  if (!canvas || !ctx || !largura || !altura) return null;

  const sw = fracao < 1 ? Math.min(largura, altura) * fracao : largura;
  const sh = fracao < 1 ? sw : altura;
  const sx = (largura - sw) / 2;
  const sy = (altura - sh) / 2;

  const escala = Math.min(1, maxLado / Math.max(sw, sh));

  canvas.width = Math.round(sw * escala);
  canvas.height = Math.round(sh * escala);

  ctx.drawImage(fonte, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const imagem = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const codigo = jsQR(imagem.data, imagem.width, imagem.height, {
    inversionAttempts: tentarInvertido ? "attemptBoth" : "dontInvert",
  });

  return codigo?.data || null;
}

async function carregarImagem(arquivo: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(arquivo);
  } catch {
    const url = URL.createObjectURL(arquivo);

    try {
      return await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/** Lê o QR de uma foto tirada com a câmera normal do celular */
export async function lerQrDeFoto(arquivo: File): Promise<string | null> {
  const imagem = await carregarImagem(arquivo);

  const largura = "naturalWidth" in imagem ? imagem.naturalWidth : imagem.width;
  const altura = "naturalHeight" in imagem ? imagem.naturalHeight : imagem.height;

  const nativo = await obterDetectorNativo();

  if (nativo) {
    try {
      const resultados = await nativo.detect(imagem);

      if (resultados?.[0]?.rawValue) return resultados[0].rawValue;
    } catch {
      // segue para o jsQR
    }
  }

  // Do recorte mais fechado (QR no centro da foto) até a foto inteira
  const tentativas: [number, number][] = [
    [0.5, 1200],
    [0.75, 1400],
    [1, 1800],
  ];

  for (const [fracao, maxLado] of tentativas) {
    const texto = lerRegiaoComJsQr(imagem, largura, altura, fracao, maxLado, true);

    if (texto) return texto;
  }

  return null;
}
