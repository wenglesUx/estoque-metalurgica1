import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { PermissionGate } from "@/components/PermissionGate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Upload, FileText, Loader2, Package, CheckCircle2, Clock,
  AlertCircle, XCircle, Trash2, ChevronDown, ChevronUp, Search, Mail, Plus, Download, Edit2, Undo2,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useState } from "react";
import React from "react";
import { toast } from "sonner";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

type StatusPedido = "pendente" | "parcial" | "recebido" | "cancelado";

const STATUS_INFO: Record<StatusPedido, { label: string; cor: string; icone: JSX.Element }> = {
  pendente: { label: "Pendente", cor: "bg-amber-100 text-amber-800 border-amber-200", icone: <Clock className="w-3.5 h-3.5" /> },
  parcial: { label: "Parcial", cor: "bg-blue-100 text-blue-800 border-blue-200", icone: <AlertCircle className="w-3.5 h-3.5" /> },
  recebido: { label: "Recebido", cor: "bg-green-100 text-green-800 border-green-200", icone: <CheckCircle2 className="w-3.5 h-3.5" /> },
  cancelado: { label: "Cancelado", cor: "bg-muted text-muted-foreground border-border", icone: <XCircle className="w-3.5 h-3.5" /> },
};

export default function MateriaisAChegar() {
  const { data: pedidos, isLoading, refetch } = trpc.pedidosCompra.listar.useQuery();
  const extrairMutation = trpc.pedidosCompra.extrairPdf.useMutation();
  const criarMutation = trpc.pedidosCompra.criar.useMutation();
  const cancelarMutation = trpc.pedidosCompra.cancelar.useMutation();
  const encerrarItemMutation = trpc.pedidosCompra.encerrarItem.useMutation();
  const confirmarRecebimentoMutation = trpc.pedidosCompra.confirmarRecebimento.useMutation();

  const { data: filaRevisao, refetch: refetchFila } = trpc.pedidosCompra.listarFilaRevisao.useQuery();
  const confirmarFilaMutation = trpc.pedidosCompra.confirmarFilaRevisao.useMutation();
  const rejeitarFilaMutation = trpc.pedidosCompra.rejeitarFilaRevisao.useMutation();
  const verificarAgoraMutation = trpc.pedidosCompra.verificarEmailAgora.useMutation();
  const [resultadoVerificacao, setResultadoVerificacao] = useState<any>(null);

  const { data: fornecedoresEmail, refetch: refetchFornecedores } = trpc.pedidosCompra.listarFornecedoresEmail.useQuery();
  const criarFornecedorMutation = trpc.pedidosCompra.criarFornecedorEmail.useMutation();
  const atualizarFornecedorMutation = trpc.pedidosCompra.atualizarFornecedorEmail.useMutation();
  const excluirFornecedorMutation = trpc.pedidosCompra.excluirFornecedorEmail.useMutation();

  const [nomeFornecedorNovo, setNomeFornecedorNovo] = useState("");
  const [emailsFornecedorNovo, setEmailsFornecedorNovo] = useState("");
  const [mostrarFornecedores, setMostrarFornecedores] = useState(false);

  const [filaRevisaoAtualId, setFilaRevisaoAtualId] = useState<number | null>(null);

  const [editandoItemId, setEditandoItemId] = useState<number | null>(null);
  const [textoJustificativaItem, setTextoJustificativaItem] = useState("");

  const [confirmandoItemId, setConfirmandoItemId] = useState<number | null>(null);
  const [quantidadeConfirmar, setQuantidadeConfirmar] = useState("");

  // Correções de administrador: editar o pedido, desfazer recebimento
  // marcado por engano e reabrir pedido cancelado (o servidor também barra
  // quem não é admin).
  const { data: usuarioAtual } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });
  const ehAdmin = usuarioAtual?.role === "owner" || usuarioAtual?.role === "admin";
  const editarPedidoMutation = trpc.pedidosCompra.editar.useMutation();
  const reabrirPedidoMutation = trpc.pedidosCompra.reabrir.useMutation();
  const [desfazendoItemId, setDesfazendoItemId] = useState<number | null>(null);
  const [edicaoPedido, setEdicaoPedido] = useState<any | null>(null);

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [dadosExtraidos, setDadosExtraidos] = useState<any | null>(null);
  const [busca, setBusca] = useState("");
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const [cienteDuplicado, setCienteDuplicado] = useState(false);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);

  const numeroPedidoAtual = dadosExtraidos?.cabecalho?.numeroPedido?.trim() || "";
  const { data: duplicadoCheck } = trpc.pedidosCompra.verificarDuplicado.useQuery(
    { numeroPedido: numeroPedidoAtual, ignorarFilaId: filaRevisaoAtualId ?? undefined },
    { enabled: !!numeroPedidoAtual }
  );

  const handleSelecionarArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivo(file);
    setDadosExtraidos(null);
    setFilaRevisaoAtualId(null);
    setCienteDuplicado(false);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const base64 = (ev.target?.result as string).split(",")[1] || "";
      try {
        const resultado = await extrairMutation.mutateAsync({ pdfBase64: base64 });
        setDadosExtraidos(resultado);
        toast.success(`PDF lido — ${resultado.itens.length} ${resultado.itens.length === 1 ? "item encontrado" : "itens encontrados"}. Revise antes de salvar.`);
      } catch (err: any) {
        toast.error("Erro ao ler o PDF: " + (err.message || "Tente novamente."));
        setArquivo(null);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const atualizarCampoCabecalho = (campo: string, valor: string) => {
    setDadosExtraidos((prev: any) => ({ ...prev, cabecalho: { ...prev.cabecalho, [campo]: valor } }));
  };

  const atualizarItem = (idx: number, campo: string, valor: any) => {
    setDadosExtraidos((prev: any) => {
      const itens = [...prev.itens];
      itens[idx] = { ...itens[idx], [campo]: valor };
      return { ...prev, itens };
    });
  };

  const removerItem = (idx: number) => {
    setDadosExtraidos((prev: any) => ({ ...prev, itens: prev.itens.filter((_: any, i: number) => i !== idx) }));
  };

  const handleConfirmarSalvar = async () => {
    if (!dadosExtraidos?.cabecalho?.numeroPedido) {
      toast.error("Preencha ao menos o número do pedido antes de salvar.");
      return;
    }
    if (duplicadoCheck && !cienteDuplicado) {
      toast.error("Esse número de pedido já existe — marque que está ciente antes de salvar mesmo assim.");
      return;
    }
    try {
      await criarMutation.mutateAsync({
        ...dadosExtraidos.cabecalho,
        itens: dadosExtraidos.itens,
        forcar: cienteDuplicado,
        ignorarFilaId: filaRevisaoAtualId ?? undefined,
      });
      if (filaRevisaoAtualId) {
        await confirmarFilaMutation.mutateAsync({ id: filaRevisaoAtualId });
        refetchFila();
      }
      toast.success("Pedido de compra salvo — já aparece na lista de acompanhamento.");
      setArquivo(null);
      setDadosExtraidos(null);
      setFilaRevisaoAtualId(null);
      setCienteDuplicado(false);
      refetch();
    } catch (err: any) {
      toast.error("Erro ao salvar: " + (err.message || "Tente novamente."));
    }
  };

  // Abre o pop-up de revisão com os dados já extraídos do e-mail
  const handleRevisarItemFila = (item: any) => {
    setDadosExtraidos(item.dadosExtraidos);
    setFilaRevisaoAtualId(item.id);
    setArquivo(null);
    setCienteDuplicado(false);
  };

  const fecharRevisao = () => {
    setArquivo(null);
    setDadosExtraidos(null);
    setFilaRevisaoAtualId(null);
    setCienteDuplicado(false);
  };

  const itemFilaAtual = (filaRevisao || []).find((item: any) => item.id === filaRevisaoAtualId);

  const handleRejeitarItemFila = async (id: number) => {
    try {
      await rejeitarFilaMutation.mutateAsync({ id });
      toast.success("Item da fila descartado.");
      refetchFila();
    } catch {
      toast.error("Erro ao descartar item da fila.");
    }
  };

  const handleVerificarAgora = async () => {
    setResultadoVerificacao(null);
    try {
      const resultado = await verificarAgoraMutation.mutateAsync();
      setResultadoVerificacao(resultado);
      if (resultado.novosNaFila && resultado.novosNaFila > 0) refetchFila();
    } catch (err: any) {
      setResultadoVerificacao({ ok: false, mensagem: err.message || "Erro ao verificar e-mails." });
    }
  };

  const handleAdicionarFornecedorEmail = async () => {
    if (!nomeFornecedorNovo.trim() || !emailsFornecedorNovo.trim()) {
      toast.error("Preencha nome e ao menos um e-mail.");
      return;
    }
    try {
      await criarFornecedorMutation.mutateAsync({ nome: nomeFornecedorNovo.trim(), emails: emailsFornecedorNovo.trim() });
      setNomeFornecedorNovo("");
      setEmailsFornecedorNovo("");
      refetchFornecedores();
      toast.success("Fornecedor adicionado à leitura automática.");
    } catch {
      toast.error("Erro ao adicionar fornecedor.");
    }
  };

  const handleToggleFornecedorAtivo = async (id: number, ativo: boolean) => {
    await atualizarFornecedorMutation.mutateAsync({ id, ativo: !ativo });
    refetchFornecedores();
  };

  const handleExcluirFornecedorEmail = async (id: number) => {
    await excluirFornecedorMutation.mutateAsync({ id });
    refetchFornecedores();
  };

  const handleCancelarPedido = async (id: number) => {
    try {
      await cancelarMutation.mutateAsync({ id });
      toast.success("Pedido cancelado.");
      refetch();
    } catch {
      toast.error("Erro ao cancelar o pedido.");
    }
  };

  const handleEncerrarItem = async (itemId: number) => {
    try {
      await encerrarItemMutation.mutateAsync({ itemId, justificativa: textoJustificativaItem || undefined });
      toast.success("Item encerrado.");
      setEditandoItemId(null);
      setTextoJustificativaItem("");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Erro ao encerrar o item.");
    }
  };

  // Confirmação manual — pra quando o cruzamento automático (por número de
  // pedido + tipo/bitola/aço) não encontrar o material correspondente, ou
  // quando o material nem for recadastrado individualmente.
  const handleConfirmarRecebimento = async (itemId: number) => {
    const quantidade = parseInt(quantidadeConfirmar, 10);
    if (!quantidade || quantidade < 1) { toast.error("Informe uma quantidade válida (mínimo 1)."); return; }
    try {
      await confirmarRecebimentoMutation.mutateAsync({ itemId, quantidade });
      toast.success("Recebimento confirmado.");
      setConfirmandoItemId(null);
      setQuantidadeConfirmar("");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Erro ao confirmar o recebimento.");
    }
  };

  // Zera o recebido de um item marcado por engano — ele volta a "Pendente"
  // e o pedido volta a aparecer como em aberto.
  const handleDesfazerRecebimento = async (pedidoId: number, itemId: number) => {
    try {
      await editarPedidoMutation.mutateAsync({ id: pedidoId, itens: [{ id: itemId, quantidadeRecebida: 0, reabrir: true }] });
      toast.success("Recebimento desfeito — o item voltou a ficar pendente.");
      setDesfazendoItemId(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Erro ao desfazer o recebimento.");
    }
  };

  const handleReabrirPedido = async (id: number) => {
    try {
      await reabrirPedidoMutation.mutateAsync({ id });
      toast.success("Pedido reaberto.");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Erro ao reabrir o pedido.");
    }
  };

  const abrirEdicaoPedido = (p: any) => {
    const texto = (v: any) => (v === null || v === undefined ? "" : String(v));
    setEdicaoPedido({
      id: p.id,
      numeroPedido: texto(p.numeroPedido),
      fornecedorNome: texto(p.fornecedorNome),
      obraNome: texto(p.obraNome),
      dataEntregaPrevista: texto(p.dataEntregaPrevista),
      itens: (p.itens || []).map((item: any) => ({
        id: item.id,
        tipo: texto(item.tipo), bitola: texto(item.bitola), aco: texto(item.aco),
        comprimento: texto(item.comprimento), quantidadePecas: texto(item.quantidadePecas),
        pesoTotal: texto(item.pesoTotal), valorUnitario: texto(item.valorUnitario),
        quantidadeRecebida: texto(item.quantidadeRecebida ?? 0),
        recebidaOriginal: item.quantidadeRecebida ?? 0,
      })),
    });
  };

  const atualizarItemEdicao = (itemId: number, campo: string, valor: string) => {
    setEdicaoPedido((prev: any) => ({ ...prev, itens: prev.itens.map((i: any) => (i.id === itemId ? { ...i, [campo]: valor } : i)) }));
  };

  const handleSalvarEdicaoPedido = async () => {
    if (!edicaoPedido) return;
    if (!edicaoPedido.numeroPedido.trim()) { toast.error("O número do pedido não pode ficar vazio."); return; }
    const numero = (v: string) => { const n = parseFloat(String(v).replace(",", ".")); return Number.isFinite(n) ? n : null; };
    try {
      await editarPedidoMutation.mutateAsync({
        id: edicaoPedido.id,
        numeroPedido: edicaoPedido.numeroPedido,
        fornecedorNome: edicaoPedido.fornecedorNome,
        obraNome: edicaoPedido.obraNome,
        dataEntregaPrevista: edicaoPedido.dataEntregaPrevista,
        itens: edicaoPedido.itens.map((i: any) => ({
          id: i.id,
          tipo: i.tipo, bitola: i.bitola, aco: i.aco,
          comprimento: numero(i.comprimento),
          quantidadePecas: numero(i.quantidadePecas),
          pesoTotal: numero(i.pesoTotal),
          valorUnitario: numero(i.valorUnitario),
          quantidadeRecebida: Math.max(0, Math.floor(numero(i.quantidadeRecebida) ?? 0)),
        })),
      });
      toast.success("Pedido atualizado.");
      setEdicaoPedido(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar as alterações do pedido.");
    }
  };

  const pedidosFiltrados = (pedidos || []).filter((p: any) => {
    if (!busca.trim()) return true;
    const termo = busca.toLowerCase();
    return (
      p.numeroPedido?.toLowerCase().includes(termo) ||
      p.fornecedorNome?.toLowerCase().includes(termo) ||
      p.obraNome?.toLowerCase().includes(termo)
    );
  });

  // Relatório em PDF de tudo que ainda está por chegar (pendente ou
  // parcial) — agrupado por fornecedor, mesmo padrão visual já usado no
  // Relatório de Divergência (jsPDF + autoTable, cabeçalho institucional,
  // cards de resumo, uma seção por grupo).
  const handleGerarRelatorio = async () => {
    const pendentes = (pedidos || []).filter((p: any) => p.status === "pendente" || p.status === "parcial");
    if (pendentes.length === 0) {
      toast.error("Não há pedidos pendentes ou parciais pra incluir no relatório.");
      return;
    }
    setGerandoRelatorio(true);
    try {
      const graphite: [number, number, number] = [26, 35, 50];
      const warm: [number, number, number] = [248, 246, 241];
      const line: [number, number, number] = [220, 225, 229];
      const muted: [number, number, number] = [98, 111, 124];
      const red: [number, number, number] = [185, 45, 45];
      const blue: [number, number, number] = [37, 99, 173];
      const blueSoft: [number, number, number] = [232, 240, 250];
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

      doc.setFillColor(...warm);
      doc.rect(0, 0, W, 32, "F");
      doc.setFillColor(...blue);
      doc.rect(0, 0, W, 2, "F");
      if (logoData) doc.addImage(logoData, "PNG", margin, 7, 22, 13);
      doc.setTextColor(...blue);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.text("CONTROLE DE MATERIAIS", margin + 27, 11);
      doc.setTextColor(...graphite);
      doc.setFontSize(15);
      doc.text("Relatório de Materiais a Chegar", margin + 27, 19);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(...muted);
      doc.text("Pedidos de compra pendentes ou parciais, agrupados por fornecedor", margin + 27, 25);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7);
      doc.setTextColor(...muted);
      doc.text("EMITIDO EM", W - margin, 11, { align: "right" });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...graphite);
      doc.text(format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR }), W - margin, 17, { align: "right" });

      const todosItens = pendentes.flatMap((p: any) => p.itens || []);
      const itensPendentes = todosItens.filter((i: any) => i.statusItem !== "completo");
      const valorTotalPendente = pendentes.reduce((soma: number, p: any) => {
        const itensAbertos = (p.itens || []).filter((i: any) => i.statusItem !== "completo");
        return soma + itensAbertos.reduce((s: number, i: any) => s + (parseFloat(String(i.valorTotalItem || "0")) || 0), 0);
      }, 0);
      const pesoTotalPendente = itensPendentes.reduce((soma: number, i: any) => soma + (parseFloat(String(i.pesoTotal || "0")) || 0), 0);
      const fornecedoresUnicos = new Set(pendentes.map((p: any) => p.fornecedorNome || "Fornecedor não informado")).size;

      const cardY = 40;
      const cardW = (W - margin * 2 - 16) / 5;
      const cards: [string, string, string, [number, number, number], [number, number, number]][] = [
        ["Pedidos em aberto", String(pendentes.length), "pendentes ou parciais", graphite, warm],
        ["Fornecedores", String(fornecedoresUnicos), "com material a caminho", blue, blueSoft],
        ["Itens em falta", String(itensPendentes.length), "ainda não completos", amber, amberSoft],
        ["Peso em aberto", `${pesoTotalPendente.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`, "referente ao que falta chegar", blue, blueSoft],
        ["Valor em aberto", valorTotalPendente.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }), "referente ao que falta chegar", graphite, warm],
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
        doc.setFontSize(11.5);
        doc.text(valor, x + 5, cardY + 15);
        doc.setTextColor(...muted);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.5);
        doc.text(nota, x + 5, cardY + 19.5);
      });

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

      // Uma seção por fornecedor — dentro dela, uma linha por pedido +
      // item, já que um pedido pode ter vários materiais em situações
      // diferentes (um já completo, outro ainda faltando).
      const porFornecedor = new Map<string, any[]>();
      pendentes.forEach((p: any) => {
        const chave = p.fornecedorNome || "Fornecedor não informado";
        if (!porFornecedor.has(chave)) porFornecedor.set(chave, []);
        porFornecedor.get(chave)!.push(p);
      });
      const gruposOrdenados = Array.from(porFornecedor.entries()).sort((a, b) => a[0].localeCompare(b[0], "pt-BR"));

      gruposOrdenados.forEach(([fornecedor, pedidosDoFornecedor]) => {
        if (cursorY > H - 45) { doc.addPage(); cursorY = 20; }
        const itensDoFornecedor = pedidosDoFornecedor.flatMap((p: any) => p.itens || []);
        const faltandoFornecedor = itensDoFornecedor.filter((i: any) => i.statusItem !== "completo").length;
        const pesoFornecedor = itensDoFornecedor
          .filter((i: any) => i.statusItem !== "completo")
          .reduce((soma: number, i: any) => soma + (parseFloat(String(i.pesoTotal || "0")) || 0), 0);

        doc.setFillColor(...graphite);
        doc.rect(margin, cursorY, W - margin * 2, 8, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text(fornecedor.toUpperCase(), margin + 3, cursorY + 5.5);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.text(
          `${pedidosDoFornecedor.length} ${pedidosDoFornecedor.length === 1 ? "pedido" : "pedidos"} · ${faltandoFornecedor} ${faltandoFornecedor === 1 ? "item em falta" : "itens em falta"} · ${pesoFornecedor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} kg`,
          W - margin - 3, cursorY + 5.5, { align: "right" }
        );
        cursorY += 11;

        const linhas: any[] = [];
        pedidosDoFornecedor.forEach((p: any) => {
          (p.itens || []).length === 0
            ? linhas.push([`#${p.numeroPedido}`, p.obraNome || "—", p.dataEntregaPrevista || "—", "—", "—", "—", "—", STATUS_INFO[p.status as StatusPedido]?.label || p.status])
            : (p.itens || []).forEach((item: any) => {
                const pedida = item.quantidadePecas || 0;
                const recebida = item.quantidadeRecebida || 0;
                const faltando = Math.max(0, pedida - recebida);
                const statusLabel = item.statusItem === "completo" ? (item.encerradoManualmente ? "Encerrado" : "Completo") : item.statusItem === "parcial" ? "Parcial" : "Pendente";
                const peso = parseFloat(String(item.pesoTotal || "0")) || 0;
                linhas.push([
                  `#${p.numeroPedido}${p.dataEmissao ? `\n${p.dataEmissao}` : ""}`,
                  p.obraNome || "—",
                  p.dataEntregaPrevista || "—",
                  `${item.tipo || ""} ${item.bitola || ""}\n${item.aco || ""}`.trim(),
                  peso > 0 ? peso.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) : "—",
                  `${recebida} / ${pedida || "?"}`,
                  faltando > 0 ? String(faltando) : "0",
                  statusLabel,
                ]);
              });
        });

        autoTable(doc, {
          startY: cursorY,
          head: [["Pedido", "Obra", "Entrega Prevista", "Material", "Peso (kg)", "Recebido / Pedido", "Faltando", "Status"]],
          body: linhas,
          foot: [["", "", "", "Total do fornecedor", pesoFornecedor.toLocaleString("pt-BR", { maximumFractionDigits: 1 }), "", "", ""]],
          styles: { fontSize: 7.5, cellPadding: 2.2, lineColor: line, lineWidth: 0.2, textColor: graphite, valign: "middle" },
          headStyles: { fillColor: [90, 98, 110], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
          footStyles: { fillColor: [235, 237, 240], textColor: graphite, fontStyle: "bold", fontSize: 7.5 },
          alternateRowStyles: { fillColor: [250, 251, 252] },
          columnStyles: {
            2: { halign: "center", cellWidth: 26 },
            4: { halign: "center", cellWidth: 22 },
            5: { halign: "center", cellWidth: 28 },
            6: { halign: "center", cellWidth: 20, fontStyle: "bold", textColor: amber },
            7: { cellWidth: 26 },
          },
          margin: { left: margin, right: margin, bottom: 16 },
          didParseCell: (data) => {
            if (data.column.index === 6 && data.cell.raw !== "0" && data.section === "body") {
              data.cell.styles.textColor = amber;
            }
            if (data.column.index === 7 && (data.cell.raw === "Completo" || data.cell.raw === "Encerrado")) {
              data.cell.styles.textColor = [22, 130, 60];
              data.cell.styles.fontStyle = "bold";
            }
          },
          didDrawPage: footerComPaginacao,
        });

        cursorY = (doc as any).lastAutoTable.finalY + 8;
      });

      doc.save(`relatorio_materiais_a_chegar_${format(new Date(), "yyyy-MM-dd")}.pdf`);
      toast.success("Relatório de materiais a chegar gerado!");
    } catch {
      toast.error("Erro ao gerar o relatório.");
    } finally {
      setGerandoRelatorio(false);
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <div>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                <Package className="w-6 h-6 text-accent" /> Materiais a Chegar
              </h2>
              <p className="text-muted-foreground">
                Acompanhe pedidos de compra feitos e ainda não recebidos — anexe o PDF do pedido pra começar.
                Quando a NF-e chegar com o mesmo número de pedido, o sistema cruza automaticamente.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              <Button variant="outline" size="sm" onClick={handleGerarRelatorio} disabled={gerandoRelatorio} className="gap-1.5">
                {gerandoRelatorio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {gerandoRelatorio ? "Gerando..." : "Baixar Relatório"}
              </Button>
              <PermissionGate permission="materiais:importar">
                <Button variant="outline" size="sm" onClick={handleVerificarAgora} disabled={verificarAgoraMutation.isPending} className="gap-1.5">
                  {verificarAgoraMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                  Verificar Agora
                </Button>
                <Button variant="outline" size="sm" onClick={() => setMostrarFornecedores(v => !v)} className="gap-1.5">
                  <Mail className="w-3.5 h-3.5" /> Fornecedores p/ Leitura Automática
                </Button>
              </PermissionGate>
            </div>
          </div>
          {resultadoVerificacao && (
            <div className={`mt-3 text-xs rounded-lg border px-3 py-2 ${resultadoVerificacao.configurado === false ? "border-amber-200 bg-amber-50 text-amber-800" : resultadoVerificacao.ok === false ? "border-red-200 bg-red-50 text-red-800" : "border-green-200 bg-green-50 text-green-800"}`}>
              {resultadoVerificacao.mensagem}
            </div>
          )}
        </div>

        {mostrarFornecedores && (
          <PermissionGate permission="materiais:importar">
          <Card className="p-4">
            <h3 className="text-sm font-bold flex items-center gap-1.5 mb-1"><Mail className="w-4 h-4 text-accent" /> Fornecedores Selecionados</h3>
            <p className="text-xs text-muted-foreground mb-3">
              E-mails de/com cópia pra esses fornecedores são varridos automaticamente em busca de PDF de pedido — o que for encontrado cai na fila de revisão abaixo, sem salvar nada sozinho.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <Input placeholder="Nome do fornecedor" className="sm:max-w-[200px]" value={nomeFornecedorNovo} onChange={e => setNomeFornecedorNovo(e.target.value)} />
              <Input placeholder="E-mails, separados por vírgula" value={emailsFornecedorNovo} onChange={e => setEmailsFornecedorNovo(e.target.value)} />
              <Button onClick={handleAdicionarFornecedorEmail} className="gap-1.5 shrink-0"><Plus className="w-3.5 h-3.5" /> Adicionar</Button>
            </div>
            <div className="divide-y divide-border border rounded-lg overflow-hidden">
              {(fornecedoresEmail || []).length === 0 ? (
                <div className="p-3 text-center text-xs text-muted-foreground">Nenhum fornecedor cadastrado ainda — a leitura automática fica parada até adicionar pelo menos um.</div>
              ) : (
                fornecedoresEmail!.map((f: any) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-semibold">{f.nome}</div>
                      <div className="text-muted-foreground truncate">{f.emails}</div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button size="sm" variant="ghost" className="h-7 text-[10px] px-2" onClick={() => handleToggleFornecedorAtivo(f.id, f.ativo)}>
                        {f.ativo ? "Ativo" : "Inativo"}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive" onClick={() => handleExcluirFornecedorEmail(f.id)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
          </PermissionGate>
        )}

        {(filaRevisao || []).length > 0 && (
          <PermissionGate permission="materiais:importar">
          <Card className="p-4 border-amber-200 bg-amber-50/40">
            <h3 className="text-sm font-bold flex items-center gap-1.5 mb-1 text-amber-800">
              <Mail className="w-4 h-4" /> Fila de Revisão — {filaRevisao!.length} {filaRevisao!.length === 1 ? "pedido detectado" : "pedidos detectados"} por e-mail
            </h3>
            <p className="text-xs text-amber-700 mb-3">Detectados automaticamente, aguardando você conferir e confirmar.</p>
            <div className="divide-y divide-border bg-white border rounded-lg overflow-hidden">
              {filaRevisao!.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0 text-xs">
                    <div className="font-semibold flex items-center gap-1.5 flex-wrap">
                      {item.dadosExtraidos?.cabecalho?.numeroPedido ? `Pedido ${item.dadosExtraidos.cabecalho.numeroPedido}` : "Número não identificado"}
                      {item.possivelDuplicado && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 text-red-800 px-2 py-0.5 text-[10px] font-bold uppercase">
                          <AlertCircle className="w-3 h-3" /> Possível duplicado
                        </span>
                      )}
                    </div>
                    <div className="text-muted-foreground truncate">
                      De: {item.remetente} · {item.dadosExtraidos?.itens?.length || 0} {item.dadosExtraidos?.itens?.length === 1 ? "item" : "itens"}
                    </div>
                    {item.possivelDuplicado && item.duplicadoDetalhe && (
                      <div className="text-red-700 mt-0.5">{item.duplicadoDetalhe}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button size="sm" className="h-7 text-[11px] px-2.5 bg-accent hover:bg-accent/90" onClick={() => handleRevisarItemFila(item)}>Revisar</Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] px-2 text-muted-foreground" onClick={() => handleRejeitarItemFila(item.id)}>Descartar</Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          </PermissionGate>
        )}

        {/* Upload + revisão */}
        <PermissionGate permission="materiais:importar">
        <Card className="p-5">
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border p-10 cursor-pointer hover:border-accent/50 hover:bg-muted/30 transition-colors">
              {extrairMutation.isPending ? (
                <>
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <span className="text-sm text-muted-foreground">Lendo o PDF...</span>
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-muted-foreground" />
                  <span className="text-sm font-medium">Clique para anexar o PDF do pedido de compra</span>
                  <span className="text-xs text-muted-foreground">Formato padrão HCM/Mega</span>
                </>
              )}
              <input type="file" accept="application/pdf" className="hidden" onChange={handleSelecionarArquivo} disabled={extrairMutation.isPending} />
            </label>
        </Card>
        </PermissionGate>

        {/* Revisão do pedido — PDF anexado ou detectado por e-mail — em pop-up */}
        <Dialog open={!!dadosExtraidos} onOpenChange={(aberto) => { if (!aberto) fecharRevisao(); }}>
          <DialogContent
            className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] md:max-w-5xl max-h-[92vh] p-0 gap-0 flex flex-col overflow-hidden"
            // Clique fora não fecha — perderia o que já foi corrigido
            onInteractOutside={(e) => e.preventDefault()}
          >
            <DialogHeader className="px-4 sm:px-6 py-4 pr-12 border-b shrink-0 text-left">
              <DialogTitle className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-accent" /> Revise antes de salvar
              </DialogTitle>
              <DialogDescription>
                {filaRevisaoAtualId
                  ? `Pedido detectado por e-mail${itemFilaAtual?.remetente ? ` — de ${itemFilaAtual.remetente}` : ""}. Confira e corrija os dados antes de confirmar.`
                  : `Dados lidos do PDF${arquivo?.name ? ` ${arquivo.name}` : ""}. Confira e corrija antes de confirmar.`}
              </DialogDescription>
            </DialogHeader>

            {dadosExtraidos && (
            <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Nº do Pedido *</label>
                  <Input value={dadosExtraidos.cabecalho.numeroPedido || ""} onChange={e => atualizarCampoCabecalho("numeroPedido", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Fornecedor</label>
                  <Input value={dadosExtraidos.cabecalho.fornecedorNome || ""} onChange={e => atualizarCampoCabecalho("fornecedorNome", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Obra</label>
                  <Input value={dadosExtraidos.cabecalho.obraNome || ""} onChange={e => atualizarCampoCabecalho("obraNome", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Entrega Prevista</label>
                  <Input placeholder="DD/MM/AAAA" value={dadosExtraidos.cabecalho.dataEntregaPrevista || ""} onChange={e => atualizarCampoCabecalho("dataEntregaPrevista", e.target.value)} />
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full min-w-[760px] text-xs">
                  <thead className="bg-muted/50 text-muted-foreground uppercase font-bold">
                    <tr>
                      <th className="p-2 text-left">Tipo</th>
                      <th className="p-2 text-left">Bitola</th>
                      <th className="p-2 text-left">Aço</th>
                      <th className="p-2 text-left">Compr. (mm)</th>
                      <th className="p-2 text-left">Qtd Peças</th>
                      <th className="p-2 text-left">Peso (kg)</th>
                      <th className="p-2 text-left">Valor Unit.</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {dadosExtraidos.itens.map((item: any, idx: number) => {
                      const incompleto = !item.tipo || !item.bitola || !item.aco;
                      return (
                      <React.Fragment key={idx}>
                      <tr>
                        <td className="p-1.5"><Input className="h-7 text-xs" value={item.tipo || ""} onChange={e => atualizarItem(idx, "tipo", e.target.value)} /></td>
                        <td className="p-1.5"><Input className="h-7 text-xs" value={item.bitola || ""} onChange={e => atualizarItem(idx, "bitola", e.target.value)} /></td>
                        <td className="p-1.5"><Input className="h-7 text-xs" value={item.aco || ""} onChange={e => atualizarItem(idx, "aco", e.target.value)} /></td>
                        <td className="p-1.5"><Input className="h-7 text-xs" type="number" value={item.comprimento || ""} onChange={e => atualizarItem(idx, "comprimento", parseInt(e.target.value) || null)} /></td>
                        <td className="p-1.5"><Input className="h-7 text-xs" type="number" value={item.quantidadePecas || ""} onChange={e => atualizarItem(idx, "quantidadePecas", parseInt(e.target.value) || null)} /></td>
                        <td className="p-1.5"><Input className="h-7 text-xs" type="number" value={item.pesoTotal || ""} onChange={e => atualizarItem(idx, "pesoTotal", parseFloat(e.target.value) || null)} /></td>
                        <td className="p-1.5"><Input className="h-7 text-xs" type="number" value={item.valorUnitario || ""} onChange={e => atualizarItem(idx, "valorUnitario", parseFloat(e.target.value) || null)} /></td>
                        <td className="p-1.5">
                          <button type="button" onClick={() => removerItem(idx)} className="text-muted-foreground hover:text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                      {incompleto && item.descricaoOriginal && (
                        <tr>
                          <td colSpan={8} className="px-1.5 pb-2 -mt-1">
                            <div className="flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                              <span><strong>Não reconhecido automaticamente</strong> — texto original do pedido: "{item.descricaoOriginal}"</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                      );
                    })}
                    {dadosExtraidos.itens.length === 0 && (
                      <tr><td colSpan={8} className="p-4 text-center text-muted-foreground">Nenhum item foi identificado — confira se o PDF está no formato esperado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {duplicadoCheck && (
                <div className="rounded-md border border-red-300 bg-red-50 px-3 py-2.5 text-xs text-red-800 space-y-2">
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      <strong>Possível duplicidade:</strong>{" "}
                      {duplicadoCheck.origem === "confirmado"
                        ? `já existe o pedido ${numeroPedidoAtual} cadastrado (fornecedor: ${duplicadoCheck.fornecedorNome || "não identificado"}).`
                        : `já existe o pedido ${numeroPedidoAtual} aguardando revisão na fila.`}
                    </span>
                  </div>
                  <label className="flex items-center gap-1.5 font-medium cursor-pointer">
                    <input type="checkbox" checked={cienteDuplicado} onChange={e => setCienteDuplicado(e.target.checked)} />
                    Estou ciente e quero salvar mesmo assim
                  </label>
                </div>
              )}

            </div>
            )}

            <DialogFooter className="px-4 sm:px-6 py-3 border-t shrink-0 bg-muted/20">
              <Button variant="outline" onClick={fecharRevisao}>Cancelar</Button>
              <Button
                onClick={handleConfirmarSalvar}
                disabled={criarMutation.isPending || (!!duplicadoCheck && !cienteDuplicado)}
                className="gap-2 bg-accent hover:bg-accent/90"
              >
                {criarMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                {criarMutation.isPending ? "Salvando..." : "Confirmar e Salvar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Lista de pedidos */}
        <Card className="p-4">
          <div className="relative max-w-sm mb-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por pedido, fornecedor ou obra..." className="pl-9" value={busca} onChange={e => setBusca(e.target.value)} />
          </div>

          <div className="divide-y divide-border border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
            ) : pedidosFiltrados.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {busca ? "Nenhum pedido encontrado com esse filtro." : "Nenhum pedido de compra cadastrado ainda."}
              </div>
            ) : (
              pedidosFiltrados.map((p: any) => {
                const info = STATUS_INFO[p.status as StatusPedido] || STATUS_INFO.pendente;
                const aberto = expandidoId === p.id;
                return (
                  <div key={p.id}>
                    <div
                      onClick={() => setExpandidoId(aberto ? null : p.id)}
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0 flex items-center gap-3">
                        {aberto ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm">Pedido {p.numeroPedido}</span>
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${info.cor}`}>
                              {info.icone} {info.label}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {p.fornecedorNome || "Fornecedor não informado"} · {p.obraNome || "Obra não informada"}
                            {p.dataEntregaPrevista && ` · Entrega prevista: ${p.dataEntregaPrevista}`}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {ehAdmin && (
                          <Button
                            size="sm" variant="ghost" className="gap-1.5"
                            title="Corrigir dados do pedido, dos itens ou a quantidade recebida"
                            onClick={(e) => { e.stopPropagation(); abrirEdicaoPedido(p); }}
                          >
                            <Edit2 className="w-3.5 h-3.5" /> Editar
                          </Button>
                        )}
                        {ehAdmin && p.status === "cancelado" && (
                          <Button
                            size="sm" variant="ghost" className="gap-1.5"
                            disabled={reabrirPedidoMutation.isPending}
                            onClick={(e) => { e.stopPropagation(); handleReabrirPedido(p.id); }}
                          >
                            <Undo2 className="w-3.5 h-3.5" /> Reabrir
                          </Button>
                        )}
                        {p.status !== "cancelado" && p.status !== "recebido" && (
                          <PermissionGate permission="materiais:importar">
                            <Button
                              size="sm" variant="ghost"
                              className="text-destructive"
                              onClick={(e) => { e.stopPropagation(); handleCancelarPedido(p.id); }}
                            >
                              Cancelar
                            </Button>
                          </PermissionGate>
                        )}
                      </div>
                    </div>
                    {aberto && (
                      <div className="bg-muted/20 px-4 py-3">
                        <table className="w-full text-xs">
                          <thead className="text-muted-foreground uppercase font-bold">
                            <tr>
                              <th className="text-left pb-1">Material</th>
                              <th className="text-left pb-1">Recebido / Pedido</th>
                              <th className="text-left pb-1">Valor Unit.</th>
                              <th className="text-left pb-1">Status</th>
                              <th className="text-left pb-1"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/60">
                            {(p.itens || []).map((item: any) => {
                              const pedida = item.quantidadePecas || 0;
                              const recebida = item.quantidadeRecebida || 0;
                              const faltando = Math.max(0, pedida - recebida);
                              const dentroDaTolerancia = pedida === 0 || faltando <= pedida * 0.05;
                              const statusInfo: Record<string, { label: string; cor: string }> = {
                                pendente: { label: "Pendente", cor: "text-muted-foreground" },
                                parcial: { label: "Parcial", cor: "text-blue-700 font-semibold" },
                                completo: { label: item.encerradoManualmente ? "Encerrado" : "Completo", cor: "text-green-700 font-semibold" },
                              };
                              const info = statusInfo[item.statusItem] || statusInfo.pendente;
                              const editando = editandoItemId === item.id;
                              const confirmando = confirmandoItemId === item.id;

                              return (
                                <tr key={item.id} className="align-top">
                                  <td className="py-1.5">{item.tipo} {item.bitola} — {item.aco}</td>
                                  <td className="py-1.5">
                                    <span className={recebida > 0 && !dentroDaTolerancia && item.statusItem !== "completo" ? "text-amber-700 font-semibold" : ""}>
                                      {recebida} / {pedida || "?"}
                                    </span>
                                    {(item.entregas || []).length > 1 && (
                                      <div className="text-[10px] text-muted-foreground mt-0.5">
                                        {item.entregas.length} entregas separadas
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-1.5">{item.valorUnitario ? `R$ ${item.valorUnitario}` : "-"}</td>
                                  <td className="py-1.5">
                                    <span className={info.cor}>
                                      {item.statusItem === "completo" && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
                                      {info.label}
                                    </span>
                                    {item.justificativaDivergencia && (
                                      <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[220px]">
                                        "{item.justificativaDivergencia}"
                                      </div>
                                    )}
                                  </td>
                                  <td className="py-1.5">
                                    {item.statusItem !== "completo" && !editando && !confirmando && (
                                      <PermissionGate permission="materiais:importar">
                                        <div className="flex gap-1">
                                          <Button
                                            size="sm" variant="outline"
                                            className="h-6 text-[10px] px-2 border-green-300 text-green-700 hover:bg-green-50"
                                            title="Confirmar manualmente que uma quantidade chegou, sem depender do cruzamento automático por número de pedido"
                                            onClick={(e) => { e.stopPropagation(); setConfirmandoItemId(item.id); setQuantidadeConfirmar(String(faltando || "")); }}
                                          >
                                            Confirmar recebimento
                                          </Button>
                                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={(e) => { e.stopPropagation(); setEditandoItemId(item.id); setTextoJustificativaItem(""); }}>
                                            Encerrar
                                          </Button>
                                        </div>
                                      </PermissionGate>
                                    )}
                                    {ehAdmin && (recebida > 0 || item.statusItem === "completo") && !editando && !confirmando && (
                                      desfazendoItemId === item.id ? (
                                        <div className="mt-1 flex items-center gap-1 text-[10px]" onClick={(e) => e.stopPropagation()}>
                                          <span className="text-amber-800">Zerar o recebido e voltar pra pendente?</span>
                                          <Button size="sm" className="h-6 text-[10px] px-2 bg-amber-600 hover:bg-amber-700" disabled={editarPedidoMutation.isPending} onClick={() => handleDesfazerRecebimento(p.id, item.id)}>
                                            Desfazer
                                          </Button>
                                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setDesfazendoItemId(null)}>
                                            Não
                                          </Button>
                                        </div>
                                      ) : (
                                        <Button
                                          size="sm" variant="ghost"
                                          className="h-6 gap-1 text-[10px] px-2 text-amber-700 hover:bg-amber-50"
                                          title="Marcou como recebido por engano? Zera o recebido deste item. Pra ajustar pra outro valor, use Editar no pedido."
                                          onClick={(e) => { e.stopPropagation(); setDesfazendoItemId(item.id); }}
                                        >
                                          <Undo2 className="w-3 h-3" /> Desfazer recebimento
                                        </Button>
                                      )
                                    )}
                                    {confirmando && (
                                      <div className="flex items-center gap-1 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                                        <Input
                                          type="number"
                                          min={1}
                                          autoFocus
                                          className="h-6 w-20 text-[10px]"
                                          placeholder="Qtd."
                                          value={quantidadeConfirmar}
                                          onChange={(e) => setQuantidadeConfirmar(e.target.value)}
                                          onKeyDown={(e) => { if (e.key === "Enter") handleConfirmarRecebimento(item.id); }}
                                        />
                                        <Button size="sm" className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700" disabled={confirmarRecebimentoMutation.isPending} onClick={() => handleConfirmarRecebimento(item.id)}>
                                          Confirmar
                                        </Button>
                                        <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => { setConfirmandoItemId(null); setQuantidadeConfirmar(""); }}>
                                          Cancelar
                                        </Button>
                                      </div>
                                    )}
                                    {editando && (
                                      <div className="space-y-1.5 min-w-[180px]" onClick={(e) => e.stopPropagation()}>
                                        {!dentroDaTolerancia && (
                                          <textarea
                                            autoFocus
                                            className="w-full min-h-[50px] px-2 py-1 rounded-md border border-amber-300 bg-white text-[11px] resize-y"
                                            placeholder="Diferença > 5% — explique se é aceitável ou se tem algo errado..."
                                            value={textoJustificativaItem}
                                            onChange={(e) => setTextoJustificativaItem(e.target.value)}
                                          />
                                        )}
                                        <div className="flex gap-1">
                                          <Button size="sm" className="h-6 text-[10px] px-2 bg-green-600 hover:bg-green-700" onClick={() => handleEncerrarItem(item.id)}>
                                            Confirmar
                                          </Button>
                                          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-2" onClick={() => setEditandoItemId(null)}>
                                            Cancelar
                                          </Button>
                                        </div>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </Card>
      </div>

      {/* ─── Edição de pedido (administrador) ───────────────────────────────── */}
      <Dialog open={!!edicaoPedido} onOpenChange={(v) => { if (!v && !editarPedidoMutation.isPending) setEdicaoPedido(null); }}>
        <DialogContent className="w-[96vw] max-w-5xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Edit2 className="w-5 h-5 text-accent" /> Editar pedido {edicaoPedido?.numeroPedido}</DialogTitle>
            <DialogDescription>
              Corrija os dados do pedido e dos itens. Pra desfazer um recebimento marcado por engano, ajuste a coluna "Recebido"
              (0 volta o item pra pendente) — o status do item e do pedido é refeito sozinho.
            </DialogDescription>
          </DialogHeader>
          {edicaoPedido && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Nº do Pedido *</label>
                  <Input value={edicaoPedido.numeroPedido} onChange={e => setEdicaoPedido((prev: any) => ({ ...prev, numeroPedido: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Fornecedor</label>
                  <Input value={edicaoPedido.fornecedorNome} onChange={e => setEdicaoPedido((prev: any) => ({ ...prev, fornecedorNome: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Obra</label>
                  <Input value={edicaoPedido.obraNome} onChange={e => setEdicaoPedido((prev: any) => ({ ...prev, obraNome: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold uppercase text-muted-foreground">Entrega Prevista</label>
                  <Input placeholder="DD/MM/AAAA" value={edicaoPedido.dataEntregaPrevista} onChange={e => setEdicaoPedido((prev: any) => ({ ...prev, dataEntregaPrevista: e.target.value }))} />
                </div>
              </div>

              <div className="border rounded-lg overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50 text-muted-foreground uppercase font-bold">
                    <tr>
                      <th className="p-2 text-left">Tipo</th>
                      <th className="p-2 text-left">Bitola</th>
                      <th className="p-2 text-left">Aço</th>
                      <th className="p-2 text-left">Compr. (mm)</th>
                      <th className="p-2 text-left">Qtd Pedida</th>
                      <th className="p-2 text-left bg-amber-50 text-amber-800">Recebido</th>
                      <th className="p-2 text-left">Peso (kg)</th>
                      <th className="p-2 text-left">Valor Unit.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {edicaoPedido.itens.map((item: any) => {
                      const recebidoMudou = String(item.quantidadeRecebida).trim() !== String(item.recebidaOriginal);
                      return (
                        <tr key={item.id}>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[70px]" value={item.tipo} onChange={e => atualizarItemEdicao(item.id, "tipo", e.target.value)} /></td>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[90px]" value={item.bitola} onChange={e => atualizarItemEdicao(item.id, "bitola", e.target.value)} /></td>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[80px]" value={item.aco} onChange={e => atualizarItemEdicao(item.id, "aco", e.target.value)} /></td>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[70px]" type="number" value={item.comprimento} onChange={e => atualizarItemEdicao(item.id, "comprimento", e.target.value)} /></td>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[60px]" type="number" value={item.quantidadePecas} onChange={e => atualizarItemEdicao(item.id, "quantidadePecas", e.target.value)} /></td>
                          <td className="p-1.5 bg-amber-50/60">
                            <Input className={`h-7 text-xs min-w-[60px] ${recebidoMudou ? "border-amber-500 font-bold" : ""}`} type="number" min={0} value={item.quantidadeRecebida} onChange={e => atualizarItemEdicao(item.id, "quantidadeRecebida", e.target.value)} />
                            {recebidoMudou && <div className="mt-0.5 text-[10px] text-amber-800">era {item.recebidaOriginal}</div>}
                          </td>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[70px]" type="number" value={item.pesoTotal} onChange={e => atualizarItemEdicao(item.id, "pesoTotal", e.target.value)} /></td>
                          <td className="p-1.5"><Input className="h-7 text-xs min-w-[70px]" type="number" value={item.valorUnitario} onChange={e => atualizarItemEdicao(item.id, "valorUnitario", e.target.value)} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Mudar o "Recebido" substitui o histórico de entregas daquele item por um lançamento único com o valor corrigido e reabre o item se ele tinha sido encerrado manualmente.
                O estoque de materiais não é alterado por aqui.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={editarPedidoMutation.isPending} onClick={() => setEdicaoPedido(null)}>Cancelar</Button>
            <Button onClick={handleSalvarEdicaoPedido} disabled={editarPedidoMutation.isPending} className="gap-2 bg-accent hover:bg-accent/90">
              {editarPedidoMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {editarPedidoMutation.isPending ? "Salvando..." : "Salvar alterações"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StockDashboardLayout>
  );
}
