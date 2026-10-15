// /modules/labels/components/PrintDialog.tsx
// Modal profissional de geração e impressão de etiquetas industriais

import { useRef, useState, useCallback, useEffect, useMemo } from "react";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";

import { Label80x50 } from "./Label80x50";
import { LabelLayoutEditor } from "./LabelLayoutEditor";

import {
  loadLayout,
  saveLayout,
  type LabelLayout,
} from "../templates/label-layout";

import { montarConteudoQr } from "../qr-material";
import { rasterizarEtiqueta } from "../rasterizar-etiqueta";
import { Switch } from "@/components/ui/switch";

import {
  materialToLabelData,
  TEMPLATES,
  DEFAULT_TEMPLATE,
  type LabelData,
  type LabelTemplate,
} from "../templates/industrial-80x50";

import {
  Printer,
  RotateCcw,
  Tag,
  Loader2,
  AlertTriangle,
} from "lucide-react";

import { trpc } from "@/lib/trpc";

interface Material {
  id?: string | number;
  quantidade?: number;

  [key: string]: any;
}

interface PrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  material: Material;
}

// Conversão mm → px (96dpi)
const MM_TO_PX = 3.7795275591;

// Escala visual do preview
const PREVIEW_SCALE = 1.8;

// Tamanho real da etiqueta (Label80x50)
const LABEL_W_MM = 80;
const LABEL_H_MM = 50;

// Converte "80mm" → 80
const parseMm = (value: string): number => {
  return Number(value.replace("mm", "").trim());
};

const OFFSET_STORAGE_KEY = "etiqueta.offsetMm";
const NITIDA_STORAGE_KEY = "etiqueta.impressaoNitida";

const readStoredOffset = (): { x: string; y: string } => {
  try {
    const stored = JSON.parse(
      localStorage.getItem(OFFSET_STORAGE_KEY) || "{}"
    );

    return {
      x: String(stored.x ?? "0"),
      y: String(stored.y ?? "0"),
    };
  } catch {
    return { x: "0", y: "0" };
  }
};

// "1,5" ou "-2" → número em mm (0 se inválido)
const parseOffset = (value: string): number => {
  const parsed = Number(value.replace(",", "."));

  return isNaN(parsed) ? 0 : parsed;
};

export function PrintDialog({
  open,
  onOpenChange,
  material,
}: PrintDialogProps) {
  const labelRef = useRef<HTMLDivElement>(null);

  // =========================
  // STATES
  // =========================

  const [labelData, setLabelData] = useState<LabelData>(() => {
    const data = materialToLabelData(material);
    return {
      ...data,
      categoria: material.categoria,
      largura: material.largura
    } as any;
  });

  const [template, setTemplate] =
    useState<LabelTemplate>(DEFAULT_TEMPLATE);

  const [numEtiquetas, setNumEtiquetas] = useState<number>(
    material?.quantidade || 1
  );

  const [printing, setPrinting] = useState(false);

  // Impressão nítida: manda a etiqueta como imagem preto e branco na
  // resolução da térmica (ver rasterizar-etiqueta.ts). Desligada = HTML puro.
  const [impressaoNitida, setImpressaoNitida] = useState<boolean>(() => {
    try {
      return localStorage.getItem(NITIDA_STORAGE_KEY) !== "0";
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(NITIDA_STORAGE_KEY, impressaoNitida ? "1" : "0");
    } catch {
      // armazenamento indisponível: vale só para esta sessão
    }
  }, [impressaoNitida]);

  // Calibração da posição na impressora (mm), guardada por navegador
  const [offsetX, setOffsetX] = useState<string>(
    () => readStoredOffset().x
  );

  const [offsetY, setOffsetY] = useState<string>(
    () => readStoredOffset().y
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        OFFSET_STORAGE_KEY,
        JSON.stringify({ x: offsetX, y: offsetY })
      );
    } catch {
      // armazenamento indisponível: o ajuste vale só para esta sessão
    }
  }, [offsetX, offsetY]);

  // Estrutura editável da etiqueta (fontes, margens, linhas)
  const [layout, setLayout] = useState<LabelLayout>(loadLayout);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  // Avisa quando o conteúdo não cabe na altura da etiqueta
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const node = labelRef.current;

    setOverflowing(
      !!node && node.scrollHeight > node.clientHeight + 1
    );
  }, [layout, labelData, open]);

  // =========================
  // tRPC
  // =========================

  const marcarImpressao =
    trpc.materiais.marcarEtiquetaImpressa.useMutation();

  // GRDs do material — entram no QR code
  const materialId = Number(material?.id);

  const { data: grds, isLoading: carregandoGrds } =
    trpc.materiais.grdsDoMaterial.useQuery(
      { id: materialId },
      { enabled: open && materialId > 0 }
    );

  // O QR leva os dados do cadastro (não os campos editados na etiqueta),
  // só a quantidade segue o que está sendo etiquetado
  const qrConteudo = useMemo(
    () =>
      materialId > 0
        ? montarConteudoQr(material as any, labelData.quantidade, grds ?? [])
        : undefined,
    [material, materialId, labelData.quantidade, grds]
  );

  const labelDataComQr = useMemo(
    () => ({ ...labelData, qrConteudo }),
    [labelData, qrConteudo]
  );

  // =========================
  // RESETAR DADOS
  // =========================

  const resetFromMaterial = useCallback(() => {
    if (!material) return;

    const data = materialToLabelData(material);

    setLabelData({
      ...data,
      categoria: material.categoria,
      largura: material.largura
    } as any);

    setNumEtiquetas(material.quantidade || 1);
  }, [material]);

  // =========================
  // SINCRONIZAÇÃO
  // =========================

  useEffect(() => {
    if (open && material) {
      resetFromMaterial();
    }
  }, [open, material, resetFromMaterial]);

  // Sincroniza quantidade da etiqueta
  useEffect(() => {
    const quantidade = Number(labelData.quantidade);

    if (!isNaN(quantidade) && quantidade > 0) {
      setNumEtiquetas(quantidade);
    }
  }, [labelData.quantidade]);

  // =========================
  // DIMENSÕES TEMPLATE
  // =========================

  const widthMm = parseMm(template.largura);
  const heightMm = parseMm(template.altura);

  // Escala do preview: no celular acompanha a largura da tela; no PC usa o
  // maior tamanho que cabe na área do preview
  const previewRef = useRef<HTMLDivElement>(null);
  const [previewScale, setPreviewScale] = useState(2);

  useEffect(() => {
    if (!open) return;

    const el = previewRef.current;

    if (!el) return;

    const observer = new ResizeObserver(([entry]) => {
      const estilo = getComputedStyle(el);
      const { width: largura, height: altura } = entry.contentRect;

      const porLargura = largura / (LABEL_W_MM * MM_TO_PX);

      // No celular a altura do preview depende da própria etiqueta —
      // só a largura limita
      const porAltura =
        estilo.flexGrow !== "0"
          ? altura / (LABEL_H_MM * MM_TO_PX)
          : Infinity;

      const escala = Math.min(4, porLargura, porAltura);

      setPreviewScale(Math.max(0.5, Math.floor(escala * 20) / 20));
    });

    observer.observe(el);

    return () => observer.disconnect();
  }, [open]);

  const previewWidth =
    widthMm * MM_TO_PX * PREVIEW_SCALE;

  const previewHeight =
    heightMm * MM_TO_PX * PREVIEW_SCALE;

  // =========================
  // IMPRESSÃO
  // =========================

  const handlePrint = async () => {
    if (printing) return;

    if (!labelRef.current) {
      alert("Erro ao gerar etiqueta.");
      return;
    }

    // O preview usa transform: scale(2); na impressão a etiqueta precisa
    // sair em tamanho real, senão só o canto superior esquerdo cabe na página
    const printNode = labelRef.current.cloneNode(true) as HTMLDivElement;

    printNode.style.transformOrigin = "top left";
    const dx = parseOffset(offsetX);
    const dy = parseOffset(offsetY);

    printNode.style.transform =
      template.orientacao === "vertical"
        ? `translate(${widthMm + dx}mm, ${dy}mm) rotate(90deg)`
        : `translate(${dx}mm, ${dy}mm)`;

    // Abre a janela já no clique — se abrir depois de esperar a geração da
    // imagem, o navegador pode tratar como pop-up não solicitado e bloquear
    const printWindow = window.open(
      "",
      "_blank",
      "width=1000,height=700"
    );

    if (!printWindow) {
      alert(
        "Pop-up bloqueado. Permita pop-ups para este site."
      );
      return;
    }

    printWindow.document.write(
      "<p style='font-family:Arial,sans-serif;padding:24px'>Gerando etiqueta...</p>"
    );

    try {
      setPrinting(true);

      let labelHtml: string;

      if (impressaoNitida) {
        // Imagem só preto e branco, ponto a ponto na resolução da térmica
        const png = await rasterizarEtiqueta(labelRef.current, LABEL_W_MM, LABEL_H_MM);

        const img = document.createElement("img");
        img.src = png;
        img.className = "etiqueta-bitmap";
        img.style.transformOrigin = printNode.style.transformOrigin;
        img.style.transform = printNode.style.transform;

        labelHtml = img.outerHTML;
      } else {
        labelHtml = printNode.outerHTML;
      }

      // Marca no banco
      if (material?.id) {
        await marcarImpressao.mutateAsync({
          id: material.id,
        });
      }

      printWindow.document.open();

      const labelsHtml = Array.from({
        length: numEtiquetas,
      })
        .map(
          () => `
            <div class="label-page">
              ${labelHtml}
            </div>
          `
        )
        .join("");

      printWindow.document.write(`
<!DOCTYPE html>
<html lang="pt-BR">

<head>
  <meta charset="UTF-8" />

  <title>
    Etiqueta - ${labelData.tipo || ""}
  </title>

  <style>
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    html,
    body {
      width: 100%;
      background: white;
      font-family: Arial, Helvetica, sans-serif;
    }

    @page {
      ${template.pageSize ? `size: ${template.pageSize};` : ""}
      margin: 0;
    }

    .label-page {
      width: ${template.largura};
      height: ${template.altura};

      position: relative;
      overflow: hidden;
    }

    /* Imagem já na resolução da térmica: sem suavização ao escalar */
    .etiqueta-bitmap {
      display: block;
      width: ${LABEL_W_MM}mm;
      height: ${LABEL_H_MM}mm;
      image-rendering: pixelated;
      image-rendering: crisp-edges;
    }

    @media print {

      html,
      body {
        width: ${template.largura};
      }

      * {
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }

      .label-page {
        page-break-after: always;
        break-inside: avoid;
      }

      .label-page:last-of-type {
        page-break-after: auto;
      }
    }

    @media screen {
      body {
        background: #e5e5e5;

        display: flex;
        flex-direction: column;
        align-items: center;

        gap: 20px;
        padding: 24px;
      }

      .label-page {
        background: white;

        box-shadow:
          0 2px 8px rgba(0,0,0,.2);

        flex-shrink: 0;
      }
    }
  </style>
</head>

<body>

${labelsHtml}

<script>
  window.onload = () => {
    setTimeout(() => {
      window.print();

      window.onafterprint = () => {
        window.close();
      };
    }, 300);
  };
</script>

</body>
</html>
      `);

      printWindow.document.close();
    } catch (error) {
      console.error(error);

      printWindow.close();
      alert(
        impressaoNitida
          ? "Erro ao gerar a etiqueta para impressão. Tente desligar a \"Impressão nítida\" nas configurações de impressão."
          : "Erro ao imprimir etiqueta."
      );
    } finally {
      setPrinting(false);
    }
  };

  // =========================
  // RENDER FIELD
  // =========================

  const field = (
    key: keyof LabelData,
    label: string,
    type: "text" | "number" = "text"
  ) => {
    return (
      <div className="space-y-1">
        <label className="text-[10px] font-bold uppercase text-muted-foreground">
          {label}
        </label>

        <Input
          type={type}
          className="h-8 text-xs"
          value={
            labelData[key] === null ||
            labelData[key] === undefined
              ? ""
              : String(labelData[key])
          }
          onChange={(e) => {
            const value = e.target.value;

            setLabelData((prev) => ({
              ...prev,

              [key]:
                type === "number"
                  ? value === ""
                    ? ""
                    : Number(value)
                  : value,
            }));
          }}
        />
      </div>
    );
  };

  // =========================
  // RENDER
  // =========================

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
    >
<DialogContent
  // O DialogContent base limita a largura com sm:max-w-lg / md:max-w-2xl —
  // é preciso sobrescrever nos mesmos breakpoints, senão o modal fica estreito
  className="
    w-[98vw]
    max-w-[98vw]
    sm:max-w-[98vw]
    md:max-w-[98vw]
    h-[96vh]
    max-h-[96vh]
    p-0
    gap-0
    overflow-hidden
    flex
    flex-col
  "
>
  {/* HEADER */}
  <DialogHeader className="px-4 sm:px-6 py-4 pr-12 border-b shrink-0 text-left">
    <DialogTitle className="flex items-center gap-2">
      <Tag className="w-5 h-5 text-accent" />

      Gerar Etiqueta —
      {" "}
      {labelData.tipo}
      {" "}
      {labelData.bitola}
    </DialogTitle>

    <DialogDescription>
      Verifique os dados antes de imprimir.
    </DialogDescription>
  </DialogHeader>

  {/* CONTEÚDO */}
  {/* Celular: tudo numa coluna rolável, preview primeiro.
      PC: painel de edição fixo à esquerda e preview ocupando o resto. */}
  <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto overflow-x-hidden lg:overflow-hidden">

      {/* PAINEL ESQUERDO */}
      <Tabs
        defaultValue="dados"
        className="
          order-2
          lg:order-1
          lg:w-[440px]
          xl:w-[480px]
          shrink-0
          border-t
          lg:border-t-0
          lg:border-r
          lg:overflow-y-auto
          p-4
          sm:p-6
          gap-4
        "
      >

        <TabsList className="w-full">
          <TabsTrigger value="dados">Dados e impressão</TabsTrigger>
          <TabsTrigger value="layout">Editar etiqueta</TabsTrigger>
        </TabsList>

        <TabsContent value="layout">
          <LabelLayoutEditor
            layout={layout}
            onChange={setLayout}
          />
        </TabsContent>

        <TabsContent value="dados" className="space-y-4">

        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            Dados da Etiqueta
          </h3>

          <Button
            variant="ghost"
            size="sm"
            onClick={resetFromMaterial}
            className="gap-1 text-xs"
          >
            <RotateCcw className="w-3 h-3" />
            Restaurar
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-3">

          {field("tipo", "Tipo")}
          {field("bitola", "Bitola")}
          {field("comprimento", "Comprimento")}
          {field("aco", "Aço")}
          {field("nf", "Nota Fiscal")}
          {field("corrida", "Corrida")}
          {field("certificado", "Certificado")}
          {field("peso", "Peso")}
          {field("obra", "Obra")}
          {field("fornecedor", "Fornecedor")}
          {field("local", "Local")}
          {field("quantidade", "Qtd Peças", "number")}

        </div>

        <div className="border-t pt-4 space-y-3">

          <h3 className="text-sm font-semibold">
            Configurações de Impressão
          </h3>

          <div className="grid grid-cols-2 gap-3">

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">
                Template
              </label>

              <select
                className="w-full h-8 px-2 text-xs rounded-md border border-input bg-background"
                value={template.id}
                onChange={(e) => {
                  const selected =
                    TEMPLATES.find(
                      (t) => t.id === e.target.value
                    );

                  setTemplate(
                    selected || DEFAULT_TEMPLATE
                  );
                }}
              >
                {TEMPLATES.map((template) => (
                  <option
                    key={template.id}
                    value={template.id}
                  >
                    {template.nome}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">
                Nº Etiquetas
              </label>

              <Input
                type="number"
                min={1}
                max={500}
                className="h-8 text-xs"
                value={numEtiquetas}
                onChange={(e) => {
                  const value = Number(e.target.value);

                  setNumEtiquetas(
                    isNaN(value) || value <= 0
                      ? 1
                      : value
                  );
                }}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">
                Ajuste Horizontal (mm)
              </label>

              <Input
                type="text"
                inputMode="decimal"
                className="h-8 text-xs"
                value={offsetX}
                onChange={(e) => setOffsetX(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-muted-foreground">
                Ajuste Vertical (mm)
              </label>

              <Input
                type="text"
                inputMode="decimal"
                className="h-8 text-xs"
                value={offsetY}
                onChange={(e) => setOffsetY(e.target.value)}
              />
            </div>

          </div>

          <p className="text-[10px] text-muted-foreground">
            Positivo move a impressão para a direita / para baixo;
            negativo, para a esquerda / para cima. O ajuste fica
            salvo neste computador.
          </p>

          <label className="flex items-start justify-between gap-3 rounded-md border p-3">
            <span>
              <span className="block text-xs font-semibold">Impressão nítida (térmica)</span>
              <span className="block text-[10px] text-muted-foreground">
                Envia a etiqueta em preto e branco puro, ponto a ponto na
                resolução da impressora (203 dpi). Evita o borrado.
              </span>
            </span>
            <Switch checked={impressaoNitida} onCheckedChange={setImpressaoNitida} />
          </label>

        </div>

        <Button
          onClick={handlePrint}
          disabled={printing || (materialId > 0 && carregandoGrds)}
          className="w-full gap-2 h-10 bg-accent hover:bg-accent/90"
        >
          {printing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Imprimindo...
            </>
          ) : (
            <>
              <Printer className="w-4 h-4" />

              Imprimir
            </>
          )}
        </Button>

        </TabsContent>

      </Tabs>

      {/* PREVIEW */}
      <div
        className="
          order-1
          lg:order-2
          flex-1
          min-w-0
          flex
          flex-col
          lg:overflow-hidden
        "
      >

        <div className="px-4 sm:px-6 py-3 border-b shrink-0 flex items-center justify-between">

          <h3 className="text-sm font-semibold">
            Preview em Tempo Real
          </h3>

          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
            {template.largura}
            {" × "}
            {template.altura}
          </span>

        </div>

        {overflowing && (
          <div className="px-6 py-2 border-b shrink-0 flex items-center gap-2 text-xs text-amber-700 bg-amber-50">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            O conteúdo não cabe na altura da etiqueta e será cortado
            na impressão. Reduza fontes, espaçamento ou linhas.
          </div>
        )}

        <div
          ref={previewRef}
          className="
            lg:flex-1
            min-h-0
            overflow-hidden
            flex
            items-center
            justify-center
            bg-zinc-100
            p-4
            sm:p-6
            lg:p-10
          "
        >

          {/* A etiqueta é sempre 80×50mm; a escala acompanha o espaço livre */}
          <div
            style={{
              width: `${LABEL_W_MM * MM_TO_PX * previewScale}px`,
              height: `${LABEL_H_MM * MM_TO_PX * previewScale}px`,
              flexShrink: 0,
            }}
          >
            <Label80x50
              ref={labelRef}
              data={labelDataComQr}
              layout={layout}
              scale={previewScale}
            />
          </div>

        </div>

      </div>

  </div>
</DialogContent>

    </Dialog>
  );
}