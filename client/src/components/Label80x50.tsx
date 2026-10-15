// /modules/labels/components/Label80x50.tsx
// Componente da etiqueta industrial 80×50mm - Padrão Honeywell (Limpo)

import React from "react";
import type { LabelData } from "../templates/industrial-80x50";

interface Label80x50Props {
  data: LabelData;
  /** Escala visual para o preview (não afeta impressão) */
  scale?: number;
}

export const Label80x50 = React.forwardRef<HTMLDivElement, Label80x50Props>(
  ({ data, scale = 1 }, ref) => {
    return (
      <div
        ref={ref}
        style={{
          width: "80mm",
          height: "50mm",
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          fontFamily: "'Arial', sans-serif",
          backgroundColor: "#ffffff",
          color: "#000000",
          boxSizing: "border-box",
          overflow: "hidden",
          position: "relative",
          display: "flex",
          flexDirection: "column",
          padding: "2mm",
          border: "0.1mm solid #eee", // Apenas para visualização no preview
        }}
      >
        {/* ── CABEÇALHO (Logo e Título) ── */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: "4mm", marginBottom: "2mm" }}>
          {/* Logo Placeholder (HCM ENGENHARIA) */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div style={{ fontSize: "6mm", fontWeight: "bold", lineHeight: 1 }}>HCM</div>
            <div style={{ fontSize: "1.5mm", letterSpacing: "0.5mm", fontWeight: "bold" }}>ENGENHARIA</div>
          </div>

          <div style={{ flex: 1, borderBottom: "0.5mm solid #000", paddingBottom: "1mm" }}>
            <div style={{ fontSize: "6mm", fontWeight: "bold", textAlign: "right" }}>MATÉRIA-PRIMA</div>
          </div>
        </div>

        {/* ── CORPO (Informações) ── */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "1.2mm" }}>
          <div style={{ fontSize: "5mm", fontWeight: "bold" }}>
            PERFIL: {data.tipo} {data.bitola}
          </div>
          
          <div style={{ fontSize: "3.5mm" }}>
            FORNECEDOR: <strong>{data.fornecedor}</strong>
          </div>

          <div style={{ fontSize: "3.5mm" }}>
            NOTA FISCAL: <strong>{data.nf}</strong>
          </div>

          <div style={{ fontSize: "3.5mm" }}>
            COMPRIMENTO: <strong>{data.comprimento}</strong>
          </div>

          <div style={{ fontSize: "3.5mm" }}>
            CORRIDA: <strong>{data.corrida}</strong>
          </div>

          <div style={{ fontSize: "3.5mm" }}>
            OBRA: <strong>{data.obra}</strong>
          </div>
        </div>

        {/* ── RODAPÉ (Certificado e Local) ── */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "2.5mm", borderTop: "0.2mm solid #ccc", paddingTop: "1mm" }}>
          <span>CERTIFICADO: {data.certificado}</span>
          <span>LOCAL: {data.local}</span>
          <span>QTD: {data.quantidade} PÇ</span>
        </div>
      </div>
    );
  }
);

Label80x50.displayName = "Label80x50";
