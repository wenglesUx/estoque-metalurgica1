// /modules/separacao-producao/SeparacaoProducao.tsx
// Separação para produção: lista/consulta de requisições e a requisição aberta

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { trpc } from "@/lib/trpc";
import { ChevronRight, Loader2, Plus, Search } from "lucide-react";

import { RequisicaoDetalhe } from "./components/RequisicaoDetalhe";
import { RequisicaoForm } from "./components/RequisicaoForm";
import {
  STATUS_REQUISICAO,
  formatarDataRequisicao,
  type StatusRequisicao,
} from "./status";

// Requisição aberta por último neste navegador — volta direto pra ela
const STORAGE_ABERTA = "separacaoProducao.requisicaoAberta";

const lerAbertaSalva = (): number | null => {
  try {
    const valor = Number(localStorage.getItem(STORAGE_ABERTA));
    return valor > 0 ? valor : null;
  } catch {
    return null;
  }
};

const salvarAberta = (id: number | null) => {
  try {
    if (id) localStorage.setItem(STORAGE_ABERTA, String(id));
    else localStorage.removeItem(STORAGE_ABERTA);
  } catch {
    // sem armazenamento: só não reabre automaticamente
  }
};

type FiltroStatus = StatusRequisicao | "abertas" | "todas";

const FILTROS: { valor: FiltroStatus; label: string }[] = [
  { valor: "abertas", label: "Em andamento" },
  { valor: "aguardando_aprovacao", label: "Aguardando aprovação" },
  { valor: "aprovada", label: "Aprovadas" },
  { valor: "rejeitada", label: "Rejeitadas" },
  { valor: "cancelada", label: "Canceladas" },
  { valor: "todas", label: "Todas" },
];

const passaFiltro = (status: StatusRequisicao, filtro: FiltroStatus) =>
  filtro === "todas" ||
  (filtro === "abertas"
    ? status === "em_separacao" || status === "aguardando_aprovacao"
    : status === filtro);

interface SeparacaoProducaoProps {
  /** Abre esta requisição direto (link vindo da lista de materiais) */
  requisicaoInicial?: number | null;
}

export function SeparacaoProducao({ requisicaoInicial }: SeparacaoProducaoProps) {
  const [abertaId, setAbertaId] = useState<number | null>(
    () => requisicaoInicial ?? lerAbertaSalva()
  );
  const [novaAberta, setNovaAberta] = useState(false);
  const [filtro, setFiltro] = useState<FiltroStatus>("abertas");
  const [busca, setBusca] = useState("");

  const { data: requisicoes, isLoading } = trpc.requisicoesProducao.listar.useQuery();

  useEffect(() => {
    if (requisicaoInicial) setAbertaId(requisicaoInicial);
  }, [requisicaoInicial]);

  useEffect(() => {
    salvarAberta(abertaId);
  }, [abertaId]);

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return (requisicoes ?? []).filter((r: any) =>
      passaFiltro(r.status, filtro) &&
      (!termo ||
        r.numero.toLowerCase().includes(termo) ||
        r.obraNome.toLowerCase().includes(termo) ||
        r.etapa.toLowerCase().includes(termo) ||
        r.usuarioCriacao.toLowerCase().includes(termo))
    );
  }, [requisicoes, filtro, busca]);

  if (abertaId) {
    return <RequisicaoDetalhe id={abertaId} onVoltar={() => setAbertaId(null)} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Leia o QR code das etiquetas para separar material para produção.
          A baixa no estoque só acontece quando um ADM aprova a requisição.
        </p>
        <Button className="gap-2 shrink-0 w-full md:w-auto" onClick={() => setNovaAberta(true)}>
          <Plus className="w-4 h-4" /> Nova requisição
        </Button>
      </div>

      <Card className="p-3 sm:p-4 border border-border bg-muted/30">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por número, obra, etapa..."
              className="pl-10"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <select
            aria-label="Filtrar por situação"
            className="h-9 w-full sm:w-60 rounded-md border border-input bg-background px-2 text-sm"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value as FiltroStatus)}
          >
            {FILTROS.map((f) => (
              <option key={f.valor} value={f.valor}>
                {f.label} ({(requisicoes ?? []).filter((r: any) => passaFiltro(r.status, f.valor)).length})
              </option>
            ))}
          </select>
        </div>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 p-8 text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" /> Carregando requisições...
        </div>
      ) : filtradas.length === 0 ? (
        <div className="p-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
          Nenhuma requisição encontrada.
        </div>
      ) : (
        <div className="space-y-2">
          {filtradas.map((r: any) => {
            const status = STATUS_REQUISICAO[r.status as StatusRequisicao];

            return (
              <Card
                key={r.id}
                className="p-3 sm:p-4 cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => setAbertaId(r.id)}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 break-words">
                    <div className="flex flex-wrap items-center gap-2 font-bold text-sm">
                      Requisição {r.numero}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${status.className}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                      <span>{formatarDataRequisicao(r.dataRequisicao)}</span>
                      <span>Obra: <strong className="text-foreground">{r.obraNome}</strong></span>
                      <span>Etapa: {r.etapa}</span>
                      <span>Por {r.usuarioCriacao} em {format(new Date(r.createdAt), "dd/MM/yyyy HH:mm")}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right text-xs">
                      <div className="font-bold">{r.totalPecas} pç</div>
                      <div className="text-muted-foreground">{r.totalItens} materiais</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <RequisicaoForm
        open={novaAberta}
        onOpenChange={setNovaAberta}
        onSalvo={(id) => setAbertaId(id)}
      />
    </div>
  );
}
