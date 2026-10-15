import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useState } from "react";
import {
  Trash2,
  ShieldAlert,
  Eye,
  CheckCircle2,
  XCircle,
  Loader2,
  TriangleAlert,
} from "lucide-react";

type TabelaLimpeza =
  | "solicitacoes"
  | "registros_saida"
  | "registros_entrada"
  | "movimentacoes"
  | "historico_atividades"
  | "materiais";

interface ConfigTabela {
  key: TabelaLimpeza;
  label: string;
  descricao: string;
  cor: string;
}

const TABELAS: ConfigTabela[] = [
  {
    key: "solicitacoes",
    label: "Solicitações de Separação",
    descricao: "Solicitações e seus itens. Inclui concluídas e canceladas.",
    cor: "bg-orange-100 border-orange-300 dark:bg-orange-950 dark:border-orange-700",
  },
  {
    key: "registros_saida",
    label: "Registros de Saída",
    descricao: "Histórico de saídas de material. Não afeta o saldo atual do estoque.",
    cor: "bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-700",
  },
  {
    key: "registros_entrada",
    label: "Registros de Entrada",
    descricao: "Retrato fixo de cada material no momento em que chegou ao estoque. Não afeta o saldo atual nem os materiais já cadastrados.",
    cor: "bg-green-100 border-green-300 dark:bg-green-950 dark:border-green-700",
  },
  {
    key: "movimentacoes",
    label: "Movimentações",
    descricao: "Log de entradas, saídas, ajustes e retornos. Não afeta saldos.",
    cor: "bg-yellow-100 border-yellow-300 dark:bg-yellow-950 dark:border-yellow-700",
  },
  {
    key: "historico_atividades",
    label: "Histórico de Atividades",
    descricao: "Log de auditoria do sistema (ações de usuários).",
    cor: "bg-blue-100 border-blue-300 dark:bg-blue-950 dark:border-blue-700",
  },
  {
    key: "materiais",
    label: "Materiais",
    descricao: "Remove permanentemente materiais cadastrados no período. Use com extremo cuidado — afeta saldos e rastreabilidade.",
    cor: "bg-red-100 border-red-300 dark:bg-red-950 dark:border-red-700",
  },
];

// Data padrão: 6 meses atrás até ontem
function defaultDe() {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
}
function defaultAte() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function Limpeza() {
  const [selecionadas, setSelecionadas] = useState<Set<TabelaLimpeza>>(new Set());
  const [de, setDe] = useState(defaultDe());
  const [ate, setAte] = useState(defaultAte());
  const [etapa, setEtapa] = useState<"config" | "preview" | "confirmar" | "resultado">("config");
  const [confirmacaoTexto, setConfirmacaoTexto] = useState("");
  const [resultado, setResultado] = useState<{ tabela: string; deletados: number }[]>([]);

  const filtros = Array.from(selecionadas).map((tabela) => ({ tabela, de, ate }));

  const previewQuery = trpc.limpeza.preview.useQuery(
    { filtros },
    { enabled: etapa === "preview" && filtros.length > 0, refetchOnWindowFocus: false }
  );

  const executarMutation = trpc.limpeza.executar.useMutation({
    onSuccess: (data) => {
      setResultado(data);
      setEtapa("resultado");
    },
  });

  const backupMutation = trpc.backup.executarAgora.useMutation();

  function toggleTabela(key: TabelaLimpeza) {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  const totalPreview = previewQuery.data?.reduce((s, r) => s + r.count, 0) ?? 0;
  const podeContinuar = selecionadas.size > 0 && de <= ate;
  const podeExecutar = confirmacaoTexto === "CONFIRMAR" && !executarMutation.isPending;

  return (
    <StockDashboardLayout>
      <div className="max-w-3xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 bg-red-100 dark:bg-red-950 rounded-lg">
            <Trash2 className="w-7 h-7 text-red-600 dark:text-red-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Limpeza de Dados</h2>
            <p className="text-muted-foreground mt-1">
              Remove registros históricos sem utilidade operacional.{" "}
              <strong className="text-foreground">Esta operação é irreversível.</strong>
            </p>
          </div>
        </div>

        {/* Backup automático — teste manual */}
        <Card className="p-6 border-2 border-blue-200 bg-blue-50/40 dark:bg-blue-950/20">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <h3 className="font-bold text-foreground">Backup Automático (Google Drive)</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Roda sozinho todo dia às 3h. Use o botão abaixo pra testar agora, sem esperar.
              </p>
            </div>
            <Button
              onClick={() => backupMutation.mutate()}
              disabled={backupMutation.isPending}
              className="gap-2 bg-blue-600 hover:bg-blue-700 shrink-0"
            >
              {backupMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {backupMutation.isPending ? "Rodando backup..." : "Testar backup agora"}
            </Button>
          </div>
          {backupMutation.data && (
            <div className={`mt-4 p-3 rounded-lg text-sm ${backupMutation.data.ok ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300"}`}>
              {backupMutation.data.ok ? (
                <>✅ Backup salvo no Drive: <strong>{backupMutation.data.arquivo}</strong> ({((backupMutation.data.tamanhoBytes ?? 0) / 1024 / 1024).toFixed(2)} MB)</>
              ) : (
                <>❌ Falhou: {backupMutation.data.erro}</>
              )}
            </div>
          )}
          {backupMutation.isError && (
            <div className="mt-4 p-3 rounded-lg text-sm bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
              ❌ Erro ao chamar o backup: {backupMutation.error.message}
            </div>
          )}
        </Card>

        {/* Aviso owner */}
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950 border border-amber-300 dark:border-amber-700 rounded-lg px-4 py-3">
          <ShieldAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Área restrita ao proprietário do sistema. Os dados deletados{" "}
            <strong>não podem ser recuperados</strong>. A operação é registrada no histórico de atividades.
          </p>
        </div>

        {/* ── ETAPA 1: Configuração ── */}
        {etapa === "config" && (
          <div className="space-y-6">

            {/* Período */}
            <Card className="p-6 border border-border space-y-4">
              <h3 className="font-semibold text-foreground">Período a limpar</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">De</label>
                  <Input
                    type="date"
                    value={de}
                    max={ate}
                    onChange={(e) => setDe(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Até</label>
                  <Input
                    type="date"
                    value={ate}
                    min={de}
                    max={defaultAte()}
                    onChange={(e) => setAte(e.target.value)}
                  />
                </div>
              </div>
              {de > ate && (
                <p className="text-xs text-red-500">
                  A data "De" não pode ser posterior à data "Até".
                </p>
              )}
            </Card>

            {/* Tabelas */}
            <Card className="p-6 border border-border space-y-4">
              <h3 className="font-semibold text-foreground">Tabelas a limpar</h3>
              <div className="space-y-3">
                {TABELAS.map((t) => {
                  const ativa = selecionadas.has(t.key);
                  return (
                    <button
                      key={t.key}
                      onClick={() => toggleTabela(t.key)}
                      className={`w-full text-left flex items-start gap-3 rounded-lg border px-4 py-3 transition-all ${
                        ativa
                          ? t.cor + " ring-1 ring-current"
                          : "border-border bg-background hover:bg-muted/50"
                      }`}
                    >
                      <div
                        className={`mt-0.5 w-4 h-4 rounded border-2 shrink-0 flex items-center justify-center transition-colors ${
                          ativa
                            ? "border-foreground bg-foreground"
                            : "border-muted-foreground"
                        }`}
                      >
                        {ativa && (
                          <svg viewBox="0 0 10 10" className="w-2.5 h-2.5 fill-background">
                            <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{t.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{t.descricao}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </Card>

            <div className="flex justify-end">
              <Button
                disabled={!podeContinuar}
                onClick={() => setEtapa("preview")}
                variant="outline"
                className="gap-2"
              >
                <Eye className="w-4 h-4" />
                Ver Preview
              </Button>
            </div>
          </div>
        )}

        {/* ── ETAPA 2: Preview ── */}
        {etapa === "preview" && (
          <div className="space-y-6">
            <Card className="p-6 border border-border space-y-4">
              <h3 className="font-semibold text-foreground">Preview — registros que serão deletados</h3>
              <p className="text-sm text-muted-foreground">
                Período: <strong>{de}</strong> até <strong>{ate}</strong>
              </p>

              {previewQuery.isLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground py-4">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Contando registros...
                </div>
              ) : previewQuery.isError ? (
                <p className="text-sm text-red-500">Erro ao consultar. Tente novamente.</p>
              ) : (
                <div className="space-y-2">
                  {previewQuery.data?.map((r) => {
                    const conf = TABELAS.find((t) => t.key === r.tabela)!;
                    return (
                      <div
                        key={r.tabela}
                        className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3"
                      >
                        <span className="text-sm font-medium text-foreground">{conf.label}</span>
                        <span
                          className={`text-sm font-bold tabular-nums ${
                            r.count > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"
                          }`}
                        >
                          {r.count.toLocaleString("pt-BR")} registro{r.count !== 1 ? "s" : ""}
                        </span>
                      </div>
                    );
                  })}

                  <div className="flex items-center justify-between rounded-lg border-2 border-border bg-background px-4 py-3 mt-2">
                    <span className="text-sm font-bold text-foreground">Total</span>
                    <span className={`text-lg font-bold tabular-nums ${totalPreview > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                      {totalPreview.toLocaleString("pt-BR")} registro{totalPreview !== 1 ? "s" : ""}
                    </span>
                  </div>
                </div>
              )}
            </Card>

            {!previewQuery.isLoading && totalPreview === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-4 py-3">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Nenhum registro encontrado no período selecionado. Nada será deletado.
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setEtapa("config")}>
                ← Voltar
              </Button>
              <Button
                disabled={previewQuery.isLoading || totalPreview === 0}
                onClick={() => setEtapa("confirmar")}
                className="gap-2 bg-red-600 hover:bg-red-700 text-white"
              >
                <TriangleAlert className="w-4 h-4" />
                Prosseguir com exclusão
              </Button>
            </div>
          </div>
        )}

        {/* ── ETAPA 3: Confirmação ── */}
        {etapa === "confirmar" && (
          <div className="space-y-6">
            <Card className="p-6 border-2 border-red-400 dark:border-red-700 bg-red-50 dark:bg-red-950 space-y-4">
              <div className="flex items-center gap-2">
                <TriangleAlert className="w-5 h-5 text-red-600 dark:text-red-400" />
                <h3 className="font-bold text-red-900 dark:text-red-100">Confirmação final</h3>
              </div>

              <p className="text-sm text-red-800 dark:text-red-200">
                Você está prestes a deletar permanentemente{" "}
                <strong>{totalPreview.toLocaleString("pt-BR")} registros</strong> do banco de dados.
                Esta ação <strong>não pode ser desfeita</strong>.
              </p>

              <div className="space-y-2">
                <label className="text-sm font-medium text-red-900 dark:text-red-100">
                  Digite <strong>CONFIRMAR</strong> para prosseguir:
                </label>
                <Input
                  value={confirmacaoTexto}
                  onChange={(e) => setConfirmacaoTexto(e.target.value)}
                  placeholder="CONFIRMAR"
                  className="border-red-300 focus:border-red-500 dark:border-red-700"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </Card>

            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => { setEtapa("preview"); setConfirmacaoTexto(""); }}>
                ← Voltar
              </Button>
              <Button
                disabled={!podeExecutar}
                onClick={() => executarMutation.mutate({ filtros, confirmacao: "CONFIRMAR" })}
                className="gap-2 bg-red-600 hover:bg-red-700 text-white disabled:opacity-50"
              >
                {executarMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Deletando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Deletar permanentemente
                  </>
                )}
              </Button>
            </div>

            {executarMutation.isError && (
              <p className="text-sm text-red-500 text-center">
                Erro ao executar a limpeza. Verifique o servidor.
              </p>
            )}
          </div>
        )}

        {/* ── ETAPA 4: Resultado ── */}
        {etapa === "resultado" && (
          <div className="space-y-6">
            <Card className="p-6 border border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950 space-y-4">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400" />
                <h3 className="font-bold text-green-900 dark:text-green-100">Limpeza concluída</h3>
              </div>

              <div className="space-y-2">
                {resultado.map((r) => {
                  const conf = TABELAS.find((t) => t.key === r.tabela);
                  return (
                    <div
                      key={r.tabela}
                      className="flex items-center justify-between rounded-lg bg-white/60 dark:bg-green-900/30 px-4 py-2"
                    >
                      <span className="text-sm text-foreground">{conf?.label ?? r.tabela}</span>
                      <span className="text-sm font-bold text-green-700 dark:text-green-300 tabular-nums">
                        {r.deletados.toLocaleString("pt-BR")} deletado{r.deletados !== 1 ? "s" : ""}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                A operação foi registrada no histórico de atividades.
              </p>
            </Card>

            <div className="flex justify-center">
              <Button
                onClick={() => {
                  setSelecionadas(new Set());
                  setDe(defaultDe());
                  setAte(defaultAte());
                  setConfirmacaoTexto("");
                  setResultado([]);
                  setEtapa("config");
                }}
                variant="outline"
                className="gap-2"
              >
                <XCircle className="w-4 h-4" />
                Nova limpeza
              </Button>
            </div>
          </div>
        )}

      </div>
    </StockDashboardLayout>
  );
}