// /modules/labels/components/Label80x50.tsx
// Etiqueta industrial 80×50mm — layout fiel ao modelo BarTender HCM Engenharia
// Campos: MATÉRIA-PRIMA | PERFIL | FORNECEDOR | NOTA FISCAL | COMPRIMENTO | CORRIDA | OBRA

import React from "react";
import type { LabelData } from "../templates/industrial-80x50";
import {
  DEFAULT_LAYOUT,
  lineValue,
  type LabelLayout,
} from "../templates/label-layout";
import { QrCodeSvg } from "./QrCodeSvg";

// Logo HCM Engenharia extraído do template original .btw
const HCM_LOGO_B64 = "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";

interface Label80x50Props {
  data: LabelData;
  /** Escala visual para preview (não afeta impressão) */
  scale?: number;
  /** Estrutura editável (fontes, margens, linhas); padrão = layout original */
  layout?: LabelLayout;
}

export const Label80x50 = React.forwardRef<HTMLDivElement, Label80x50Props>(
  ({ data, scale = 1, layout = DEFAULT_LAYOUT }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          width: "80mm",
          height: "50mm",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          fontFamily: "'Arial Black', 'Arial', sans-serif",
          backgroundColor: "#ffffff",
          border: layout.bordaVisivel
            ? `${layout.bordaEspessura}mm solid #222`
            : "none",
          borderRadius: `${layout.bordaRaio}mm`,
          boxSizing: "border-box",
          overflow: "hidden",
          position: "relative",
          padding: `${layout.paddingVertical}mm ${layout.paddingHorizontal}mm`,
          display: "flex",
          flexDirection: "column",
          gap: "0",
        }}
      >
        {/* ── LINHA 1: Logo + Título MATÉRIA-PRIMA ── */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "2mm", marginBottom: "1mm" }}>

          {/* Logo HCM Engenharia */}
          {layout.logoVisivel && (
            <div
              style={{
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                // Deslocamento visual: não empurra o título ao lado
                transform: `translate(${layout.logoDeslocX}mm, ${layout.logoDeslocY}mm)`,
              }}
            >
              <img
                src={`data:image/png;base64,${HCM_LOGO_B64}`}
                alt="HCM Engenharia"
                style={{
                  width: `${layout.logoLargura}mm`,
                  height: layout.logoProporcional ? "auto" : `${layout.logoAltura}mm`,
                  objectFit: "fill",
                }}
              />
            </div>
          )}

          {/* Bloco título */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: `${layout.tituloFontSize}mm`,
                fontWeight: "900",
                color: "#000",
                letterSpacing: "0.1mm",
                lineHeight: 1,
                borderBottom: "0.4mm solid #000",
                paddingBottom: "0.8mm",
                marginBottom: "1mm",
              }}
            >
              {layout.tituloTexto}
            </div>

            {/* PERFIL logo abaixo do título */}
            <div
              style={{
                fontSize: `${layout.perfilFontSize}mm`,
                fontWeight: "900",
                color: "#000",
                letterSpacing: "0.1mm",
                lineHeight: 1,
              }}
            >
              {(data as any).categoria === 'CHAPA' ? 'CHAPA' : 'PERFIL'}: {data.tipo} {data.bitola}
            </div>
          </div>
        </div>

        {/* ── CORPO: linhas de dados ── */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "2mm", marginTop: "0.5mm" }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: `${layout.espacoLinhas}mm` }}>
          {layout.linhas
            .filter((linha) => linha.visivel)
            .map((linha) => (
              <LabelLine
                key={linha.key}
                label={
                  linha.key === "comprimento" && (data as any).categoria === 'CHAPA'
                    ? 'DIMENSÕES'
                    : linha.rotulo
                }
                value={lineValue(linha.key, data)}
                fontSize={linha.fontSize}
                underline={linha.sublinhado}
              />
            ))}
        </div>

        {layout.qrVisivel && data.qrConteudo && (
          <QrCodeSvg value={data.qrConteudo} sizeMm={layout.qrTamanho} />
        )}
        </div>
      </div>
    );
  }
);

Label80x50.displayName = "Label80x50";

// ── Sub-componente de linha ──────────────────────────────────────────────────
function LabelLine({
  label,
  value,
  fontSize,
  underline,
}: {
  label: string;
  value: string;
  fontSize: number;
  underline?: boolean;
}) {
  return (
    <div
      style={{
        flexShrink: 0,
        fontSize: `${fontSize}mm`,
        fontWeight: "900",
        color: "#000",
        letterSpacing: "0.05mm",
        lineHeight: 1,
        textDecoration: underline ? "underline" : "none",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}: {value || "-"}
    </div>
  );
}
