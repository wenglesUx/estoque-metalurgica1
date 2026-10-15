// /modules/labels/components/QrCodeSvg.tsx
// QR code em SVG (vetorial: sai nítido em qualquer escala e na térmica)

import { useMemo } from "react";
import QRCode from "qrcode";

interface QrCodeSvgProps {
  value: string;
  /** Lado do QR em mm, já incluindo a margem branca */
  sizeMm: number;
}

// Margem branca em módulos — o padrão pede 4, mas a etiqueta já tem área
// livre em volta; 2 mantém a leitura e economiza espaço
const QUIET_ZONE = 2;

export function QrCodeSvg({ value, sizeMm }: QrCodeSvgProps) {
  const qr = useMemo(() => {
    try {
      // Nível L: módulos maiores para o mesmo tamanho, o que pesa mais na
      // leitura de impressão térmica 203dpi do que a correção de erro extra
      return QRCode.create(value, { errorCorrectionLevel: "L" });
    } catch {
      return null;
    }
  }, [value]);

  if (!qr) return null;

  const size = qr.modules.size;
  const total = size + QUIET_ZONE * 2;

  let path = "";

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (qr.modules.get(row, col)) {
        path += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
      }
    }
  }

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${total} ${total}`}
      width={`${sizeMm}mm`}
      height={`${sizeMm}mm`}
      shapeRendering="crispEdges"
      style={{ display: "block", flexShrink: 0 }}
      // Lidos pela impressão nítida, que redesenha o QR na grade da impressora
      data-qr-valor={value}
      data-qr-margem={QUIET_ZONE}
    >
      <rect width={total} height={total} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
