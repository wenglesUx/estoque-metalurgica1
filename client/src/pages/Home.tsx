import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  CheckCircle2,
  CircleAlert,
  Download,
  Layers3,
  PackageCheck,
  Plus,
  RefreshCw,
  Warehouse,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useLocation } from "wouter";
import { formatWeight } from "@/lib/format";

type PeriodoDashboard = "30" | "90" | "all";

type AnalyticsRow = {
  id?: number;
  material?: string;
  obra?: string;
  obraNome?: string;
  atual?: number;
  minimo?: number;
  deficit?: number;
  livre?: number;
  alocado?: number;
  total?: number;
  peso?: number;
  data?: string;
  descricao?: string;
  tipo?: string;
  bitola?: string;
  aco?: string | null;
};

function asNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value: unknown, maximumFractionDigits = 0): string {
  return asNumber(value).toLocaleString("pt-BR", { maximumFractionDigits });
}

function formatKg(value: unknown): string {
  return `${formatNumber(value, 0)} kg`;
}

function formatDateLabel(value: unknown): string {
  if (!value) return "";
  const date = new Date(`${String(value)}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }).replace(".", "");
}

function formatChartValue(value: unknown): string {
  const number = asNumber(value);
  if (number >= 1000) return `${(number / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}k`;
  return formatNumber(number, 0);
}

function materialLabel(item: AnalyticsRow): string {
  if (item.descricao) return item.descricao;
  return `${item.tipo ?? "Material"} ${item.bitola ?? ""}`.trim();
}

export default function Home() {
  const [obraIdFiltro, setObraIdFiltro] = useState<number | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoDashboard>("30");
  const [, navigate] = useLocation();

  const dataInicio = useMemo(() => {
    if (periodo === "all") return null;
    const date = new Date();
    date.setDate(date.getDate() - Number(periodo));
    return date.toISOString().slice(0, 10);
  }, [periodo]);

  const { data: obras, refetch: refetchObras } = trpc.obras.list.useQuery();
  const {
    data: analytics,
    isLoading: isLoadingAnalytics,
    isFetching: isFetchingAnalytics,
    refetch: refetchAnalytics,
  } = trpc.dashboard.analytics.useQuery(
    { obraId: obraIdFiltro, dataInicio, dataFim: null },
    { keepPreviousData: true, refetchInterval: 30_000 }
  );

  const obrasAtivas = obras?.filter((obra: any) => obra.status === "ativa") ?? [];
  const estoqueVsMinimo = (analytics?.estoqueVsMinimo ?? []) as AnalyticsRow[];
  const alocacaoPorObra = (analytics?.alocacaoPorObra ?? []) as AnalyticsRow[];
  const alertas = (analytics?.alertas ?? []) as AnalyticsRow[];
  const consumoDiario = (analytics?.consumoDiario ?? []) as AnalyticsRow[];
  const totalKg = asNumber(analytics?.totalKg);
  const totalConsumido = asNumber(analytics?.totalConsumido);
  const consumoShare = totalKg > 0 ? Math.round((totalConsumido / totalKg) * 100) : 0;

  const consumoChartData = useMemo(
    () => consumoDiario.map((item) => ({ ...item, media: asNumber(analytics?.mediaDiaria) })),
    [analytics?.mediaDiaria, consumoDiario]
  );

  const dataFimHoje = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const { data: gastoPorPeriodo, isLoading: isLoadingGasto } = trpc.dashboard.gastoMaterialPorPeriodo.useQuery(
    { dataInicio: dataInicio ?? "2020-01-01", dataFim: dataFimHoje, agrupamento: "dia", obraId: obraIdFiltro },
    { keepPreviousData: true }
  );
  const totalGastoPeriodo = useMemo(
    () => (gastoPorPeriodo || []).reduce((soma, item) => soma + item.valorGasto, 0),
    [gastoPorPeriodo]
  );
  const totalPesoSemValorPeriodo = useMemo(
    () => (gastoPorPeriodo || []).reduce((soma, item) => soma + item.pesoSemValor, 0),
    [gastoPorPeriodo]
  );

  const alocacaoVisivel = alocacaoPorObra.filter((item) => asNumber(item.total) > 0).slice(0, 6);
  const maxAlocacao = Math.max(...alocacaoVisivel.map((item) => asNumber(item.total)), 1);
  const materiaisCriticos = alertas.slice(0, 5);

  const atualizarDashboard = async () => {
    await Promise.all([refetchAnalytics(), refetchObras()]);
  };

  const irParaMaterial = (id?: number) => {
    if (id) navigate(`/materiais?highlight=${id}`);
    else navigate("/materiais");
  };

  return (
    <StockDashboardLayout>
      <div className="dashboard-page">
        <section className="dashboard-hero">
          <div className="dashboard-heading">
            <div className="dashboard-eyebrow"><span /> Visão operacional</div>
            <h2 className="dashboard-title">Dashboard<span>de estoque</span></h2>
            <p className="dashboard-subtitle">
              Uma leitura rápida do que está disponível, do que está sendo consumido e do que precisa de atenção.
            </p>
            <div className="dashboard-filters">
              <div className="dashboard-select-wrap">
                <Building2 className="h-4 w-4" aria-hidden="true" />
                <Select
                  value={obraIdFiltro === null ? "todas" : String(obraIdFiltro)}
                  onValueChange={(value) => setObraIdFiltro(value === "todas" ? null : Number(value))}
                >
                  <SelectTrigger className="dash-select-trigger">
                    <SelectValue placeholder="Todas as obras" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas as obras</SelectItem>
                    <SelectItem value="0">Livre (sem obra)</SelectItem>
                    {obrasAtivas.map((obra: any) => (
                      <SelectItem key={obra.id} value={String(obra.id)}>{obra.nome}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="dash-period" aria-label="Período dos gráficos">
                {(["30", "90", "all"] as PeriodoDashboard[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={periodo === value ? "active" : ""}
                    onClick={() => setPeriodo(value)}
                  >
                    {value === "all" ? "Todo período" : `${value} dias`}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="dashboard-actions">
            <button type="button" className="dash-button dash-button-secondary" onClick={atualizarDashboard} disabled={isFetchingAnalytics}>
              <RefreshCw className={`h-4 w-4 ${isFetchingAnalytics ? "animate-spin" : ""}`} />
              Atualizar
            </button>
            <button type="button" className="dash-button dash-button-primary" onClick={() => navigate("/relatorios")}>
              <Download className="h-4 w-4" />
              Exportar visão
            </button>
          </div>
        </section>

        <div className="dashboard-status-note">
          <Activity className="h-4 w-4" />
          Dados reais do estoque e das movimentações, atualizados automaticamente a cada 30 segundos.
        </div>

        <section className="dash-kpis" aria-label="Indicadores operacionais">
          <article className="dash-kpi">
            <span className="dash-kpi-label">Peso total do estoque</span>
            {isLoadingAnalytics ? <Skeleton className="mt-3 h-9 w-28" /> : <strong className="dash-kpi-value">{formatWeight(totalKg)}</strong>}
            <span className="dash-kpi-meta"><PackageCheck className="h-3.5 w-3.5 text-emerald-600" /> Saldo atual dos materiais ativos</span>
            <span className="kpi-mark"><Layers3 className="h-4 w-4" /></span>
          </article>
          <article className="dash-kpi">
            <span className="dash-kpi-label">Itens críticos</span>
            {isLoadingAnalytics ? <Skeleton className="mt-3 h-9 w-16" /> : <strong className="dash-kpi-value">{formatNumber(analytics?.itensCriticos)}</strong>}
            <span className="dash-kpi-meta"><CircleAlert className="h-3.5 w-3.5 text-red-600" /> Ação necessária abaixo do mínimo</span>
            <span className="kpi-mark kpi-mark-risk"><AlertTriangle className="h-4 w-4" /></span>
          </article>
          <article className="dash-kpi">
            <span className="dash-kpi-label">Consumo no período</span>
            {isLoadingAnalytics ? <Skeleton className="mt-3 h-9 w-28" /> : <strong className="dash-kpi-value">{formatWeight(totalConsumido)}</strong>}
            <span className="dash-kpi-meta"><ArrowDownRight className="h-3.5 w-3.5 text-amber-600" /> {consumoShare}% do estoque movimentado</span>
            <span className="kpi-mark"><ArrowDownRight className="h-4 w-4" /></span>
          </article>
          <article className="dash-kpi">
            <span className="dash-kpi-label">Obras com estoque alocado</span>
            {isLoadingAnalytics ? <Skeleton className="mt-3 h-9 w-16" /> : <strong className="dash-kpi-value">{formatNumber(analytics?.obrasAlocadas)}</strong>}
            <span className="dash-kpi-meta"><Building2 className="h-3.5 w-3.5 text-emerald-600" /> Projetos ativos com materiais</span>
            <span className="kpi-mark"><Warehouse className="h-4 w-4" /></span>
          </article>
        </section>

        <section className="dash-grid">
          <article className="dash-card">
            <div className="dash-card-head">
              <div><h3>Evolução do consumo</h3><p>Consumo diário e média do período selecionado</p></div>
              <div className="chart-legend"><span><i className="legend-dot gold" />Consumo</span><span><i className="legend-dot ink" />Média</span></div>
            </div>
            {isLoadingAnalytics ? <Skeleton className="h-[250px] w-full" /> : consumoChartData.length > 0 ? (
              <div className="chart-wrap">
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={consumoChartData} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#e9e9e2" />
                    <XAxis dataKey="data" tickFormatter={formatDateLabel} tick={{ fontSize: 10, fill: "#9a9d94" }} axisLine={false} tickLine={false} />
                    <YAxis tickFormatter={formatChartValue} tick={{ fontSize: 10, fill: "#9a9d94" }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip formatter={(value: unknown, name: string) => [formatKg(value), name]} labelFormatter={formatDateLabel} />
                    <Line type="monotone" dataKey="peso" name="Consumo" stroke="#d6a21b" strokeWidth={3} dot={{ r: 3, fill: "#fff", stroke: "#d6a21b", strokeWidth: 2 }} activeDot={{ r: 5 }} />
                    <Line type="monotone" dataKey="media" name="Média" stroke="#2b2d27" strokeWidth={2.5} strokeDasharray="6 6" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : <div className="dash-empty h-[250px]">Sem movimentações no período selecionado.</div>}
          </article>

          <article className="dash-card">
            <div className="dash-card-head">
              <div><h3>Gasto de material por período</h3><p>Baseado no valor unitário (R$/kg) cadastrado em Especificações</p></div>
              <div className="chart-legend"><span><i className="legend-dot gold" />Valor (R$)</span></div>
            </div>
            {isLoadingGasto ? <Skeleton className="h-[250px] w-full" /> : (gastoPorPeriodo && gastoPorPeriodo.length > 0) ? (
              <>
                <div className="chart-wrap">
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={gastoPorPeriodo} margin={{ top: 8, right: 10, left: -16, bottom: 0 }}>
                      <CartesianGrid vertical={false} stroke="#e9e9e2" />
                      <XAxis dataKey="periodo" tick={{ fontSize: 10, fill: "#9a9d94" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => `R$ ${Number(v).toLocaleString("pt-BR")}`} tick={{ fontSize: 10, fill: "#9a9d94" }} axisLine={false} tickLine={false} width={64} />
                      <Tooltip formatter={(value: unknown) => [`R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`, "Valor gasto"]} />
                      <Bar dataKey="valorGasto" name="Valor gasto" fill="#d6a21b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 mt-2 px-1">
                  <span className="text-xs text-muted-foreground">
                    Total no período: <strong className="text-foreground">R$ {totalGastoPeriodo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}</strong>
                  </span>
                  {totalPesoSemValorPeriodo > 0 && (
                    <span className="text-[11px] text-amber-700">
                      +{totalPesoSemValorPeriodo.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg consumidos sem valor unitário cadastrado (não entram nesse total)
                    </span>
                  )}
                </div>
              </>
            ) : <div className="dash-empty h-[250px]">Sem valor unitário cadastrado nas especificações ainda — cadastre em Especificações pra ver esse gráfico.</div>}
          </article>

          <article className="dash-card">
            <div className="dash-card-head">
              <div><h3>Estoque versus ponto mínimo</h3><p>Os itens mais próximos da ruptura aparecem primeiro</p></div>
              <div className="chart-legend"><span><i className="legend-dot green" />Saudável</span><span><i className="legend-dot gold" />Atenção</span><span><i className="legend-dot red" />Risco</span></div>
            </div>
            {isLoadingAnalytics ? <Skeleton className="h-[250px] w-full" /> : estoqueVsMinimo.length > 0 ? (
              <div className="threshold-list">
                {estoqueVsMinimo.slice(0, 6).map((item) => {
                  const atual = asNumber(item.atual);
                  const minimo = asNumber(item.minimo);
                  const max = Math.max(atual, minimo, 1);
                  const atualWidth = Math.min(100, (atual / max) * 100);
                  const minimoPosition = Math.min(100, (minimo / max) * 100);
                  const status = atual < minimo * 0.6 ? "risk" : atual < minimo ? "attention" : "healthy";
                  return (
                    <div className="threshold-row" key={item.id ?? item.material}>
                      <span className="threshold-label" title={item.material}>{item.material}</span>
                      <div className="threshold-track"><span className={`threshold-fill ${status}`} style={{ width: `${atualWidth}%` }} /><span className="threshold-min" style={{ left: `${minimoPosition}%` }} /></div>
                      <span className="threshold-values"><strong>{formatNumber(atual)}</strong> / {formatNumber(minimo)} kg</span>
                    </div>
                  );
                })}
                <div className="dash-footnote"><span className="threshold-marker-inline" /> marcador indica o estoque mínimo configurado.</div>
              </div>
            ) : <div className="dash-empty h-[250px]">Nenhum material encontrado para os filtros atuais.</div>}
          </article>
        </section>

        <section className="dash-grid equal">
          <article className="dash-card">
            <div className="dash-card-head">
              <div><h3>Livre versus alocado por obra</h3><p>Onde o peso do estoque está vinculado hoje</p></div>
              <div className="chart-legend"><span><i className="legend-dot green" />Livre</span><span><i className="legend-dot gold" />Alocado</span></div>
            </div>
            {alocacaoVisivel.length > 0 ? (
              <div className="stack-list">
                {alocacaoVisivel.map((item) => {
                  const livre = asNumber(item.livre);
                  const alocado = asNumber(item.alocado);
                  const total = Math.max(asNumber(item.total), 1);
                  return (
                    <div className="stack-row" key={item.obra}>
                      <div className="stack-head"><span>{item.obra}</span><span>{formatKg(item.total)}</span></div>
                      <div className="stack-track"><span className="stack-available" style={{ width: `${(livre / total) * 100}%` }} /><span className="stack-consumed" style={{ width: `${(alocado / total) * 100}%` }} /></div>
                    </div>
                  );
                })}
              </div>
            ) : <div className="dash-empty">Sem estoque alocado para exibir.</div>}
            <div className="stack-legend"><span><i className="legend-dot green" />Sem obra vinculada</span><span><i className="legend-dot gold" />Alocado em obra</span></div>
          </article>

          <article className="dash-card">
            <div className="dash-card-head"><div><h3>Estoque crítico</h3><p>Itens abaixo do estoque mínimo</p></div><span className="dash-tag dash-tag-gold">{formatNumber(analytics?.itensCriticos)} itens</span></div>
            {materiaisCriticos.length > 0 ? (
              <div className="risk-list">
                {materiaisCriticos.map((item) => {
                  const deficit = asNumber(item.deficit || Math.max(0, asNumber(item.minimo) - asNumber(item.atual)));
                  return (
                    <button type="button" className="risk-item" key={item.id ?? item.descricao} onClick={() => irParaMaterial(item.id)}>
                      <span className="risk-icon"><AlertTriangle className="h-3.5 w-3.5" /></span>
                      <span><span className="risk-name">{materialLabel(item)}</span><span className="risk-sub">{item.aco || "Aço não informado"} · {item.obraNome || "Materiais livres"}</span></span>
                      <span className="risk-number">−{formatKg(deficit)}</span>
                    </button>
                  );
                })}
                <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => navigate("/materiais")}>Ver todos os itens críticos <ArrowUpRight className="ml-1 h-4 w-4" /></Button>
              </div>
            ) : <div className="dash-empty">Nenhum item abaixo do estoque mínimo.</div>}
          </article>
        </section>

        <section className="dash-card">
          <div className="dash-card-head"><div><h3>Atenção operacional</h3><p>Alertas que podem exigir uma ação da equipe</p></div><button type="button" className="dash-button dash-button-ghost" onClick={() => navigate("/relatorios")}>Abrir relatórios <ArrowUpRight className="h-3.5 w-3.5" /></button></div>
          {alertas.length > 0 ? (
            <div className="alert-table-wrap">
              <table className="alert-table"><thead><tr><th>Material</th><th>Saldo atual</th><th>Mínimo</th><th /></tr></thead><tbody>
                {alertas.slice(0, 5).map((item) => (
                  <tr key={item.id ?? item.descricao}><td><strong>{materialLabel(item)}</strong><small>{item.obraNome || "Materiais livres"}</small></td><td>{formatKg(item.atual)}</td><td>{formatKg(item.minimo)}</td><td><button type="button" className="alert-action" onClick={() => irParaMaterial(item.id)}>Ver material <ArrowUpRight className="h-3 w-3" /></button></td></tr>
                ))}
              </tbody></table>
            </div>
          ) : <div className="dash-empty">Nenhum alerta operacional no momento.</div>}
        </section>

        <section className="dash-card dashboard-quick-actions">
          <div className="quick-actions-heading"><div><span className="dash-card-kicker">Atalhos</span><h3>Ações rápidas</h3></div><p>Operações mais utilizadas</p></div>
          <div className="quick-actions-grid">
            <button type="button" className="quick-action" onClick={() => navigate("/materiais")}><Plus className="h-4 w-4" /> Registrar material <ArrowUpRight className="ml-auto h-3.5 w-3.5" /></button>
            <button type="button" className="quick-action" onClick={() => navigate("/obras")}><Building2 className="h-4 w-4" /> Nova obra <ArrowUpRight className="ml-auto h-3.5 w-3.5" /></button>
            <button type="button" className="quick-action" onClick={() => navigate("/ajuste")}><BarChart3 className="h-4 w-4" /> Ajuste de estoque <ArrowUpRight className="ml-auto h-3.5 w-3.5" /></button>
          </div>
        </section>
      </div>
    </StockDashboardLayout>
  );
}
