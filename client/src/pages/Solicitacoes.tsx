import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { 
  ArrowRightLeft, CheckCircle2, Clock, MessageSquare, 
  FileText, ChevronDown, ChevronUp, Send, Download, Search,
  Image as ImageIcon, X, Upload, Loader2, StickyNote
} from "lucide-react";
import { useState, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeparacaoProducao } from "@/modules/separacao-producao/SeparacaoProducao";
import { toast } from "sonner";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// Comprime uma imagem no navegador antes do upload — reduz uma foto de
// celular de alguns MB pra poucas centenas de KB (redimensiona pro maior
// lado ficar em até 1600px e recomprime como JPEG 80%), sem perda visual
// perceptível pra documentação de separação.
const comprimirImagem = (file: File): Promise<{ base64: string; tipo: string }> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const MAX_LADO = 1600;
        let { width, height } = img;
        if (width > MAX_LADO || height > MAX_LADO) {
          const escala = MAX_LADO / Math.max(width, height);
          width = Math.round(width * escala);
          height = Math.round(height * escala);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas indisponível")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
        resolve({ base64: dataUrl.split(",")[1] || "", tipo: "image/jpeg" });
      };
      img.onerror = reject;
      img.src = ev.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

export default function Solicitacoes() {
  const { data: solicitacoes, isLoading, refetch } = trpc.solicitacoes.list.useQuery();
  const responderMutation = trpc.solicitacoes.responder.useMutation();
  const concluirMutation = trpc.solicitacoes.concluir.useMutation();
  const salvarObsMutation = trpc.solicitacoes.atualizarObservacoesSeparacao.useMutation();
  const uploadImagemMutation = trpc.solicitacoes.uploadImagem.useMutation();
  const deletarImagemMutation = trpc.solicitacoes.deletarImagem.useMutation();
  const utils = trpc.useUtils();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [resposta, setResposta] = useState("");
  const [filterText, setFilterText] = useState("");
  const [obsSeparacao, setObsSeparacao] = useState("");
  const [enviandoImagens, setEnviandoImagens] = useState(false);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  // ?aba=producao&req=12 — link da lista de materiais pra uma requisição de produção
  const parametrosUrl = useMemo(() => new URLSearchParams(window.location.search), []);
  const requisicaoDaUrl = Number(parametrosUrl.get("req")) || null;
  const [aba, setAba] = useState(
    parametrosUrl.get("aba") === "producao" || requisicaoDaUrl ? "producao" : "solicitacoes"
  );

  const { data: requisicoesProducao } = trpc.requisicoesProducao.listar.useQuery(undefined, { retry: false });
  const aguardandoAprovacao = (requisicoesProducao ?? []).filter((r: any) => r.status === "aguardando_aprovacao").length;

  const { data: imagensDaSolicitacao, refetch: refetchImagens } = trpc.solicitacoes.listarImagens.useQuery(
    { solicitacaoId: expandedId ?? 0 },
    { enabled: !!expandedId }
  );

  const filteredSolicitacoes = useMemo(() => {
    if (!solicitacoes) return [];
    return solicitacoes.filter(s => {
      const search = filterText.toLowerCase();
      return s.usuarioSolicitante.toLowerCase().includes(search) ||
             (s.observacaoSolicitante || "").toLowerCase().includes(search) ||
             s.id.toString().includes(search);
    });
  }, [solicitacoes, filterText]);

  const handleResponder = async (id: number) => {
    if (!resposta.trim()) return;
    try {
      await responderMutation.mutateAsync({ id, observacaoResposta: resposta });
      toast.success("Resposta enviada!");
      setResposta("");
      refetch();
    } catch {
      toast.error("Erro ao enviar resposta.");
    }
  };

  const handleConcluir = async (id: number) => {
    try {
      await concluirMutation.mutateAsync({ id });
      toast.success("Separação concluída!");
      refetch();
    } catch {
      toast.error("Erro ao concluir separação.");
    }
  };

  const handleSalvarObservacoes = async (id: number) => {
    try {
      await salvarObsMutation.mutateAsync({ id, observacoesSeparacao: obsSeparacao });
      toast.success("Observações salvas!");
      refetch();
    } catch {
      toast.error("Erro ao salvar observações.");
    }
  };

  const handleUploadImagens = async (id: number, files: FileList | null) => {
    if (!files || files.length === 0) return;
    setEnviandoImagens(true);
    try {
      for (const file of Array.from(files)) {
        const { base64, tipo } = await comprimirImagem(file);
        await uploadImagemMutation.mutateAsync({
          solicitacaoId: id,
          nomeArquivo: file.name,
          tipoArquivo: tipo,
          conteudoBase64: base64,
        });
      }
      toast.success(`${files.length} ${files.length === 1 ? "foto enviada" : "fotos enviadas"}!`);
      refetchImagens();
      refetch();
    } catch {
      toast.error("Erro ao enviar foto(s).");
    } finally {
      setEnviandoImagens(false);
    }
  };

  const handleDeletarImagem = async (imagemId: number) => {
    try {
      await deletarImagemMutation.mutateAsync({ id: imagemId });
      toast.success("Foto removida.");
      refetchImagens();
      refetch();
    } catch {
      toast.error("Erro ao remover foto.");
    }
  };

  const exportarPDF = async (solicitacao: any) => {
    setGerandoPdf(true);
    try {
      const graphite: [number, number, number] = [26, 35, 50];
      const gold: [number, number, number] = [214, 162, 27];
      const warm: [number, number, number] = [248, 246, 241];
      const line: [number, number, number] = [220, 225, 229];
      const muted: [number, number, number] = [98, 111, 124];

      const doc = new jsPDF();
      const W = doc.internal.pageSize.getWidth();
      const margin = 14;

      // Carrega a mesma logo usada nos outros documentos (login/sidebar/relatório/GRD).
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
      doc.rect(0, 0, W, 30, "F");
      doc.setFillColor(...gold);
      doc.rect(0, 0, W, 2, "F");
      if (logoData) {
        doc.addImage(logoData, "PNG", margin, 6, 20, 12);
      }
      doc.setTextColor(...gold);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text("CONTROLE DE MATERIAIS", margin + 26, 10);
      doc.setTextColor(...graphite);
      doc.setFontSize(14);
      doc.text("Solicitação de Separação de Material", margin + 26, 17);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("Documento de acompanhamento e conferência", margin + 26, 23);
      doc.setTextColor(...muted);
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.text("Nº DA SOLICITAÇÃO", W - margin, 10, { align: "right" });
      doc.setTextColor(...graphite);
      doc.setFontSize(11);
      doc.text(`#${String(solicitacao.id).padStart(5, "0")}`, W - margin, 17, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text(format(new Date(solicitacao.dataSolicitacao), "dd/MM/yyyy HH:mm"), W - margin, 23, { align: "right" });

      // Referências.
      let y = 40;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...graphite);
      doc.text("REFERÊNCIAS", margin, y);
      doc.setDrawColor(...line);
      doc.line(margin + 22, y - 1.2, W - margin, y - 1.2);
      y += 6;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const refs = [
        ["Solicitante", solicitacao.usuarioSolicitante],
        ["Obra destino", solicitacao.obraDestino?.nome || "Não informada"],
        ["Status", solicitacao.status.toUpperCase()],
        ["Data limite", solicitacao.dataLimite ? format(new Date(solicitacao.dataLimite), "dd/MM/yyyy") : "-"],
      ];
      refs.forEach(([label, value], idx) => {
        const colX = margin + (idx % 2) * ((W - margin * 2) / 2);
        const rowY = y + Math.floor(idx / 2) * 7;
        doc.setTextColor(...muted);
        doc.setFontSize(7);
        doc.text(`${label}:`, colX, rowY);
        doc.setTextColor(...graphite);
        doc.setFontSize(9);
        doc.text(String(value), colX + 26, rowY);
      });
      y += 18;

      // Tabela de itens.
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...graphite);
      doc.text("MATERIAIS SOLICITADOS", margin, y);
      doc.line(margin + 42, y - 1.2, W - margin, y - 1.2);
      autoTable(doc, {
        startY: y + 4,
        head: [["Tipo", "Bitola", "Aço", "Obra", "Qtd. Solicitada"]],
        body: solicitacao.itens.map((it: any) => [
          it.material.tipo, it.material.bitola, it.material.aco || "-",
          it.material.obraNome || "LIVRE", String(it.quantidadeSolicitada),
        ]),
        styles: { fontSize: 8, cellPadding: 2, lineColor: line, lineWidth: 0.2, textColor: graphite },
        headStyles: { fillColor: graphite, textColor: [255, 255, 255], fontStyle: "bold" },
        alternateRowStyles: { fillColor: [250, 251, 252] },
        margin: { left: margin, right: margin },
      });

      let finalY = (doc as any).lastAutoTable.finalY + 10;

      // Observações — três blocos distintos, cada um com sua origem.
      const blocos = [
        { titulo: "OBSERVAÇÃO DO SOLICITANTE", texto: solicitacao.observacaoSolicitante },
        { titulo: "RESPOSTA DO ALMOXARIFADO", texto: solicitacao.observacaoResposta },
        { titulo: "OBSERVAÇÕES DA SEPARAÇÃO", texto: solicitacao.observacoesSeparacao },
      ].filter(b => b.texto && b.texto.trim());

      for (const bloco of blocos) {
        if (finalY > 260) { doc.addPage(); finalY = 20; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...graphite);
        doc.text(bloco.titulo, margin, finalY);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...graphite);
        const linhas = doc.splitTextToSize(bloco.texto, W - margin * 2);
        doc.text(linhas, margin, finalY + 5);
        finalY += 5 + linhas.length * 4.5 + 6;
      }

      // Fotos anexadas — busca o conteúdo de cada uma e embuti em grade.
      const imagens = await utils.client.solicitacoes.listarImagens.query({ solicitacaoId: solicitacao.id });
      if (imagens && imagens.length > 0) {
        if (finalY > 240) { doc.addPage(); finalY = 20; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...graphite);
        doc.text(`FOTOS DA SEPARAÇÃO (${imagens.length})`, margin, finalY);
        finalY += 5;

        const colWidth = (W - margin * 2 - 8) / 3;
        const rowHeight = colWidth * 0.75;
        let col = 0;
        for (const imgMeta of imagens) {
          const full = await utils.client.solicitacoes.obterImagem.query({ id: imgMeta.id });
          if (!full) continue;
          if (col === 3) { col = 0; finalY += rowHeight + 4; }
          if (finalY + rowHeight > 280) { doc.addPage(); finalY = 20; col = 0; }
          const x = margin + col * (colWidth + 4);
          try {
            doc.addImage(`data:${full.tipoArquivo};base64,${full.conteudoBase64}`, "JPEG", x, finalY, colWidth, rowHeight);
          } catch { /* formato inesperado — pula essa imagem */ }
          col++;
        }
        finalY += rowHeight + 10;
      }

      // Rodapé de assinatura.
      if (finalY > 265) { doc.addPage(); finalY = 30; }
      doc.setDrawColor(...graphite);
      doc.line(margin, finalY + 15, margin + 75, finalY + 15);
      doc.setFontSize(8);
      doc.setTextColor(...graphite);
      doc.text("Responsável pelo almoxarifado", margin, finalY + 20);

      doc.save(`solicitacao_${String(solicitacao.id).padStart(5, "0")}.pdf`);
      toast.success("PDF gerado com sucesso!");
    } catch (error) {
      toast.error("Erro ao gerar PDF");
    } finally {
      setGerandoPdf(false);
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Central de Solicitações</h2>
            <p className="text-muted-foreground mt-1">Administre os pedidos de separação de materiais.</p>
          </div>
        </div>

        <Tabs value={aba} onValueChange={setAba} className="gap-6">
          <TabsList className="w-full sm:w-fit">
            <TabsTrigger value="solicitacoes">Para envio</TabsTrigger>
            <TabsTrigger value="producao" className="gap-2">
              Para produção
              {aguardandoAprovacao > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {aguardandoAprovacao}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="producao">
            <SeparacaoProducao requisicaoInicial={requisicaoDaUrl} />
          </TabsContent>

          <TabsContent value="solicitacoes" className="space-y-6">

        <Card className="p-4 border border-border bg-muted/30">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input 
              placeholder="Buscar por solicitante ou ID..." 
              className="pl-10" 
              value={filterText} 
              onChange={e => setFilterText(e.target.value)} 
            />
          </div>
        </Card>

        <div className="space-y-4">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando solicitações...</div>
          ) : filteredSolicitacoes.length === 0 ? (
            <div className="p-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
              Nenhuma solicitação encontrada.
            </div>
          ) : (
            filteredSolicitacoes.map((sol) => (
              <Card key={sol.id} className={`overflow-hidden border transition-all ${expandedId === sol.id ? "ring-2 ring-orange-500 shadow-lg" : "hover:border-orange-300"}`}>
                {/* Cabeçalho da Solicitação (Notificação Clicável) */}
                <div 
                  className={`p-4 cursor-pointer flex items-center justify-between ${sol.status === 'pendente' ? "bg-orange-50/50" : "bg-muted/20"}`}
                  onClick={() => {
                    const abrindo = expandedId !== sol.id;
                    setExpandedId(abrindo ? sol.id : null);
                    setObsSeparacao(abrindo ? (sol.observacoesSeparacao || "") : "");
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center ${sol.status === 'pendente' ? "bg-orange-100 text-orange-600" : "bg-green-100 text-green-600"}`}>
                      {sol.status === 'pendente' ? <Clock className="w-5 h-5" /> : <CheckCircle2 className="w-5 h-5" />}
                    </div>
                    <div>
                      <div className="font-bold text-sm flex items-center gap-2">
                        Solicitação #{sol.id} 
                        <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${sol.status === 'pendente' ? "bg-orange-200 text-orange-800" : "bg-green-200 text-green-800"}`}>
                          {sol.status}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
                        <span>Por <strong>{sol.usuarioSolicitante}</strong> em {format(new Date(sol.dataSolicitacao), "dd/MM/yyyy HH:mm")}</span>
                        {sol.obraDestino && (
                          <span className="flex items-center gap-1 text-blue-600 font-medium">
                            <FileText className="w-3 h-3" /> Destino: {sol.obraDestino.nome}
                          </span>
                        )}
                        {sol.dataLimite && (
                          <span className={`flex items-center gap-1 font-medium ${new Date(sol.dataLimite) < new Date() ? "text-red-600" : "text-orange-600"}`}>
                            <Clock className="w-3 h-3" /> Limite: {format(new Date(sol.dataLimite), "dd/MM/yyyy")}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right hidden md:block">
                      <div className="text-xs font-medium">{sol.itens.length} itens solicitados</div>
                    </div>
                    {expandedId === sol.id ? <ChevronUp className="w-5 h-5 text-muted-foreground" /> : <ChevronDown className="w-5 h-5 text-muted-foreground" />}
                  </div>
                </div>

                {/* Conteúdo Expandido */}
                {expandedId === sol.id && (
                  <div className="p-6 border-t bg-card space-y-6 animate-in slide-in-from-top-2 duration-200">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                      {/* Lado Esquerdo: Itens e Observação */}
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">
                          <ArrowRightLeft className="w-3 h-3" /> Materiais Solicitados
                        </h4>
                        <div className="border rounded-lg overflow-hidden">
                          <table className="w-full text-sm">
                            <thead className="bg-muted/50 text-[10px] font-bold uppercase">
                              <tr>
                                <th className="px-3 py-2 text-left">Material</th>
                                <th className="px-3 py-2 text-right">Qtd</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {sol.itens.map((it: any) => (
                                <tr key={it.id}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium">{it.material.tipo} {it.material.bitola}</div>
                                    <div className="text-[10px] text-muted-foreground">{it.material.aco} | {it.material.obraNome}</div>
                                  </td>
                                  <td className="px-3 py-2 text-right font-bold">{it.quantidadeSolicitada} PÇ</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        <div className="bg-muted/30 p-4 rounded-lg border border-dashed">
                          <h5 className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Observação do Solicitante</h5>
                          <p className="text-sm italic text-foreground">
                            "{sol.observacaoSolicitante || "Nenhuma observação informada."}"
                          </p>
                        </div>

                        {/* Observações da separação — livre, editável, aparece no PDF */}
                        <div className="p-4 rounded-lg border">
                          <h5 className="text-[10px] font-bold uppercase text-muted-foreground mb-2 flex items-center gap-1.5">
                            <StickyNote className="w-3 h-3" /> Observações da Separação
                          </h5>
                          <textarea
                            className="w-full min-h-[70px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
                            placeholder="Divergências, condição do material, detalhes da separação..."
                            value={obsSeparacao}
                            onChange={e => setObsSeparacao(e.target.value)}
                          />
                          <div className="flex justify-end mt-2">
                            <PermissionGate permission="solicitacoes:responder">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleSalvarObservacoes(sol.id)}
                                disabled={salvarObsMutation.isPending}
                              >
                                {salvarObsMutation.isPending ? "Salvando..." : "Salvar Observações"}
                              </Button>
                            </PermissionGate>
                          </div>
                        </div>

                        {/* Fotos da separação */}
                        <div className="p-4 rounded-lg border">
                          <div className="flex items-center justify-between mb-2">
                            <h5 className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-1.5">
                              <ImageIcon className="w-3 h-3" /> Fotos da Separação {imagensDaSolicitacao ? `(${imagensDaSolicitacao.length})` : ""}
                            </h5>
                            <PermissionGate permission="solicitacoes:responder">
                              <label className="cursor-pointer text-xs font-semibold text-blue-700 hover:text-blue-900 flex items-center gap-1">
                                {enviandoImagens ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                                {enviandoImagens ? "Enviando..." : "Anexar fotos"}
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  disabled={enviandoImagens}
                                  onChange={(e) => { handleUploadImagens(sol.id, e.target.files); e.target.value = ""; }}
                                />
                              </label>
                            </PermissionGate>
                          </div>
                          {!imagensDaSolicitacao || imagensDaSolicitacao.length === 0 ? (
                            <p className="text-xs text-muted-foreground">Nenhuma foto anexada ainda.</p>
                          ) : (
                            <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                              {imagensDaSolicitacao.map((img: any) => (
                                <ImagemThumb key={img.id} imagem={img} onDelete={() => handleDeletarImagem(img.id)} />
                              ))}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Lado Direito: Conversa e Ações */}
                      <div className="space-y-4">
                        <h4 className="text-xs font-bold uppercase text-muted-foreground flex items-center gap-2">
                          <MessageSquare className="w-3 h-3" /> Resposta / Conversa
                        </h4>
                        
                        <div className="space-y-3">
                          {sol.observacaoResposta ? (
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                              <h5 className="text-[10px] font-bold uppercase text-blue-700 mb-1">Resposta do Almoxarifado</h5>
                              <p className="text-sm text-blue-900">{sol.observacaoResposta}</p>
                            </div>
                          ) : (
                            <div className="text-xs text-muted-foreground italic p-4 border rounded-lg border-dashed">
                              Aguardando resposta ou processamento...
                            </div>
                          )}

                          {sol.status === 'pendente' && (
                            <div className="flex gap-2">
                              <Input 
                                placeholder="Escreva uma resposta..." 
                                value={resposta}
                                onChange={e => setResposta(e.target.value)}
                                className="flex-1"
                              />
                              <PermissionGate permission="solicitacoes:responder">
                                <Button size="icon" onClick={() => handleResponder(sol.id)} disabled={responderMutation.isPending}>
                                  <Send className="w-4 h-4" />
                                </Button>
                              </PermissionGate>
                            </div>
                          )}
                        </div>

                        <div className="pt-4 flex flex-wrap gap-2">
                          <Button variant="outline" className="gap-2" onClick={() => exportarPDF(sol)} disabled={gerandoPdf}>
                            {gerandoPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            {gerandoPdf ? "Gerando PDF..." : "Exportar PDF"}
                          </Button>
                          {sol.status === 'pendente' && (
                            <PermissionGate permission="solicitacoes:concluir">
                              <Button className="bg-green-600 hover:bg-green-700 gap-2 ml-auto" onClick={() => handleConcluir(sol.id)} disabled={concluirMutation.isPending}>
                                <CheckCircle2 className="w-4 h-4" /> Confirmar Separação
                              </Button>
                            </PermissionGate>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>

          </TabsContent>
        </Tabs>
      </div>
    </StockDashboardLayout>
  );
}

// ── Miniatura de foto da separação — carrega o conteúdo sob demanda ──────────
function ImagemThumb({ imagem, onDelete }: { imagem: any; onDelete: () => void }) {
  const { data: full, isLoading } = trpc.solicitacoes.obterImagem.useQuery({ id: imagem.id });

  return (
    <div className="relative group aspect-square rounded-md overflow-hidden border bg-muted/30">
      {isLoading || !full ? (
        <div className="w-full h-full flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <a href={`data:${full.tipoArquivo};base64,${full.conteudoBase64}`} target="_blank" rel="noopener noreferrer">
          <img
            src={`data:${full.tipoArquivo};base64,${full.conteudoBase64}`}
            alt={imagem.nomeArquivo}
            className="w-full h-full object-cover"
          />
        </a>
      )}
      <PermissionGate permission="solicitacoes:responder">
        <button
          type="button"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(); }}
          className="absolute top-1 right-1 bg-black/60 hover:bg-destructive text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Remover foto"
        >
          <X className="w-3 h-3" />
        </button>
      </PermissionGate>
    </div>
  );
}
