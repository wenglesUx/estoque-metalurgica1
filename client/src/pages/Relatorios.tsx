import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { BarChart3, TrendingUp, Calendar, Download, FileSpreadsheet, Filter, AlertTriangle, Package, Building2, RefreshCw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import * as XLSX from "xlsx";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell } from "recharts";
import { formatWeight } from "@/lib/format";

const chartTooltip = { backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "10px", color: "#f3f4f6" };
const formatKg = (value: number) => value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

export default function Relatorios() {
  const { data: obras } = trpc.obras.list.useQuery();
  const [selectedObraId, setSelectedObraId] = useState<number | null>(null);
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [exportando, setExportando] = useState(false);

  const analyticsQuery = trpc.dashboard.analytics.useQuery({
    obraId: selectedObraId,
    dataInicio: dataInicio || null,
    dataFim: dataFim || null,
  });
  const { data: analytics, isLoading, isFetching, refetch } = analyticsQuery;

  const exportarQuery = trpc.dashboard.exportar.useQuery(
    { obraId: selectedObraId ?? null, dataInicio: dataInicio || null, dataFim: dataFim || null },
    { enabled: false }
  );

  const handleExportarExcel = async () => {
    setExportando(true);
    try {
      const result = await exportarQuery.refetch();
      const dados = result.data;
      if (!dados || dados.length === 0) {
        toast.warning("Nenhuma movimentação encontrada para os filtros selecionados.");
        return;
      }
      const linhas = dados.map((mov: any) => ({
        "Data/Hora": format(new Date(mov.dataHora), "dd/MM/yyyy HH:mm", { locale: ptBR }),
        "Tipo": mov.tipo.charAt(0).toUpperCase() + mov.tipo.slice(1),
        "Material": mov.materialDescricao,
        "Obra": mov.obraNome,
        "Quantidade (un)": parseFloat(mov.quantidade || "0"),
        "Saldo Anterior (kg)": parseFloat(mov.saldoAnterior || "0"),
        "Saldo Posterior (kg)": parseFloat(mov.saldoPosterior || "0"),
        "Referência": mov.referencia || "",
        "Observação": mov.observacao || "",
      }));
      const ws = XLSX.utils.json_to_sheet(linhas);
      ws["!cols"] = [{ wch: 18 }, { wch: 12 }, { wch: 28 }, { wch: 20 }, { wch: 16 }, { wch: 20 }, { wch: 20 }, { wch: 20 }, { wch: 40 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Movimentações");
      const resumo = [
        ["RELATÓRIO OPERACIONAL DE ESTOQUE"], [""],
        ["Gerado em:", format(new Date(), "dd/MM/yyyy HH:mm")],
        ["Obra filtrada:", selectedObraId ? obras?.find(o => o.id === selectedObraId)?.nome || "—" : "Todas"],
        ["Período:", dataInicio && dataFim ? `${dataInicio} até ${dataFim}` : "Últimos 30 dias"],
        ["Total de registros:", dados.length], [""], ["Indicadores da visão:"],
        ["Peso total do estoque (kg):", analytics?.totalKg ?? 0],
        ["Itens críticos:", analytics?.itensCriticos ?? 0],
        ["Consumo no período (kg):", analytics?.totalConsumido ?? 0],
        ["Obras com estoque alocado:", analytics?.obrasAlocadas ?? 0],
      ];
      const wsResumo = XLSX.utils.aoa_to_sheet(resumo);
      wsResumo["!cols"] = [{ wch: 34 }, { wch: 42 }];
      XLSX.utils.book_append_sheet(wb, wsResumo, "Resumo operacional");
      const obraNome = selectedObraId ? obras?.find(o => o.id === selectedObraId)?.nome?.replace(/\s+/g, "_") || "obra" : "todas_obras";
      XLSX.writeFile(wb, `relatorio_estoque_${obraNome}_${format(new Date(), "yyyyMMdd")}.xlsx`);
      toast.success(`Excel gerado com ${dados.length} movimentações.`);
    } catch {
      toast.error("Erro ao gerar o relatório Excel.");
    } finally {
      setExportando(false);
    }
  };

  const limparFiltros = () => { setSelectedObraId(null); setDataInicio(""); setDataFim(""); };
  const filtrosAtivos = Boolean(dataInicio || dataFim || selectedObraId);

  return (
    <StockDashboardLayout>
      <div className="space-y-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent"><BarChart3 className="h-4 w-4" /> Visão analítica</div>
            <h2 className="mt-2 text-3xl font-bold text-foreground">Relatórios de estoque</h2>
            <p className="mt-1 text-muted-foreground">Consumo, risco e distribuição do material por obra.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" className="gap-2" onClick={() => refetch()} disabled={isFetching}><RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Atualizar</Button>
            <PermissionGate permission="relatorios:exportar">
              <Button className="gap-2 bg-accent hover:bg-accent/90" onClick={handleExportarExcel} disabled={exportando}><Download className="h-4 w-4" /> {exportando ? "Gerando..." : "Exportar Excel"}</Button>
            </PermissionGate>
          </div>
        </div>

        <Card className="border-border/70 p-5">
          <div className="mb-4 flex items-center gap-2"><Filter className="h-4 w-4 text-muted-foreground" /><span className="text-sm font-semibold">Filtros da análise</span><span className="text-xs text-muted-foreground">Atualizam os indicadores e os gráficos</span></div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Obra<select value={selectedObraId ?? ""} onChange={(e) => setSelectedObraId(e.target.value ? Number(e.target.value) : null)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"><option value="">Todas as obras</option><option value="0">Estoque livre</option>{obras?.map(obra => <option key={obra.id} value={obra.id}>{obra.nome}</option>)}</select></label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Data início<Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} className="mt-1 text-sm" /></label>
            <label className="space-y-1 text-xs font-medium text-muted-foreground">Data fim<Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} className="mt-1 text-sm" /></label>
          </div>
          {filtrosAtivos && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs"><span className="text-muted-foreground">Filtros ativos:</span>{selectedObraId !== null && <span className="rounded-full bg-accent/10 px-2 py-1 text-accent">{selectedObraId === 0 ? "Estoque livre" : obras?.find(o => o.id === selectedObraId)?.nome}</span>}{dataInicio && <span className="rounded-full bg-muted px-2 py-1">A partir de {dataInicio}</span>}{dataFim && <span className="rounded-full bg-muted px-2 py-1">Até {dataFim}</span>}<button onClick={limparFiltros} className="ml-1 font-semibold text-red-600 hover:underline">Limpar filtros</button></div>}
        </Card>

        {isLoading ? <div className="grid grid-cols-1 gap-4 md:grid-cols-4">{[1,2,3,4].map(i => <Skeleton key={i} className="h-28 rounded-xl" />)}</div> : analytics && <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="border-border/70 p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Peso total do estoque</p><p className="mt-2 text-3xl font-bold">{formatWeight(analytics.totalKg)}</p></div><Package className="h-5 w-5 text-accent" /></div><p className="mt-3 text-xs text-muted-foreground">Saldo atual dos materiais ativos</p></Card>
          <Card className="border-border/70 p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Itens críticos</p><p className="mt-2 text-3xl font-bold text-red-600">{analytics.itensCriticos}</p></div><AlertTriangle className="h-5 w-5 text-red-500" /></div><p className="mt-3 text-xs text-muted-foreground">Abaixo do estoque mínimo</p></Card>
          <Card className="border-border/70 p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Consumo no período</p><p className="mt-2 text-3xl font-bold">{formatWeight(analytics.totalConsumido)}</p></div><TrendingUp className="h-5 w-5 text-accent" /></div><p className="mt-3 text-xs text-muted-foreground">Média de {formatKg(analytics.mediaDiaria)} kg por dia com movimento</p></Card>
          <Card className="border-border/70 p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Obras com estoque alocado</p><p className="mt-2 text-3xl font-bold">{analytics.obrasAlocadas}</p></div><Building2 className="h-5 w-5 text-accent" /></div><p className="mt-3 text-xs text-muted-foreground">Materiais vinculados a projetos ativos</p></Card>
        </div>}

        {isLoading ? <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">{[1,2].map(i => <Skeleton key={i} className="h-96 rounded-xl" />)}</div> : analytics && <>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="border-border/70 p-5"><div className="mb-4"><h3 className="font-semibold">Evolução do consumo</h3><p className="text-xs text-muted-foreground">Peso de saídas registradas no período selecionado</p></div>{analytics.consumoDiario.length ? <ResponsiveContainer width="100%" height={310}><LineChart data={analytics.consumoDiario}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="data" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={chartTooltip} formatter={(v: number) => [`${formatKg(v)} kg`, "Consumo"]} /><Line type="monotone" dataKey="peso" stroke="#d6a21b" strokeWidth={3} dot={false} activeDot={{ r: 6 }} /></LineChart></ResponsiveContainer> : <div className="flex h-[310px] items-center justify-center text-sm text-muted-foreground">Sem movimentações no período selecionado.</div>}</Card>
            <Card className="border-border/70 p-5"><div className="mb-4"><h3 className="font-semibold">Estoque atual versus ponto mínimo</h3><p className="text-xs text-muted-foreground">Materiais mais próximos ou abaixo da meta</p></div>{analytics.estoqueVsMinimo.length ? <ResponsiveContainer width="100%" height={310}><BarChart data={analytics.estoqueVsMinimo} layout="vertical" margin={{ left: 12, right: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="material" width={105} tick={{ fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} formatter={(v: number) => [`${formatKg(v)} kg`, ""]} /><Legend /><Bar dataKey="atual" name="Atual (kg)" fill="#374151" radius={[0,4,4,0]} /><Bar dataKey="minimo" name="Mínimo (kg)" fill="#d6a21b" radius={[0,4,4,0]} /></BarChart></ResponsiveContainer> : <div className="flex h-[310px] items-center justify-center text-sm text-muted-foreground">Nenhum material encontrado.</div>}</Card>
          </div>
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <Card className="border-border/70 p-5"><div className="mb-4"><h3 className="font-semibold">Livre versus alocado por obra</h3><p className="text-xs text-muted-foreground">Distribuição do saldo atual em quilogramas</p></div>{analytics.alocacaoPorObra.length ? <ResponsiveContainer width="100%" height={300}><BarChart data={analytics.alocacaoPorObra} margin={{ left: 6, right: 10 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis dataKey="obra" tick={{ fontSize: 10 }} interval={0} angle={-18} textAnchor="end" height={62} /><YAxis tick={{ fontSize: 11 }} /><Tooltip contentStyle={chartTooltip} formatter={(v: number) => [`${formatKg(v)} kg`, ""]} /><Legend /><Bar dataKey="livre" name="Livre" stackId="saldo" fill="#94a3b8" /><Bar dataKey="alocado" name="Alocado" stackId="saldo" fill="#d6a21b" radius={[4,4,0,0]} /></BarChart></ResponsiveContainer> : <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">Nenhum saldo para distribuir.</div>}</Card>
            <Card className="border-border/70 p-5"><div className="mb-4"><h3 className="font-semibold">Consumo por obra</h3><p className="text-xs text-muted-foreground">Ranking de saídas no período selecionado</p></div>{analytics.consumoPorObra.length ? <ResponsiveContainer width="100%" height={300}><BarChart data={analytics.consumoPorObra.slice(0,8)} layout="vertical" margin={{ left: 12, right: 20 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" /><XAxis type="number" tick={{ fontSize: 11 }} /><YAxis type="category" dataKey="obra" width={105} tick={{ fontSize: 10 }} /><Tooltip contentStyle={chartTooltip} formatter={(v: number) => [`${formatKg(v)} kg`, "Consumo"]} /><Bar dataKey="peso" name="Consumo (kg)" fill="#d6a21b" radius={[0,4,4,0]} /></BarChart></ResponsiveContainer> : <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">Sem consumo por obra no período.</div>}</Card>
          </div>
          <Card className="border-border/70 p-5"><div className="mb-4 flex items-center justify-between"><div><h3 className="font-semibold">Estoque crítico</h3><p className="text-xs text-muted-foreground">Itens priorizados pelo maior déficit em relação ao mínimo</p></div><AlertTriangle className="h-5 w-5 text-red-500" /></div>{analytics.alertas.length ? <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="pb-3 pr-4">Material</th><th className="pb-3 pr-4">Obra</th><th className="pb-3 pr-4">Atual</th><th className="pb-3 pr-4">Mínimo</th><th className="pb-3">Déficit</th></tr></thead><tbody>{analytics.alertas.map((item: any) => <tr key={item.id} className="border-b border-border/60 last:border-0"><td className="py-3 pr-4 font-medium">{item.descricao}</td><td className="py-3 pr-4 text-muted-foreground">{item.obraNome}</td><td className="py-3 pr-4">{formatKg(item.atual)} kg</td><td className="py-3 pr-4">{formatKg(item.minimo)} kg</td><td className="py-3 font-semibold text-red-600">-{formatKg(item.deficit)} kg</td></tr>)}</tbody></table></div> : <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/60 p-6 text-center text-sm text-emerald-700">Nenhum material abaixo do estoque mínimo.</div>}</Card>
        </>}
      </div>
    </StockDashboardLayout>
  );
}
