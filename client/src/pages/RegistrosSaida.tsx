import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PermissionGate } from "@/components/PermissionGate";
import { trpc } from "@/lib/trpc";
import { FileText, Calendar, ChevronDown, FlaskConical, Undo2 } from "lucide-react";
import { Fragment, useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import { FiltroMaterialBar } from "@/components/FiltroMaterialBar";
import { useFiltroMaterial } from "@/hooks/useFiltroMaterial";

export default function RegistrosSaida() {
  const { data: registros, isLoading } = trpc.materiais.listRegistrosSaida.useQuery();
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const utils = trpc.useUtils();
  const marcarExclusao = trpc.dashboard.marcarExclusaoRelatorio.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(variables.excluir ? "Registro marcado como teste — não vai mais contar no dashboard e relatórios." : "Registro voltou a contar no dashboard e relatórios.");
      utils.materiais.listRegistrosSaida.invalidate();
    },
    onError: () => toast.error("Não foi possível atualizar esse registro."),
  });

  const { filtro, setFiltro, resetFiltro, filtrados: filteredRegistros, temFiltroAtivo } =
    useFiltroMaterial(registros ?? []);

  const tiposUnicos = useMemo(() =>
    Array.from(new Set((registros || []).map(r => r.tipo?.toUpperCase()).filter(Boolean))).sort() as string[],
    [registros]);

  const obrasUnicas = useMemo(() =>
    Array.from(new Set((registros || []).filter(r => r.obraNome).map(r => r.obraNome!))).sort(),
    [registros]);

  const fornecedoresUnicos = useMemo(() =>
    Array.from(new Set((registros || []).filter(r => r.fornecedor).map(r => r.fornecedor!))).sort(),
    [registros]);

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Registros de Saída</h2>
            <p className="text-muted-foreground">
              Histórico detalhado de todos os materiais que saíram do estoque via baixa em lote.
            </p>
          </div>
        </div>

        <Card className="p-4">
          <div className="mb-6">
            <FiltroMaterialBar
              filtro={filtro}
              setFiltro={setFiltro}
              resetFiltro={resetFiltro}
              temFiltroAtivo={temFiltroAtivo}
              totalFiltrado={filteredRegistros.length}
              totalGeral={registros?.length ?? 0}
              tiposDisponiveis={tiposUnicos}
              obrasDisponiveis={obrasUnicas}
              fornecedoresDisponiveis={fornecedoresUnicos}
              campos={["tipo", "aco", "obra", "fornecedor", "comprimento"]}
            />
          </div>

          <div className="rounded-md border overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground font-medium border-b">
                <tr>
                  <th className="px-4 py-3 w-8"></th>
                  <th className="px-4 py-3">Data Saída</th>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Qtd</th>
                  <th className="px-4 py-3">Peso Total (kg)</th>
                  <th className="px-4 py-3">Obra</th>
                  <th className="px-4 py-3">Local</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Carregando registros...
                    </td>
                  </tr>
                ) : filteredRegistros.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhum registro de saída encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredRegistros.map((reg) => {
                    const aberto = expandidoId === reg.id;
                    return (
                      <Fragment key={reg.id}>
                        <tr
                          onClick={() => setExpandidoId(aberto ? null : reg.id)}
                          className="hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3">
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3 h-3 text-muted-foreground" />
                              {format(new Date(reg.dataSaida), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {reg.tipo} {reg.bitola}
                            <span className="text-muted-foreground font-normal"> — {reg.aco}</span>
                          </td>
                          <td className="px-4 py-3">{reg.quantidade}</td>
                          <td className="px-4 py-3">{reg.pesoTotal}</td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${reg.obraNome === "CONSUMO NÃO ALOCADO" ? "bg-amber-100 text-amber-800" : "bg-secondary"}`}>
                                {reg.obraNome || "LIVRE"}
                              </span>
                              {(reg as any).excluirRelatorios && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                                  <FlaskConical className="w-2.5 h-2.5" /> Fora dos relatórios
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{reg.local}</td>
                        </tr>
                        {aberto && (
                          <tr className="bg-muted/20">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Comprimento</div>
                                  <div className="text-sm font-medium mt-0.5">{reg.comprimento} mm</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">NF</div>
                                  <div className="text-sm font-medium mt-0.5">{reg.nf || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Corrida</div>
                                  <div className="text-sm font-medium mt-0.5">{reg.corrida || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Nº Pedido</div>
                                  <div className="text-sm font-medium mt-0.5">{(reg as any).numeroPedido || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Nº Requisição</div>
                                  <div className="text-sm font-medium mt-0.5">{(reg as any).numeroRequisicao || "-"}</div>
                                </div>
                                <div className="col-span-2 sm:col-span-4">
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Motivo</div>
                                  <div className="text-sm font-medium mt-0.5">{(reg as any).motivo || "-"}</div>
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-3">
                                {(reg as any).materialId && (
                                  <a href={`/linha-do-tempo/${(reg as any).materialId}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900">
                                    <FileText className="w-3.5 h-3.5" /> Ver linha do tempo desse material
                                  </a>
                                )}
                                <PermissionGate permission="materiais:editar">
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={`h-7 gap-1.5 text-xs ${(reg as any).excluirRelatorios ? "text-emerald-700 border-emerald-300 hover:bg-emerald-50" : "text-red-700 border-red-200 hover:bg-red-50"}`}
                                    disabled={marcarExclusao.isPending}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      marcarExclusao.mutate({ tipo: "saida", id: reg.id, excluir: !(reg as any).excluirRelatorios });
                                    }}
                                  >
                                    {(reg as any).excluirRelatorios
                                      ? <><Undo2 className="w-3.5 h-3.5" /> Voltar a contar nos relatórios</>
                                      : <><FlaskConical className="w-3.5 h-3.5" /> Marcar como teste (excluir dos relatórios)</>}
                                  </Button>
                                </PermissionGate>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          
          {!isLoading && filteredRegistros.length > 0 && (
            <div className="mt-4 text-xs text-muted-foreground flex items-center gap-2">
              <FileText className="w-3 h-3" />
              Total de {filteredRegistros.length} registros de saída encontrados.
            </div>
          )}
        </Card>
      </div>
    </StockDashboardLayout>
  );
}