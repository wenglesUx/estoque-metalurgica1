import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Search, Calendar, FileText, Download, ChevronDown, CheckCircle2 } from "lucide-react";
import { useMemo, useState } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { toast } from "sonner";

export default function RelatorioDivergencia() {
  const { data: divergencias, isLoading, refetch } = trpc.inventarios.listarDivergenciasNegativas.useQuery();
  const justificarMutation = trpc.inventarios.justificarDivergencia.useMutation();
  const [busca, setBusca] = useState("");
  const [gerandoPdf, setGerandoPdf] = useState(false);
  const [semanasFechadas, setSemanasFechadas] = useState<Set<string>>(new Set());
  const [justificandoId, setJustificandoId] = useState<number | null>(null);
  const [textoJustificativa, setTextoJustificativa] = useState("");

  const handleSalvarJustificativa = async (itemId: number) => {
    if (!textoJustificativa.trim()) { toast.error("Escreva a justificativa antes de salvar."); return; }
    try {
      await justificarMutation.mutateAsync({ itemInventarioId: itemId, justificativa: textoJustificativa.trim() });
      toast.success("Justificativa registrada.");
      setJustificandoId(null);
      setTextoJustificativa("");
      refetch();
    } catch {
      toast.error("Erro ao salvar a justificativa.");
    }
  };

  const filtradas = useMemo(() => {
    if (!divergencias) return [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return divergencias;
    return divergencias.filter((d: any) =>
      d.material?.tipo?.toLowerCase().includes(termo) ||
      d.material?.bitola?.toLowerCase().includes(termo) ||
      d.material?.obraNome?.toLowerCase().includes(termo) ||
      d.inventarioNumero?.toLowerCase().includes(termo) ||
      d.observacoes?.toLowerCase().includes(termo)
    );
  }, [divergencias, busca]);

  const calcDeficitKg = (itens: any[]) => {
    return itens.reduce((sum: number, d: any) => {
      const mat = d.material;
      const qtdAtual = mat?.quantidade || 1;
      const pesoAtual = parseFloat(String(mat?.pesoTotal || "0"));
      const pesoPorUnidade = qtdAtual > 0 ? pesoAtual / qtdAtual : 0;
      const divergenciaAbs = Math.abs(parseFloat(String(d.divergencia)));
      return sum + divergenciaAbs * pesoPorUnidade;
    }, 0);
  };

  const totalDeficitKg = useMemo(() => calcDeficitKg(filtradas), [filtradas]);

  const semMotivo = filtradas.filter((d: any) => !d.observacoes || !d.observacoes.trim()).length;
  const itensJustificados = useMemo(() => filtradas.filter((d: any) => d.justificativa && d.justificativa.trim()), [filtradas]);
  const pesoJustificadoKg = useMemo(() => calcDeficitKg(itensJustificados), [itensJustificados]);

  // Agrupamento por semana (segunda a domingo) — a conferência é feita
  // semanalmente, então o histórico faz mais sentido organizado assim,
  // com um resumo por semana antes dos detalhes.
  const gruposPorSemana = useMemo(() => {
    const grupos = new Map<string, { inicio: Date; fim: Date; itens: any[] }>();
    filtradas.forEach((d: any) => {
      const dataRef = d.inventarioData ? new Date(d.inventarioData) : new Date();
      const inicio = startOfWeek(dataRef, { weekStartsOn: 1 });
      const fim = endOfWeek(dataRef, { weekStartsOn: 1 });
      const chave = inicio.toISOString();
      if (!grupos.has(chave)) grupos.set(chave, { inicio, fim, itens: [] });
      grupos.get(chave)!.itens.push(d);
    });
    return Array.from(grupos.entries())
      .map(([chave, dados]) => ({ chave, ...dados }))
      .sort((a, b) => b.inicio.getTime() - a.inicio.getTime());
  }, [filtradas]);

  const toggleSemana = (chave: string) => {
    setSemanasFechadas(prev => {
      const novo = new Set(prev);
      novo.has(chave) ? novo.delete(chave) : novo.add(chave);
      return novo;
    });
  };

  const gerarPdf = async () => {
    setGerandoPdf(true);
    try {
      const graphite: [number, number, number] = [26, 35, 50];
      const gold: [number, number, number] = [214, 162, 27];
      const warm: [number, number, number] = [248, 246, 241];
      const line: [number, number, number] = [220, 225, 229];
      const muted: [number, number, number] = [98, 111, 124];
      const red: [number, number, number] = [185, 45, 45];
      const redSoft: [number, number, number] = [253, 235, 235];
      const amber: [number, number, number] = [156, 103, 14];
      const amberSoft: [number, number, number] = [255, 248, 226];

      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const W = doc.internal.pageSize.getWidth();
      const H = doc.internal.pageSize.getHeight();
      const margin = 14;

      const logoData = await (async (): Promise<string | null> => {
        try {
          const response = await fetch("/brand/hcm-industrial.svg");
          if (!response.ok) return null;
          const svgText = await response.text();
          const blobUrl = URL.createObjectURL(new Blob([svgText], { type: "image/svg+xml" }));
          const image = await new Promise<HTMLImageElement>((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = blobUrl;
          });
          const canvas = document.createElement("canvas");
          canvas.width = 300; canvas.height = 170;
          const context = canvas.getContext("2d");
          if (!context) return null;
          context.drawImage(image, 0, 0, canvas.width, canvas.height);
          URL.revokeObjectURL(blobUrl);
          return canvas.toDataURL("image/png");
        } catch { return null; }
      })();

      // Cabeçalho institucional.
      doc.setFillColor(...warm);
      doc.rect(0, 0, W, 32, "F");
      doc.setFillColor(...red);
      doc.rect(0, 0, W, 2, "F");
      if (logoData) doc.addImage(logoData, "PNG", margin, 7, 22, 13);
      doc.setTextColor(...red);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text("CONTROLE DE MATERIAIS", margin + 27, 11);
      doc.setTextColor(...graphite);
      doc.setFontSize(15);
      doc.text("Relatório de Divergência de Estoque", margin + 27, 19);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("Materiais que faltaram numa contagem física — acompanhamento semanal de consumo", margin + 27, 25);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text("EMITIDO EM", W - margin, 11, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...graphite);
      doc.text(format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR }), W - margin, 17, { align: "right" });

      // Cards de resumo — visual, números grandes, fácil de bater o olho.
      const cardY = 40;
      const cardW = (W - margin * 2 - 8) / 3;
      const cards: [string, string, string, [number, number, number], [number, number, number]][] = [
        ["Divergências encontradas", String(filtradas.length), "itens com falta no estoque", graphite, warm],
        ["Déficit total (peso)", `${totalDeficitKg.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`, "peso que sumiu do sistema", red, redSoft],
        ["Sem motivo explicado", String(semMotivo), semMotivo > 0 ? "precisam de investigação" : "tudo documentado", amber, amberSoft],
      ];
      cards.forEach(([label, valor, nota, corTexto, corFundo], idx) => {
        const x = margin + idx * (cardW + 4);
        doc.setFillColor(...corFundo);
        doc.roundedRect(x, cardY, cardW, 22, 2.5, 2.5, "F");
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(6.5);
        doc.text(label.toUpperCase(), x + 5, cardY + 7);
        doc.setTextColor(...corTexto);
        doc.setFontSize(15);
        doc.text(valor, x + 5, cardY + 15);
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text(nota, x + 5, cardY + 19.5);
      });

      // Uma seção por semana — cabeçalho com o intervalo de datas + resumo,
      // seguido da tabela detalhada só daquela semana.
      let cursorY = cardY + 32;
      const footerComPaginacao = () => {
        const pageNum = (doc as any).internal.getCurrentPageInfo().pageNumber;
        doc.setDrawColor(...line);
        doc.line(margin, H - 12, W - margin, H - 12);
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text("HCM Industrial · Controle de Estoque", margin, H - 6);
        doc.text(`Página ${pageNum}`, W - margin, H - 6, { align: "right" });
      };

      gruposPorSemana.forEach((semana, idx) => {
        if (cursorY > H - 45) { doc.addPage(); cursorY = 20; }
        const deficitSemana = calcDeficitKg(semana.itens);
        const semMotivoSemana = semana.itens.filter((d: any) => !d.observacoes || !d.observacoes.trim()).length;

        doc.setFillColor(...graphite);
        doc.rect(margin, cursorY, W - margin * 2, 8, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text(
          `SEMANA DE ${format(semana.inicio, "dd/MM", { locale: ptBR })} A ${format(semana.fim, "dd/MM/yyyy", { locale: ptBR })}`,
          margin + 3, cursorY + 5.5
        );
        const resumoTexto = `${semana.itens.length} ${semana.itens.length === 1 ? "divergência" : "divergências"} · ${deficitSemana.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg${semMotivoSemana > 0 ? ` · ${semMotivoSemana} sem motivo` : ""}`;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(resumoTexto, W - margin - 3, cursorY + 5.5, { align: "right" });
        cursorY += 11;

        autoTable(doc, {
          startY: cursorY,
          head: [["Inventário", "Material", "Obra / Local", "Sistema", "Contado", "Déficit", "Motivo", "Justificativa"]],
          body: semana.itens.map((d: any) => [
            `#${d.inventarioNumero}${d.inventarioData ? `\n${format(new Date(d.inventarioData), "dd/MM/yy")}` : ""}`,
            `${d.material?.tipo} ${d.material?.bitola}\n${d.material?.aco || ""}`,
            `${d.material?.obraNome || "LIVRE"}\n${d.material?.local || ""}`,
            parseFloat(String(d.quantidadeSistema)).toFixed(0),
            parseFloat(String(d.quantidadeContada)).toFixed(0),
            parseFloat(String(d.divergencia)).toFixed(0),
            d.observacoes || "⚠ Sem motivo informado",
            d.justificativa ? `✓ ${d.justificativa}` : "—",
          ]),
          styles: { fontSize: 7.5, cellPadding: 2.2, lineColor: line, lineWidth: 0.2, textColor: graphite, valign: "middle" },
          headStyles: { fillColor: [90, 98, 110], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
          alternateRowStyles: { fillColor: [250, 251, 252] },
          columnStyles: {
            3: { halign: "center", cellWidth: 18 },
            4: { halign: "center", cellWidth: 18 },
            5: { halign: "center", cellWidth: 18, fontStyle: "bold", textColor: red },
            6: { cellWidth: 55 },
            7: { cellWidth: 55 },
          },
          margin: { left: margin, right: margin, bottom: 16 },
          didParseCell: (data) => {
            if (data.column.index === 6 && data.cell.raw === "⚠ Sem motivo informado") {
              data.cell.styles.textColor = amber;
              data.cell.styles.fontStyle = "bold";
            }
            if (data.column.index === 7 && typeof data.cell.raw === "string" && data.cell.raw.startsWith("✓")) {
              data.cell.styles.textColor = [22, 130, 60];
              data.cell.styles.fontStyle = "bold";
            }
          },
          didDrawPage: footerComPaginacao,
        });

        cursorY = (doc as any).lastAutoTable.finalY + 8;
      });

      doc.save(`relatorio_divergencia_${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("Relatório de divergência gerado!");
    } catch {
      toast.error("Erro ao gerar o PDF.");
    } finally {
      setGerandoPdf(false);
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <AlertTriangle className="w-6 h-6 text-red-600" /> Relatório de Divergência
            </h2>
            <p className="text-muted-foreground">
              Materiais que faltaram numa contagem de inventário — o que sumiu do estoque sem
              baixa registrada. Use pra acompanhar consumo semanal e conferência com requisições.
            </p>
          </div>
          <Button onClick={gerarPdf} disabled={gerandoPdf || filtradas.length === 0} className="gap-2 bg-red-600 hover:bg-red-700 shrink-0">
            <Download className="w-4 h-4" /> {gerandoPdf ? "Gerando..." : "Baixar PDF"}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-xs font-bold uppercase text-muted-foreground">Divergências encontradas</div>
            <div className="text-2xl font-bold mt-1">{filtradas.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-bold uppercase text-muted-foreground">Déficit total (peso)</div>
            <div className="text-2xl font-bold mt-1 text-red-600">{totalDeficitKg.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-bold uppercase text-muted-foreground">Sem motivo explicado</div>
            <div className={`text-2xl font-bold mt-1 ${semMotivo > 0 ? "text-amber-600" : "text-green-600"}`}>{semMotivo}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs font-bold uppercase text-muted-foreground">Peso Justificado</div>
            <div className="text-2xl font-bold mt-1 text-green-600">{pesoJustificadoKg.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{itensJustificados.length} {itensJustificados.length === 1 ? "item explicado" : "itens explicados"}</div>
          </Card>
        </div>

        <Card className="p-4">
          <div className="relative max-w-sm mb-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por material, obra, inventário..."
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="rounded-md border px-4 py-8 text-center text-muted-foreground">Carregando...</div>
          ) : gruposPorSemana.length === 0 ? (
            <div className="rounded-md border px-4 py-8 text-center text-muted-foreground">Nenhuma divergência negativa encontrada.</div>
          ) : (
            <div className="space-y-4">
              {gruposPorSemana.map((semana) => {
                const fechada = semanasFechadas.has(semana.chave);
                const deficitSemana = calcDeficitKg(semana.itens);
                const semMotivoSemana = semana.itens.filter((d: any) => !d.observacoes || !d.observacoes.trim()).length;
                return (
                  <div key={semana.chave} className="rounded-lg border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => toggleSemana(semana.chave)}
                      className="w-full flex items-center justify-between gap-3 px-4 py-3 bg-muted/40 hover:bg-muted/60 transition-colors text-left"
                    >
                      <div className="flex items-center gap-2">
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${fechada ? "-rotate-90" : ""}`} />
                        <div>
                          <div className="font-bold text-sm">
                            Semana de {format(semana.inicio, "dd/MM", { locale: ptBR })} a {format(semana.fim, "dd/MM/yyyy", { locale: ptBR })}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {semana.itens.length} {semana.itens.length === 1 ? "divergência" : "divergências"} · {deficitSemana.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg de déficit
                            {semMotivoSemana > 0 && <span className="text-amber-700 font-semibold"> · {semMotivoSemana} sem motivo</span>}
                          </div>
                        </div>
                      </div>
                    </button>
                    {!fechada && (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left">
                          <thead className="bg-muted/20 text-muted-foreground font-medium border-b border-t">
                            <tr>
                              <th className="px-4 py-2">Inventário</th>
                              <th className="px-4 py-2">Material</th>
                              <th className="px-4 py-2">Obra / Local</th>
                              <th className="px-4 py-2 text-right">Sistema</th>
                              <th className="px-4 py-2 text-right">Contado</th>
                              <th className="px-4 py-2 text-right">Déficit</th>
                              <th className="px-4 py-2">Motivo</th>
                              <th className="px-4 py-2">Justificativa</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y">
                            {semana.itens.map((d: any) => (
                              <tr key={d.id} className="hover:bg-muted/30 transition-colors align-top">
                                <td className="px-4 py-3 whitespace-nowrap">
                                  <div className="font-medium">#{d.inventarioNumero}</div>
                                  {d.inventarioData && (
                                    <div className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                      <Calendar className="w-2.5 h-2.5" /> {format(new Date(d.inventarioData), "dd/MM/yyyy", { locale: ptBR })}
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-3 font-medium">
                                  {d.material?.tipo} {d.material?.bitola}
                                  <div className="text-xs text-muted-foreground font-normal">{d.material?.aco}</div>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {d.material?.obraNome || "LIVRE"}
                                  <div className="text-xs">{d.material?.local}</div>
                                </td>
                                <td className="px-4 py-3 text-right font-mono">{parseFloat(String(d.quantidadeSistema)).toFixed(0)}</td>
                                <td className="px-4 py-3 text-right font-mono">{parseFloat(String(d.quantidadeContada)).toFixed(0)}</td>
                                <td className="px-4 py-3 text-right font-mono font-bold text-red-600">{parseFloat(String(d.divergencia)).toFixed(0)}</td>
                                <td className="px-4 py-3 max-w-[280px]">
                                  {d.observacoes ? (
                                    <span className="text-foreground">{d.observacoes}</span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-amber-700 text-xs font-semibold">
                                      <AlertTriangle className="w-3 h-3" /> Sem motivo informado
                                    </span>
                                  )}
                                </td>
                                <td className="px-4 py-3 max-w-[280px]">
                                  {d.justificativa ? (
                                    <div>
                                      <span className="inline-flex items-center gap-1 text-green-700 text-[10px] font-bold uppercase mb-1">
                                        <CheckCircle2 className="w-3 h-3" /> Justificado
                                      </span>
                                      <p className="text-foreground">{d.justificativa}</p>
                                      <p className="text-[10px] text-muted-foreground mt-0.5">
                                        {d.justificadoPor} {d.justificadoEm && `· ${format(new Date(d.justificadoEm), "dd/MM/yyyy", { locale: ptBR })}`}
                                      </p>
                                    </div>
                                  ) : justificandoId === d.id ? (
                                    <div className="space-y-1.5">
                                      <textarea
                                        autoFocus
                                        className="w-full min-h-[60px] px-2 py-1.5 rounded-md border border-green-300 bg-white text-xs resize-y"
                                        placeholder="Pra onde esse material foi..."
                                        value={textoJustificativa}
                                        onChange={(e) => setTextoJustificativa(e.target.value)}
                                      />
                                      <div className="flex gap-1.5">
                                        <Button size="sm" className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700" disabled={justificarMutation.isPending} onClick={() => handleSalvarJustificativa(d.id)}>
                                          {justificarMutation.isPending ? "Salvando..." : "Salvar"}
                                        </Button>
                                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => { setJustificandoId(null); setTextoJustificativa(""); }}>Cancelar</Button>
                                      </div>
                                    </div>
                                  ) : (
                                    <PermissionGate permission="inventario:processar">
                                      <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 border-green-300 text-green-700 hover:bg-green-50" onClick={() => { setJustificandoId(d.id); setTextoJustificativa(""); }}>
                                        <CheckCircle2 className="w-3 h-3" /> Justificar
                                      </Button>
                                    </PermissionGate>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {!isLoading && filtradas.length > 0 && (
            <div className="mt-4 text-xs text-muted-foreground flex items-center gap-2">
              <FileText className="w-3 h-3" />
              Total de {filtradas.length} divergências em {gruposPorSemana.length} {gruposPorSemana.length === 1 ? "semana" : "semanas"}.
            </div>
          )}
        </Card>
      </div>
    </StockDashboardLayout>
  );
}
