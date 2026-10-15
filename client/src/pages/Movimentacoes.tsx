import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { Download, Lock } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FiltroMaterialBar } from "@/components/FiltroMaterialBar";
import { useFiltroMaterial } from "@/hooks/useFiltroMaterial";

const tipoLabels: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  retorno_sobra: "Retorno de Sobra",
  ajuste: "Ajuste",
};

const tipoColors: Record<string, string> = {
  entrada: "bg-green-100 text-green-800",
  saida: "bg-red-100 text-red-800",
  retorno_sobra: "bg-blue-100 text-blue-800",
  ajuste: "bg-yellow-100 text-yellow-800",
};

export default function Movimentacoes() {
  const { data: movimentacoes, isLoading } = trpc.movimentacoes.list.useQuery();
  const { filtro, setFiltro, resetFiltro, filtrados: filtered, temFiltroAtivo } =
    useFiltroMaterial(movimentacoes ?? []);

  const tiposMovUnicos = useMemo(() =>
    Array.from(new Set((movimentacoes as any[] || []).map((m: any) => m.tipo).filter(Boolean))).sort() as string[],
    [movimentacoes]);

  const handleExportCSV = () => {
    try {
      const rows = [
        ["Data/Hora", "Tipo", "Material", "Comprimento (mm)", "Obra", "Qtd/Saldo (kg)", "Saldo Anterior (kg)", "Saldo Posterior (kg)", "Referência", "Observação"],
        ...filtered.map((m: any) => [
          format(new Date(m.dataHora), "dd/MM/yyyy HH:mm", { locale: ptBR }),
          tipoLabels[m.tipo] || m.tipo,
          m.materialDescricao || "",
          m.materialComprimento ?? "",
          m.obraNome || "",
          m.quantidade,
          m.saldoAnterior,
          m.saldoPosterior,
          m.referenciaType ? `${m.referenciaType} #${m.referenciaId}` : "",
          m.observacao || "",
        ]),
      ]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
        .join("\n");

      const blob = new Blob(["\uFEFF" + rows], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `movimentacoes_${format(new Date(), "yyyy-MM-dd")}.csv`;
      link.click();
      toast.success("Movimentações exportadas!");
    } catch {
      toast.error("Erro ao exportar.");
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Movimentações</h2>
            <p className="text-muted-foreground mt-1 flex items-center gap-2">
              <Lock className="w-4 h-4" />
              Histórico imutável de todas as operações de estoque
            </p>
          </div>
          <Button onClick={handleExportCSV} className="gap-2 self-start md:self-auto">
            <Download className="w-4 h-4" />
            Exportar CSV
          </Button>
        </div>

        {/* Filtros */}
        <Card className="p-4 border border-border">
          <FiltroMaterialBar
            filtro={filtro}
            setFiltro={setFiltro}
            resetFiltro={resetFiltro}
            temFiltroAtivo={temFiltroAtivo}
            totalFiltrado={filtered.length}
            totalGeral={(movimentacoes as any[])?.length ?? 0}
            tiposDisponiveis={tiposMovUnicos}
            campos={["tipo", "obra", "fornecedor", "comprimento"]}
          />
        </Card>

        {/* Tabela */}
        {isLoading ? (
          <Card className="p-12 text-center border border-border">
            <p className="text-muted-foreground">Carregando movimentações...</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="p-12 text-center border border-border">
            <p className="text-muted-foreground">Nenhuma movimentação encontrada.</p>
          </Card>
        ) : (
          <Card className="border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Data/Hora</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Tipo</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Material</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Obra</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase">Saldo Ant. (kg)</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase">Saldo Post. (kg)</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Referência</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map((mov: any) => {
                    const saldoAnt = parseFloat(mov.saldoAnterior ?? "0");
                    const saldoPost = parseFloat(mov.saldoPosterior ?? "0");
                    const delta = saldoPost - saldoAnt;
                    return (
                      <tr key={mov.id} className="hover:bg-muted/40 transition-colors">
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap font-mono">
                          {format(new Date(mov.dataHora), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tipoColors[mov.tipo] ?? "bg-gray-100 text-gray-700"}`}>
                            {tipoLabels[mov.tipo] ?? mov.tipo}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium text-foreground">{mov.materialDescricao || "—"}</div>
                          {mov.materialComprimento && (
                            <div className="text-xs text-muted-foreground">
                              {mov.materialComprimento.toLocaleString("pt-BR")} mm
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">
                          {mov.obraNome || "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm text-muted-foreground">
                          {saldoAnt.toFixed(3)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-medium">
                          <span className={delta >= 0 ? "text-green-600" : "text-red-600"}>
                            {saldoPost.toFixed(3)}
                          </span>
                          <div className="text-xs font-normal text-muted-foreground">
                            {delta >= 0 ? "+" : ""}{delta.toFixed(3)}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground font-mono">
                          {mov.referenciaType ? `${mov.referenciaType} #${mov.referenciaId}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate" title={mov.observacao ?? ""}>
                          {mov.observacao || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Rodapé informativo */}
        <Card className="p-4 border border-border bg-muted/40">
          <div className="flex gap-3 items-start">
            <Lock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              Todas as movimentações são registradas permanentemente e não podem ser editadas ou excluídas, garantindo a integridade e rastreabilidade completa do estoque.
            </p>
          </div>
        </Card>

      </div>
    </StockDashboardLayout>
  );
}