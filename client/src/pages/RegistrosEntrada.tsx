import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { FileText, Calendar, ChevronDown } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FiltroMaterialBar } from "@/components/FiltroMaterialBar";
import { useFiltroMaterial } from "@/hooks/useFiltroMaterial";

export default function RegistrosEntrada() {
  const { data: registros, isLoading } = trpc.registrosEntrada.listar.useQuery();
  const [expandidoId, setExpandidoId] = useState<number | null>(null);

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
            <h2 className="text-2xl font-bold tracking-tight">Registros de Entrada</h2>
            <p className="text-muted-foreground">
              Retrato fixo de cada material no momento em que chegou ao estoque — não muda
              mesmo que o material seja editado ou baixado depois. Complementa o Histórico,
              que mostra a atividade geral do sistema.
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
                  <th className="px-4 py-3">Data Entrada</th>
                  <th className="px-4 py-3">Material</th>
                  <th className="px-4 py-3">Qtd</th>
                  <th className="px-4 py-3">Peso Total (kg)</th>
                  <th className="px-4 py-3">Obra / Destino</th>
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
                      Nenhum registro de entrada encontrado.
                    </td>
                  </tr>
                ) : (
                  filteredRegistros.map((reg: any) => {
                    const aberto = expandidoId === reg.id;
                    return (
                      <Fragment key={reg.id}>
                        <tr
                          key={reg.id}
                          onClick={() => setExpandidoId(aberto ? null : reg.id)}
                          className="hover:bg-muted/30 transition-colors cursor-pointer"
                        >
                          <td className="px-4 py-3">
                            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <Calendar className="w-3 h-3 text-muted-foreground" />
                              {format(new Date(reg.dataEntrada), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-medium">
                            {reg.tipo} {reg.bitola}
                            <span className="text-muted-foreground font-normal"> — {reg.aco}</span>
                          </td>
                          <td className="px-4 py-3">{reg.quantidade}</td>
                          <td className="px-4 py-3">{reg.pesoTotal}</td>
                          <td className="px-4 py-3">
                            <span className="px-2 py-0.5 rounded-full bg-secondary text-[10px] font-semibold uppercase">
                              {reg.obraNome || "LIVRE"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">{reg.local}</td>
                        </tr>
                        {aberto && (
                          <tr key={`${reg.id}-detalhe`} className="bg-muted/20">
                            <td colSpan={7} className="px-4 py-4">
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Comprimento</div>
                                  <div className="text-sm font-medium mt-0.5">
                                    {reg.categoria === "CHAPA"
                                      ? `${(reg.largura || 0).toLocaleString("pt-BR")}×${(reg.comprimento || 0).toLocaleString("pt-BR")} mm`
                                      : `${(reg.comprimento || 0).toLocaleString("pt-BR")} mm`}
                                  </div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Fornecedor</div>
                                  <div className="text-sm font-medium mt-0.5">{reg.fornecedor || "-"}</div>
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
                                  <div className="text-sm font-medium mt-0.5">{reg.numeroPedido || "-"}</div>
                                </div>
                                <div>
                                  <div className="text-[10px] font-bold uppercase text-muted-foreground">Cadastrado por</div>
                                  <div className="text-sm font-medium mt-0.5">{reg.usuarioNome || "-"}</div>
                                </div>
                              </div>
                              {reg.materialId && (
                                <a href={`/linha-do-tempo/${reg.materialId}`} className="inline-flex items-center gap-1.5 mt-3 text-xs font-semibold text-blue-700 hover:text-blue-900">
                                  <FileText className="w-3.5 h-3.5" /> Ver linha do tempo desse material
                                </a>
                              )}
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
              Total de {filteredRegistros.length} registros de entrada encontrados.
            </div>
          )}
        </Card>
      </div>
    </StockDashboardLayout>
  );
}
