import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Search, Calendar, User, AlertCircle, Plus, Edit2, Trash2, Package, CheckCircle2, ChevronDown, ChevronUp, Layers } from "lucide-react";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface HistoricoItem {
  id: number;
  usuarioNome: string;
  acao: string;
  entidade: string;
  detalhes: string;
  dataHora: string | Date;
  materialId?: number | null;
  materialTipo?: string | null;
  materialBitola?: string | null;
}

// Agrupa entradas consecutivas que representam a MESMA operação (ex: salvar uma
// edição que muda 3 campos gera 3 linhas de histórico quase simultâneas).
// Critério: mesma ação + mesma entidade + mesmo usuário + até 5s de diferença.
const JANELA_AGRUPAMENTO_MS = 5000;

function agruparHistorico(items: HistoricoItem[]): HistoricoItem[][] {
  const grupos: HistoricoItem[][] = [];
  for (const item of items) {
    const grupoAtual = grupos[grupos.length - 1];
    if (grupoAtual) {
      const anterior = grupoAtual[grupoAtual.length - 1];
      const mesmoContexto =
        anterior.acao === item.acao &&
        anterior.entidade === item.entidade &&
        anterior.usuarioNome === item.usuarioNome;
      const diffMs = Math.abs(
        new Date(anterior.dataHora).getTime() - new Date(item.dataHora).getTime()
      );
      if (mesmoContexto && diffMs <= JANELA_AGRUPAMENTO_MS) {
        grupoAtual.push(item);
        continue;
      }
    }
    grupos.push([item]);
  }
  return grupos;
}

function getAcaoIcon(acao: string) {
  switch (acao) {
    case "CADASTRO":
      return <Plus className="w-4 h-4 text-green-600" />;
    case "EDICAO":
      return <Edit2 className="w-4 h-4 text-blue-600" />;
    case "EXCLUSAO":
      return <Trash2 className="w-4 h-4 text-red-600" />;
    case "BAIXA":
      return <Package className="w-4 h-4 text-orange-600" />;
    case "TROCA_OBRA":
      return <AlertCircle className="w-4 h-4 text-purple-600" />;
    default:
      return <CheckCircle2 className="w-4 h-4 text-gray-600" />;
  }
}

function getAcaoLabel(acao: string) {
  const labels: Record<string, string> = {
    CADASTRO: "Cadastro",
    EDICAO: "Edição",
    EXCLUSAO: "Exclusão",
    BAIXA: "Baixa",
    TROCA_OBRA: "Troca de Obra",
  };
  return labels[acao] || acao;
}

function getAcaoBgColor(acao: string) {
  switch (acao) {
    case "CADASTRO":
      return "bg-green-50 border-l-4 border-green-600";
    case "EDICAO":
      return "bg-blue-50 border-l-4 border-blue-600";
    case "EXCLUSAO":
      return "bg-red-50 border-l-4 border-red-600";
    case "BAIXA":
      return "bg-orange-50 border-l-4 border-orange-600";
    case "TROCA_OBRA":
      return "bg-purple-50 border-l-4 border-purple-600";
    default:
      return "bg-gray-50 border-l-4 border-gray-600";
  }
}

export default function Historico() {
  const { data: historicoData, isLoading } = trpc.materiais.listHistorico.useQuery();
  const [filterText, setFilterText] = useState("");
  const [filterAcao, setFilterAcao] = useState("");
  const [gruposExpandidos, setGruposExpandidos] = useState<Set<number>>(new Set());

  const historico = historicoData?.data || [];

  // ── Filtros ──────────────────────────────────────────────────────────────────
  const filteredHistorico = useMemo(() => {
    return historico.filter((item: HistoricoItem) => {
      const t = filterText.toLowerCase();
      const matchText = !t || 
        item.usuarioNome.toLowerCase().includes(t) ||
        item.detalhes.toLowerCase().includes(t) ||
        item.entidade.toLowerCase().includes(t);
      const matchAcao = !filterAcao || item.acao === filterAcao;
      return matchText && matchAcao;
    });
  }, [historico, filterText, filterAcao]);

  const gruposHistorico = useMemo(() => agruparHistorico(filteredHistorico), [filteredHistorico]);

  const toggleGrupo = (idGrupo: number) => {
    setGruposExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(idGrupo)) next.delete(idGrupo);
      else next.add(idGrupo);
      return next;
    });
  };

  const acoesUnicas = Array.from(new Set(historico.map((h: HistoricoItem) => h.acao)));

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Histórico de Atividades</h2>
            <p className="text-muted-foreground">
              Registro completo de todas as ações realizadas no sistema com data, hora e responsável.
            </p>
          </div>
        </div>

        <Card className="p-4">
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por usuário, detalhes ou entidade..."
                className="pl-10"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
            </div>
            <select
              className="px-3 py-2 border border-border rounded-md text-sm bg-background"
              value={filterAcao}
              onChange={(e) => setFilterAcao(e.target.value)}
            >
              <option value="">Todas as ações</option>
              {acoesUnicas.map((acao) => (
                <option key={acao} value={acao}>
                  {getAcaoLabel(acao)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Carregando histórico...
              </div>
            ) : filteredHistorico.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                Nenhuma atividade encontrada.
              </div>
            ) : (
              gruposHistorico.map((grupo) => {
                const principal = grupo[0];
                const idGrupo = principal.id;
                const isGrupo = grupo.length > 1;
                const expandido = gruposExpandidos.has(idGrupo);

                return (
                  <div
                    key={idGrupo}
                    className={`rounded-lg ${getAcaoBgColor(principal.acao)} transition-all hover:shadow-md overflow-hidden`}
                  >
                    <div
                      className={`p-4 flex gap-4 ${isGrupo ? "cursor-pointer" : ""}`}
                      onClick={isGrupo ? () => toggleGrupo(idGrupo) : undefined}
                    >
                      <div className="flex-shrink-0 mt-1">
                        {getAcaoIcon(principal.acao)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 mb-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-sm">
                              {getAcaoLabel(principal.acao)}
                            </span>
                            <span className="text-xs px-2 py-1 bg-white rounded-full border border-border">
                              {principal.entidade}
                            </span>
                            {principal.materialTipo && principal.materialBitola && (
                              <span className="text-xs px-2 py-1 bg-blue-50 rounded-full border border-blue-200 text-blue-700 font-medium">
                                {principal.materialTipo} {principal.materialBitola}
                              </span>
                            )}
                            {isGrupo && (
                              <span className="text-xs px-2 py-1 bg-white rounded-full border border-border flex items-center gap-1 font-medium">
                                <Layers className="w-3 h-3" /> ×{grupo.length}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="w-3 h-3" />
                              {format(new Date(principal.dataHora), "dd/MM/yyyy HH:mm:ss", { locale: ptBR })}
                            </div>
                            {isGrupo && (
                              expandido
                                ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" />
                                : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                            )}
                          </div>
                        </div>

                        {!isGrupo || !expandido ? (
                          <p className="text-sm text-foreground mb-2">
                            {isGrupo
                              ? `${grupo.length} alterações agrupadas — clique para ver todos os detalhes`
                              : principal.detalhes}
                          </p>
                        ) : null}

                        {isGrupo && expandido && (
                          <ul className="space-y-1.5 mb-2 pl-3 border-l-2 border-border">
                            {grupo.map((item) => (
                              <li key={item.id} className="text-sm text-foreground">
                                {item.detalhes}
                              </li>
                            ))}
                          </ul>
                        )}

                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="w-3 h-3" />
                          <span>Por: <strong>{principal.usuarioNome}</strong></span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {!isLoading && filteredHistorico.length > 0 && (
            <div className="mt-6 pt-4 border-t text-xs text-muted-foreground flex items-center gap-2">
              <AlertCircle className="w-3 h-3" />
              Total de {filteredHistorico.length} atividades encontradas
              {gruposHistorico.length !== filteredHistorico.length && ` (${gruposHistorico.length} agrupadas)`}.
              {historico.length > filteredHistorico.length && (
                <span>({historico.length} no total)</span>
              )}
            </div>
          )}
        </Card>
      </div>
    </StockDashboardLayout>
  );
}
