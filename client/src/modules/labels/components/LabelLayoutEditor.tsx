// /modules/labels/components/LabelLayoutEditor.tsx
// Painel de edição da estrutura da etiqueta (fontes, margens, linhas)

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { ArrowDown, ArrowUp, RotateCcw } from "lucide-react";

import {
  DEFAULT_LAYOUT,
  type LabelLayout,
  type LabelLineLayout,
} from "../templates/label-layout";

interface LabelLayoutEditorProps {
  layout: LabelLayout;
  onChange: (layout: LabelLayout) => void;
}

const LABEL_CLASS =
  "text-[10px] font-bold uppercase text-muted-foreground";

// Altura ÷ largura da imagem do logo (84×130 px)
const LOGO_PROPORCAO = 130 / 84;

// Campo numérico em mm: guarda o texto digitado para permitir apagar
// e redigitar sem o valor "voltar" a cada tecla
function MmField({
  label,
  value,
  onChange,
  step = 0.1,
  permitirNegativo = false,
  disabled = false,
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  permitirNegativo?: boolean;
  disabled?: boolean;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText((current) =>
      parseFloat(current) === value ? current : String(value)
    );
  }, [value]);

  const input = (
    <Input
      type="number"
      min={permitirNegativo ? undefined : 0}
      step={step}
      className="h-8 text-xs"
      disabled={disabled}
      value={text}
      onChange={(e) => {
        setText(e.target.value);

        const parsed = parseFloat(e.target.value);

        if (!isNaN(parsed) && (permitirNegativo || parsed >= 0)) {
          onChange(parsed);
        }
      }}
      onBlur={() => setText(String(value))}
    />
  );

  if (!label) return input;

  return (
    <div className="space-y-1">
      <label className={LABEL_CLASS}>{label}</label>
      {input}
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 h-8 mt-[18px] px-2 rounded-md border border-input">
      <span className={LABEL_CLASS}>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}

export function LabelLayoutEditor({
  layout,
  onChange,
}: LabelLayoutEditorProps) {
  const set = <K extends keyof LabelLayout>(
    key: K,
    value: LabelLayout[K]
  ) => {
    onChange({ ...layout, [key]: value });
  };

  const setLinha = (
    index: number,
    patch: Partial<LabelLineLayout>
  ) => {
    set(
      "linhas",
      layout.linhas.map((linha, i) =>
        i === index ? { ...linha, ...patch } : linha
      )
    );
  };

  const moverLinha = (index: number, delta: -1 | 1) => {
    const destino = index + delta;

    if (destino < 0 || destino >= layout.linhas.length) return;

    const linhas = [...layout.linhas];

    [linhas[index], linhas[destino]] = [linhas[destino], linhas[index]];

    set("linhas", linhas);
  };

  return (
    <div className="space-y-4">

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">
          Estrutura da Etiqueta
        </h3>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange(DEFAULT_LAYOUT)}
          className="gap-1 text-xs"
        >
          <RotateCcw className="w-3 h-3" />
          Layout padrão
        </Button>
      </div>

      <p className="text-[10px] text-muted-foreground">
        Medidas em milímetros. As alterações aparecem no preview e
        ficam salvas neste computador.
      </p>

      {/* CABEÇALHO */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Cabeçalho</h4>

        <div className="space-y-1">
          <label className={LABEL_CLASS}>Texto do título</label>

          <Input
            className="h-8 text-xs"
            value={layout.tituloTexto}
            onChange={(e) => set("tituloTexto", e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MmField
            label="Fonte do título"
            value={layout.tituloFontSize}
            onChange={(v) => set("tituloFontSize", v)}
          />

          <MmField
            label="Fonte do perfil"
            value={layout.perfilFontSize}
            onChange={(v) => set("perfilFontSize", v)}
          />

        </div>
      </div>

      {/* LOGO */}
      <div className="border-t pt-4 space-y-2">
        <h4 className="text-xs font-semibold">Logo</h4>

        <div className="grid grid-cols-2 gap-3">
          <SwitchField
            label="Exibir logo"
            checked={layout.logoVisivel}
            onChange={(v) => set("logoVisivel", v)}
          />

          <SwitchField
            label="Proporcional"
            checked={layout.logoProporcional}
            onChange={(v) =>
              onChange({
                ...layout,
                logoProporcional: v,
                // Ao soltar a proporção, parte da altura atual do logo
                logoAltura: v
                  ? layout.logoAltura
                  : Math.round(layout.logoLargura * LOGO_PROPORCAO * 10) / 10,
              })
            }
          />

          <MmField
            label="Largura"
            value={layout.logoLargura}
            step={0.5}
            onChange={(v) => set("logoLargura", v)}
          />

          <MmField
            label={layout.logoProporcional ? "Altura (automática)" : "Altura"}
            value={
              layout.logoProporcional
                ? Math.round(layout.logoLargura * LOGO_PROPORCAO * 10) / 10
                : layout.logoAltura
            }
            step={0.5}
            disabled={layout.logoProporcional}
            onChange={(v) => set("logoAltura", v)}
          />

          <MmField
            label="Posição X (← −  + →)"
            value={layout.logoDeslocX}
            step={0.5}
            permitirNegativo
            onChange={(v) => set("logoDeslocX", v)}
          />

          <MmField
            label="Posição Y (↑ −  + ↓)"
            value={layout.logoDeslocY}
            step={0.5}
            permitirNegativo
            onChange={(v) => set("logoDeslocY", v)}
          />
        </div>
      </div>

      {/* QR CODE */}
      <div className="border-t pt-4 space-y-2">
        <h4 className="text-xs font-semibold">QR code</h4>

        <div className="grid grid-cols-2 gap-3">
          <SwitchField
            label="Exibir QR"
            checked={layout.qrVisivel}
            onChange={(v) => set("qrVisivel", v)}
          />

          <MmField
            label="Tamanho do QR"
            value={layout.qrTamanho}
            step={0.5}
            onChange={(v) => set("qrTamanho", v)}
          />
        </div>

        <p className="text-[10px] text-muted-foreground">
          Abaixo de ~20mm a leitura na impressão térmica fica difícil.
        </p>
      </div>

      {/* LINHAS */}
      <div className="border-t pt-4 space-y-2">
        <h4 className="text-xs font-semibold">Linhas de dados</h4>

        <div className="grid grid-cols-[auto_1fr_4.5rem_auto_auto] items-center gap-x-2 gap-y-1.5">

          <span className={LABEL_CLASS}>Exibir</span>
          <span className={LABEL_CLASS}>Rótulo</span>
          <span className={LABEL_CLASS}>Fonte</span>
          <span className={LABEL_CLASS}>Sublinhar</span>
          <span className={LABEL_CLASS}>Ordem</span>

          {layout.linhas.map((linha, index) => (
            <div key={linha.key} className="contents">

              <Switch
                checked={linha.visivel}
                onCheckedChange={(v) =>
                  setLinha(index, { visivel: v })
                }
              />

              <Input
                className="h-8 text-xs"
                value={linha.rotulo}
                disabled={!linha.visivel}
                onChange={(e) =>
                  setLinha(index, { rotulo: e.target.value })
                }
              />

              <MmField
                value={linha.fontSize}
                onChange={(v) => setLinha(index, { fontSize: v })}
              />

              <Switch
                checked={linha.sublinhado}
                onCheckedChange={(v) =>
                  setLinha(index, { sublinhado: v })
                }
              />

              <div className="flex">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-7"
                  disabled={index === 0}
                  onClick={() => moverLinha(index, -1)}
                  aria-label={`Subir ${linha.rotulo}`}
                >
                  <ArrowUp className="w-3 h-3" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-7"
                  disabled={index === layout.linhas.length - 1}
                  onClick={() => moverLinha(index, 1)}
                  aria-label={`Descer ${linha.rotulo}`}
                >
                  <ArrowDown className="w-3 h-3" />
                </Button>
              </div>

            </div>
          ))}

        </div>
      </div>

      {/* GERAL */}
      <div className="border-t pt-4 space-y-2">
        <h4 className="text-xs font-semibold">Margens e borda</h4>

        <div className="grid grid-cols-2 gap-3">
          <MmField
            label="Margem superior/inferior"
            value={layout.paddingVertical}
            onChange={(v) => set("paddingVertical", v)}
          />

          <MmField
            label="Margem lateral"
            value={layout.paddingHorizontal}
            onChange={(v) => set("paddingHorizontal", v)}
          />

          <MmField
            label="Espaço entre linhas"
            value={layout.espacoLinhas}
            onChange={(v) => set("espacoLinhas", v)}
          />

          <SwitchField
            label="Borda"
            checked={layout.bordaVisivel}
            onChange={(v) => set("bordaVisivel", v)}
          />

          <MmField
            label="Espessura da borda"
            value={layout.bordaEspessura}
            onChange={(v) => set("bordaEspessura", v)}
          />

          <MmField
            label="Raio dos cantos"
            value={layout.bordaRaio}
            step={0.5}
            onChange={(v) => set("bordaRaio", v)}
          />
        </div>
      </div>

    </div>
  );
}
