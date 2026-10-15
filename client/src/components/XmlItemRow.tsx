/**
 * XmlItemRow.tsx
 * Linha do modal de importação XML com cálculo reverso de quantidade via base técnica.
 *
 * Lógica:
 *   - Quando tipo + bitola + aco estão preenchidos, faz lookup na base de especificações
 *   - Se encontrar pesoPorMetro, calcula: quantidade = pesoTotalNF / (pesoPorMetro × comprimento_m)
 *   - O resultado é exibido como sugestão e aplicado automaticamente ao campo quantidade
 *   - O usuário pode editar qualquer campo livremente — o cálculo é apenas uma sugestão inicial
 *   - Se a especificação não for encontrada, exibe aviso discreto mas não bloqueia nada
 */

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

interface XmlItem {
  tipo: string;
  bitola: string;
  aco: string;
  categoria?: string;
  quantidade: number;
  comprimento: number;
  largura?: number;
  pesoTotal: number;
  numeroCertificado: string;
  corrida: string;
  obraId?: number;
  obraCompraId?: number;
  descricaoOriginal?: string;
  _calculoReversoPendente?: boolean;
  /** true quando o peso foi calculado pela especificação (unidade da NF era de contagem, ex: UN/PÇ) */
  pesoCalculadoAuto?: boolean;
  /** true quando não existe especificação cadastrada pra calcular o peso — precisa preencher manualmente */
  pesoPendente?: boolean;
}

interface XmlItemRowProps {
  item: XmlItem;
  idx: number;
  obras: { id: number; nome: string }[] | undefined;
  onChange: (updated: XmlItem) => void;
  onRemove: () => void;
}

export function XmlItemRow({ item, idx, obras, onChange, onRemove }: XmlItemRowProps) {
  const [calculoAplicado, setCalculoAplicado] = useState(false);

  // Só faz lookup se tipo e bitola estiverem preenchidos
  const skip = !item.tipo || !item.bitola;

  const { data: spec, isFetching } = trpc.especificacoes.lookup.useQuery(
    {
      tipo: item.tipo?.trim().toUpperCase() || "",
      bitola: item.bitola?.trim().toUpperCase() || "",
      aco: item.aco?.trim().toUpperCase() || "A36",
    },
    {
      enabled: !skip,
      staleTime: 60_000,
      retry: false,
    }
  );

  // Cálculo reverso: aplica automaticamente quando spec chega pela primeira vez
  useEffect(() => {
    if (!spec || calculoAplicado || !item._calculoReversoPendente) return;
    if (!item.pesoTotal || !item.comprimento) return;

    const pesoPorMetro = parseFloat(String(spec.pesoPorMetro));
    const comprimentoM = item.comprimento / 1000;

    if (pesoPorMetro > 0 && comprimentoM > 0) {
      const qtdCalculada = Math.round(item.pesoTotal / (pesoPorMetro * comprimentoM));
      if (qtdCalculada > 0) {
        onChange({ ...item, quantidade: qtdCalculada, _calculoReversoPendente: false });
        setCalculoAplicado(true);
      }
    }
  }, [spec]);

  // Recalcula quando comprimento muda manualmente (após cálculo já aplicado)
  const handleComprimentoChange = (novoComp: number) => {
    const updated = { ...item, comprimento: novoComp };

    if (spec && item.pesoTotal && novoComp > 0) {
      const pesoPorMetro = parseFloat(String(spec.pesoPorMetro));
      const comprimentoM = novoComp / 1000;
      if (pesoPorMetro > 0) {
        const qtdCalculada = Math.round(item.pesoTotal / (pesoPorMetro * comprimentoM));
        if (qtdCalculada > 0) updated.quantidade = qtdCalculada;
      }
    }

    onChange(updated);
  };

  const especEncontrada = !!spec && !isFetching;
  const especNaoEncontrada = !spec && !isFetching && !skip;

  return (
    <tr className="hover:bg-muted/20">
      {/* ── Categoria / Tipo / Bitola ── */}
      <td className="p-2">
        <div className="flex gap-1 mb-1">
          <select
            className="h-6 w-20 text-[10px] border rounded bg-background"
            value={item.categoria || "PERFIL"}
            onChange={e => onChange({ ...item, categoria: e.target.value })}
          >
            <option value="PERFIL">PERFIL</option>
            <option value="CHAPA">CHAPA</option>
          </select>
          <Input
            className="h-6 w-24 px-1.5 text-[10px]"
            value={item.tipo}
            onChange={e => onChange({ ...item, tipo: e.target.value.toUpperCase(), _calculoReversoPendente: true })}
          />
          <Input
            className="h-6 text-[10px] min-w-[80px]"
            value={item.bitola}
            onChange={e => onChange({ ...item, bitola: e.target.value.toUpperCase(), _calculoReversoPendente: true })}
          />
        </div>
        <div className="text-[9px] text-muted-foreground truncate max-w-[180px]" title={item.descricaoOriginal}>
          {item.descricaoOriginal}
        </div>

        {/* Status da especificação */}
        {isFetching && (
          <div className="flex items-center gap-1 mt-1 text-[9px] text-muted-foreground">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            Buscando na base técnica...
          </div>
        )}
        {especEncontrada && (
          <div className="flex items-center gap-1 mt-1 text-[9px] text-green-700">
            <CheckCircle2 className="w-2.5 h-2.5 flex-shrink-0" />
            {parseFloat(String(spec.pesoPorMetro)).toFixed(2)} kg/m — qtd calculada pela NF
          </div>
        )}
        {especNaoEncontrada && (
          <div className="flex items-center gap-1 mt-1 text-[9px] text-amber-600">
            <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
            Não encontrado na base técnica
          </div>
        )}
      </td>

      {/* ── Qtd / Dimensões ── */}
      <td className="p-2">
        <div className="flex items-center gap-1">
          <div className="flex flex-col">
            <span className="text-[8px] text-muted-foreground mb-0.5">QTD</span>
            <Input
              type="number"
              min={1}
              className={`h-6 w-20 px-1.5 text-[10px] font-bold ${especEncontrada ? "border-green-300 bg-green-50" : ""}`}
              placeholder="Qtd"
              value={item.quantidade || ""}
              onChange={e => onChange({ ...item, quantidade: e.target.value === "" ? 0 : (parseInt(e.target.value) || 0) })}
            />
          </div>
          <span className="text-muted-foreground text-[10px] mt-3">×</span>
          <div className="flex flex-col">
            <span className="text-[8px] text-muted-foreground mb-0.5">COMPR (mm)</span>
            <Input
              type="number"
              min={1}
              className="h-6 w-20 text-[10px]"
              placeholder="Compr"
              value={item.comprimento || ""}
              onChange={e => handleComprimentoChange(e.target.value === "" ? 0 : (parseInt(e.target.value) || 0))}
            />
          </div>
          {item.categoria === "CHAPA" && (
            <>
              <span className="text-muted-foreground text-[10px] mt-3">×</span>
              <div className="flex flex-col">
                <span className="text-[8px] text-muted-foreground mb-0.5">LARG (mm)</span>
                <Input
                  type="number"
                  className="h-6 w-16 text-[10px]"
                  placeholder="Larg"
                  value={item.largura || ""}
                  onChange={e => onChange({ ...item, largura: parseInt(e.target.value) || 0 })}
                />
              </div>
            </>
          )}
        </div>
        {especEncontrada && item.comprimento > 0 && (
          <div className="text-[9px] text-muted-foreground mt-1">
            {item.comprimento.toLocaleString("pt-BR")}mm/barra ·{" "}
            {(parseFloat(String(spec.pesoPorMetro)) * item.comprimento / 1000).toFixed(3)} kg/barra
          </div>
        )}
      </td>

      {/* ── Peso NF ── */}
      <td className="p-2">
        {item.pesoPendente ? (
          <div className="flex flex-col gap-1">
            <Input
              type="number"
              step="0.001"
              min={0}
              placeholder="Informe o peso (kg)"
              className="h-6 w-24 text-[10px] border-amber-400 bg-amber-50"
              value={item.pesoTotal || ""}
              onChange={e => onChange({ ...item, pesoTotal: parseFloat(e.target.value) || 0 })}
            />
            <div className="flex items-center gap-1 text-[9px] text-amber-700">
              <AlertCircle className="w-2.5 h-2.5 flex-shrink-0" />
              Sem especificação — informe o peso
            </div>
          </div>
        ) : (
          <>
            <div className="font-bold text-[11px]">
              {parseFloat(String(item.pesoTotal || 0)).toLocaleString("pt-BR", {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })} kg
            </div>
            {item.pesoCalculadoAuto && (
              <div className="flex items-center gap-1 text-[9px] text-blue-700 mt-0.5">
                <CheckCircle2 className="w-2.5 h-2.5 flex-shrink-0" />
                Calculado pela especificação (NF em UN/PÇ)
              </div>
            )}
            {especEncontrada && !item.pesoCalculadoAuto && item.quantidade > 0 && item.comprimento > 0 && (
              <div className="text-[9px] text-green-700 mt-0.5">
                ≈ {(parseFloat(String(spec.pesoPorMetro)) * item.comprimento / 1000 * item.quantidade).toFixed(2)} kg calc.
              </div>
            )}
          </>
        )}
      </td>

      {/* ── Cert / Corrida ── */}
      <td className="p-2 space-y-1">
        <Input
          placeholder="Cert."
          className="h-6 text-[10px]"
          value={item.numeroCertificado}
          onChange={e => onChange({ ...item, numeroCertificado: e.target.value })}
        />
        <Input
          placeholder="Corrida"
          className="h-6 text-[10px]"
          value={item.corrida}
          onChange={e => onChange({ ...item, corrida: e.target.value })}
        />
      </td>

      {/* ── Obra ── */}
      <td className="p-2">
        <select
          className="h-6 w-full text-[10px] border rounded bg-background"
          value={item.obraId || ""}
          onChange={e => onChange({ ...item, obraId: e.target.value ? parseInt(e.target.value) : undefined })}
        >
          <option value="">LIVRE</option>
          {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </td>

      {/* ── Obra de Compra (referência) ── */}
      <td className="p-2">
        <select
          className="h-6 w-full text-[10px] border rounded bg-background"
          title="Pra qual obra a compra foi destinada — só referência, não muda depois"
          value={item.obraCompraId || ""}
          onChange={e => onChange({ ...item, obraCompraId: e.target.value ? parseInt(e.target.value) : undefined })}
        >
          <option value="">Não informado</option>
          {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </td>

      {/* ── Remover ── */}
      <td className="p-2">
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onRemove}>
          <X className="w-3 h-3" />
        </Button>
      </td>
    </tr>
  );
}
