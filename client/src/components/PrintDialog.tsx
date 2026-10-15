// /modules/labels/components/PrintDialog.tsx
// Modal de impressão otimizado para impressoras térmicas (Honeywell)
// Versão 3: Etiqueta em 100% do papel

import { useRef, useState, useCallback, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label80x50 } from "./Label80x50";
import {
  materialToLabelData,
  TEMPLATES,
  DEFAULT_TEMPLATE,
  type LabelData,
  type LabelTemplate,
} from "../templates/industrial-80x50";
import { Printer, RotateCcw, Tag, RotateCw } from "lucide-react";
import { trpc } from "@/lib/trpc";

interface PrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: any;
}

const MM_TO_PX = 3.7795276;
const PREVIEW_SCALE = 3.5;
const LABEL_W_MM = 80;
const LABEL_H_MM = 50;

export function PrintDialog({ open, onOpenChange, material }: PrintDialogProps) {
  const labelRef = useRef<HTMLDivElement>(null);
  const [labelData, setLabelData] = useState<LabelData>(() => materialToLabelData(material));
  const [template, setTemplate] = useState<LabelTemplate>(DEFAULT_TEMPLATE);
  const [numEtiquetas, setNumEtiquetas] = useState(1);
  const [rotacionar90, setRotacionar90] = useState(false);

  const resetFromMaterial = useCallback(() => {
    if (!material) return;
    setLabelData(materialToLabelData(material));
    setNumEtiquetas(material?.quantidade || 1);
  }, [material]);

  useEffect(() => {
    if (open && material) resetFromMaterial();
  }, [open, material, resetFromMaterial]);

  const marcarImpressao = trpc.materiais.marcarEtiquetaImpressa.useMutation();

  const handlePrint = async () => {
    const labelHtml = labelRef.current?.outerHTML;
    if (!labelHtml) return;
    if (!numEtiquetas || numEtiquetas < 1) { alert("Informe a quantidade de etiquetas (mínimo 1)."); return; }

    if (material?.id) {
      try { await marcarImpressao.mutateAsync({ id: material.id }); } 
      catch (err) { console.error("Erro ao marcar impresso:", err); }
    }

    const printWindow = window.open("", "_blank", "width=900,height=600");
    if (!printWindow) return alert("Pop-up bloqueado.");

    // Se rotacionar90, inverte as dimensões da página
    const pageWidth = rotacionar90 ? "50mm" : "80mm";
    const pageHeight = rotacionar90 ? "80mm" : "50mm";

    // Geração segura do HTML das etiquetas
    let labelsHtml = "";
    for (let i = 0; i < numEtiquetas; i++) {
      labelsHtml += '<div class="label-wrapper">' + labelHtml + '</div>\n';
    }

    const rotateStyle = rotacionar90 ? `
      transform: rotate(90deg);
      transform-origin: center;
      width: 80mm;
      height: 50mm;
    ` : `
      width: 100%;
      height: 100%;
    `;

    printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    
    @page {
      size: ${pageWidth} ${pageHeight};
      margin: 0;
      padding: 0;
    }
    
    html, body {
      width: ${pageWidth};
      height: ${pageHeight};
      margin: 0;
      padding: 0;
      background: white;
    }
    
    @media print {
      .label-wrapper {
        width: ${pageWidth};
        height: ${pageHeight};
        page-break-after: always;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        margin: 0;
        padding: 0;
      }
      
      .label-wrapper:last-child {
        page-break-after: avoid;
      }
      
      .label-wrapper > div {
        ${rotateStyle}
        transform-origin: center;
        margin: 0;
        padding: 0;
      }
      
      /* Remove qualquer border ou escala do preview */
      .label-wrapper > div > div {
        transform: none !important;
        border: none !important;
      }
    }
    
    @media screen {
      body {
        background: #f0f0f0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 16px;
        padding: 24px;
      }
      
      .label-wrapper {
        background: white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 4px;
        width: 80mm;
        height: 50mm;
      }
    }
  </style>
</head>
<body>
  ${labelsHtml}
  <script>
    window.onload = () => {
      setTimeout(() => { window.print(); window.close(); }, 300);
    };
  </script>
</body>
</html>
    `);
    printWindow.document.close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="w-5 h-5 text-accent" />
            Imprimir Etiqueta (Padrão Honeywell)
          </DialogTitle>
          <DialogDescription>Ajuste os dados e a orientação para a sua impressora.</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pt-2">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Tipo</label>
                <Input className="h-8 text-xs" value={labelData.tipo} onChange={e => setLabelData({...labelData, tipo: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Bitola</label>
                <Input className="h-8 text-xs" value={labelData.bitola} onChange={e => setLabelData({...labelData, bitola: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Fornecedor</label>
                <Input className="h-8 text-xs" value={labelData.fornecedor} onChange={e => setLabelData({...labelData, fornecedor: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Nota Fiscal</label>
                <Input className="h-8 text-xs" value={labelData.nf} onChange={e => setLabelData({...labelData, nf: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Comprimento</label>
                <Input className="h-8 text-xs" value={labelData.comprimento} onChange={e => setLabelData({...labelData, comprimento: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Corrida</label>
                <Input className="h-8 text-xs" value={labelData.corrida} onChange={e => setLabelData({...labelData, corrida: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Obra</label>
                <Input className="h-8 text-xs" value={labelData.obra} onChange={e => setLabelData({...labelData, obra: e.target.value})} />
              </div>
              <div className="space-y-1">
                <label className="text-[10px] font-bold uppercase">Qtd Etiquetas</label>
                <Input type="number" min={1} placeholder="Ex: 1" className="h-8 text-xs" value={numEtiquetas || ""} onChange={e => setNumEtiquetas(e.target.value === "" ? 0 : (parseInt(e.target.value) || 0))} />
              </div>
            </div>

            <div className="border-t pt-4 space-y-3">
              <h3 className="text-sm font-semibold">Ajuste de Impressora</h3>
              <Button 
                variant={rotacionar90 ? "default" : "outline"} 
                className="w-full gap-2" 
                onClick={() => setRotacionar90(!rotacionar90)}
              >
                <RotateCw className="w-4 h-4" />
                {rotacionar90 ? "Modo: Rotacionado 90° (Vertical)" : "Modo: Normal (Horizontal)"}
              </Button>
              <p className="text-[10px] text-muted-foreground">
                Se a etiqueta sair "atravessada" ou com espaços em branco, ative o modo rotacionado.
              </p>
            </div>

            <Button onClick={handlePrint} className="w-full gap-2 bg-accent hover:bg-accent/90 h-10">
              <Printer className="w-4 h-4" /> Imprimir
            </Button>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-center">Preview</h3>
            <div className="flex items-center justify-center bg-muted/30 rounded-lg p-4 border border-dashed">
              <div style={{
                width: `${LABEL_W_MM * MM_TO_PX * PREVIEW_SCALE}px`,
                height: `${LABEL_H_MM * MM_TO_PX * PREVIEW_SCALE}px`,
                transform: rotacionar90 ? "rotate(90deg)" : "none",
                transition: "transform 0.3s ease",
                backgroundColor: "white",
                boxShadow: "0 4px 12px rgba(0,0,0,0.1)"
              }}>
                <Label80x50 ref={labelRef} data={labelData} scale={PREVIEW_SCALE} />
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
