/**
 * LocalizacaoPatio
 * Divide o campo "local" em Rua / Vão / Prateleira.
 * Concatena no formato "R-03 / V-12 / P-02" — compatível com o campo
 * local VARCHAR existente no banco, sem mudança de schema.
 */
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { MapPin } from "lucide-react";

interface Props {
  value?: string | null;
  onChange: (valor: string) => void;
  disabled?: boolean;
}

function decomporLocalizacao(valor: string | null | undefined): [string, string, string] {
  if (!valor) return ["", "", ""];
  const partes = valor.split("/").map((p) => p.trim());
  const limpar = (s: string, prefixo: string) =>
    s.toUpperCase().startsWith(prefixo) ? s.slice(prefixo.length) : s;
  return [
    limpar(partes[0] ?? "", "R-"),
    limpar(partes[1] ?? "", "V-"),
    limpar(partes[2] ?? "", "P-"),
  ];
}

export function LocalizacaoPatio({ value, onChange, disabled = false }: Props) {
  const [rua, setRua] = useState("");
  const [vao, setVao] = useState("");
  const [prateleira, setPrateleira] = useState("");

  // Inicializa a partir do valor salvo — só na montagem
  useEffect(() => {
    const [r, v, p] = decomporLocalizacao(value);
    setRua(r);
    setVao(v);
    setPrateleira(p);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const emitir = (r: string, v: string, p: string) => {
    const partes = [
      r ? `R-${r.toUpperCase()}` : "",
      v ? `V-${v.toUpperCase()}` : "",
      p ? `P-${p.toUpperCase()}` : "",
    ].filter(Boolean);
    onChange(partes.join(" / "));
  };

  const preview = [
    rua ? `R-${rua.toUpperCase()}` : null,
    vao ? `V-${vao.toUpperCase()}` : null,
    prateleira ? `P-${prateleira.toUpperCase()}` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {/* Rua */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Rua</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none select-none">
              R-
            </span>
            <Input
              value={rua}
              onChange={(e) => { setRua(e.target.value); emitir(e.target.value, vao, prateleira); }}
              placeholder="03"
              disabled={disabled}
              maxLength={6}
              className="pl-7 uppercase"
            />
          </div>
        </div>

        {/* Vão */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Vão</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none select-none">
              V-
            </span>
            <Input
              value={vao}
              onChange={(e) => { setVao(e.target.value); emitir(rua, e.target.value, prateleira); }}
              placeholder="12"
              disabled={disabled}
              maxLength={6}
              className="pl-7 uppercase"
            />
          </div>
        </div>

        {/* Prateleira */}
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">Prateleira</label>
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted-foreground pointer-events-none select-none">
              P-
            </span>
            <Input
              value={prateleira}
              onChange={(e) => { setPrateleira(e.target.value); emitir(rua, vao, e.target.value); }}
              placeholder="02"
              disabled={disabled}
              maxLength={6}
              className="pl-7 uppercase"
            />
          </div>
        </div>
      </div>

      {/* Preview formatado */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-h-[18px]">
        {preview ? (
          <>
            <MapPin className="w-3.5 h-3.5 shrink-0" />
            <span>
              Localização:{" "}
              <span className="font-mono font-medium text-foreground">{preview}</span>
            </span>
          </>
        ) : (
          <span className="italic">Preencha ao menos um campo para gerar a localização.</span>
        )}
      </div>
    </div>
  );
}
