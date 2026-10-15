import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useLocation, useRoute } from "wouter";
import {
  ArrowLeft,
  ArrowDownCircle,
  ArrowUpCircle,
  FileText,
  ClipboardList,
  Edit2,
  Calendar,
  User,
  MapPin,
  Loader2,
  Search,
  Download,
  MoreHorizontal,
  ChevronDown,
  Clock3,
  PackageCheck,
  Hash,
  QrCode,
  Layers,
  X,
} from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useEffect, useMemo, useRef, useState } from "react";

type EventoTipo = "entrada" | "saida" | "grd" | "relatorio" | "edicao" | "requisicao";
type FiltroTipo = EventoTipo | "todos";

interface EventoTimeline {
  tipo: EventoTipo;
  data: string | Date;
  titulo: string;
  descricao: string;
  usuarioNome?: string | null;
  metadados?: string[];
}

const EVENTO_CONFIG: Record<EventoTipo, {
  label: string;
  shortLabel: string;
  border: string;
  bg: string;
  text: string;
  dot: string;
}> = {
  entrada: {
    label: "Entradas",
    shortLabel: "Recebimento",
    border: "border-emerald-500",
    bg: "bg-emerald-50/40",
    text: "text-emerald-700",
    dot: "bg-emerald-500 ring-emerald-500",
  },
  saida: {
    label: "Saídas",
    shortLabel: "Movimentação",
    border: "border-orange-500",
    bg: "bg-orange-50/40",
    text: "text-orange-700",
    dot: "bg-orange-500 ring-orange-500",
  },
  grd: {
    label: "Documentos",
    shortLabel: "Documento",
    border: "border-blue-500",
    bg: "bg-blue-50/40",
    text: "text-blue-700",
    dot: "bg-blue-500 ring-blue-500",
  },
  relatorio: {
    label: "Relatórios",
    shortLabel: "Conferência",
    border: "border-amber-500",
    bg: "bg-amber-50/40",
    text: "text-amber-700",
    dot: "bg-amber-500 ring-amber-500",
  },
  edicao: {
    label: "Edições",
    shortLabel: "Auditoria",
    border: "border-violet-500",
    bg: "bg-violet-50/40",
    text: "text-violet-700",
    dot: "bg-violet-500 ring-violet-500",
  },
  requisicao: {
    label: "Separação p/ produção",
    shortLabel: "Requisição",
    border: "border-indigo-500",
    bg: "bg-indigo-50/40",
    text: "text-indigo-700",
    dot: "bg-indigo-500 ring-indigo-500",
  },
};

const STATUS_REQUISICAO_TEXTO: Record<string, string> = {
  em_separacao: "em separação",
  aguardando_aprovacao: "aguardando aprovação do ADM",
  aprovada: "aprovada — baixa realizada",
  rejeitada: "rejeitada pelo ADM",
  cancelada: "cancelada",
};

const ICONES_EVENTO: Record<EventoTipo, typeof FileText> = {
  entrada: ArrowDownCircle,
  saida: ArrowUpCircle,
  grd: FileText,
  relatorio: ClipboardList,
  edicao: Edit2,
  requisicao: QrCode,
};

const STORAGE_BUSCA = "linhaDoTempo.busca";

// ?q= do endereço tem prioridade; senão, a última busca desta aba
function lerBuscaSalva(): string {
  const daUrl = new URLSearchParams(window.location.search).get("q");
  if (daUrl !== null) return daUrl;

  return lerBuscaSalvaDaSessao();
}

function lerBuscaSalvaDaSessao(): string {
  try {
    return sessionStorage.getItem(STORAGE_BUSCA) ?? "";
  } catch {
    return "";
  }
}

function salvarBusca(termo: string) {
  try {
    sessionStorage.setItem(STORAGE_BUSCA, termo);
  } catch {
    // sem armazenamento: a busca só não é lembrada
  }
}

const ROTULO_SUGESTAO: Record<string, string> = {
  perfil: "Perfil",
  bitola: "Bitola",
  corrida: "Corrida",
  nf: "NF",
  aco: "Aço",
};

interface Sugestao {
  tipo: string;
  valor: string;
  total: number;
}

// Campo de busca com sugestões do cadastro enquanto digita
function BuscaComSugestoes({ valor, onChange }: { valor: string; onChange: (valor: string) => void }) {
  const [aberto, setAberto] = useState(false);
  const [destaque, setDestaque] = useState(-1);
  const [termoSugestao, setTermoSugestao] = useState(valor.trim());
  const caixaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setTermoSugestao(valor.trim()), 200);
    return () => clearTimeout(timer);
  }, [valor]);

  useEffect(() => {
    const fechar = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) setAberto(false);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, []);

  const { data: sugestoes } = trpc.materiais.sugestoesLinhaDoTempo.useQuery(
    { termo: termoSugestao },
    { enabled: termoSugestao.length >= 2, staleTime: 30_000, placeholderData: (anterior) => anterior }
  );

  // Não sugere exatamente o que já está digitado
  const lista: Sugestao[] = (sugestoes ?? []).filter(
    (s: Sugestao) => s.valor.toLowerCase() !== valor.trim().toLowerCase()
  );

  useEffect(() => setDestaque(-1), [sugestoes]);

  const escolher = (sugestao: Sugestao) => {
    onChange(sugestao.valor);
    setAberto(false);
  };

  const mostrar = aberto && valor.trim().length >= 2 && lista.length > 0;

  return (
    <div ref={caixaRef} className="relative w-full max-w-md">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        autoFocus
        placeholder="Perfil, bitola, aço, NF ou corrida..."
        className="pl-9 pr-9"
        value={valor}
        onChange={(e) => {
          onChange(e.target.value);
          setAberto(true);
        }}
        onFocus={() => setAberto(true)}
        onKeyDown={(e) => {
          if (!mostrar) return;

          if (e.key === "ArrowDown") {
            e.preventDefault();
            setDestaque((i) => (i + 1) % lista.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setDestaque((i) => (i <= 0 ? lista.length - 1 : i - 1));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (destaque >= 0) escolher(lista[destaque]);
            else setAberto(false);
          } else if (e.key === "Escape") {
            setAberto(false);
          }
        }}
      />
      {valor && (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => { onChange(""); setAberto(false); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {mostrar && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border bg-card shadow-xl">
          {lista.map((sugestao, indice) => (
            <button
              key={`${sugestao.tipo}-${sugestao.valor}`}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => escolher(sugestao)}
              onMouseEnter={() => setDestaque(indice)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm ${indice === destaque ? "bg-muted" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-14 shrink-0 text-[10px] font-bold uppercase text-muted-foreground">
                  {ROTULO_SUGESTAO[sugestao.tipo] ?? sugestao.tipo}
                </span>
                <span className="truncate font-medium">{sugestao.valor}</span>
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {sugestao.total} {sugestao.total === 1 ? "cadastro" : "cadastros"}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function formatarData(data: string | Date) {
  return format(new Date(data), "dd/MM/yyyy", { locale: ptBR });
}

function formatarHora(data: string | Date) {
  return format(new Date(data), "HH:mm", { locale: ptBR });
}

export default function LinhaDoTempoMaterial() {
  const [, params] = useRoute("/linha-do-tempo/:id");
  const [, navigate] = useLocation();
  const materialId = params?.id ? parseInt(params.id) : 0;

  const { data, isLoading } = trpc.materiais.linhaDoTempo.useQuery(
    { materialId },
    { enabled: materialId > 0 }
  );
  const { data: pacote } = trpc.materiais.pacote.useQuery(
    { materialId },
    { enabled: materialId > 0, retry: false }
  );
  // A busca sobrevive à ida pra linha do tempo de um material e à volta
  const [termoBusca, setTermoBusca] = useState(lerBuscaSalva);
  const [termoDebounced, setTermoDebounced] = useState(termoBusca.trim());
  const [filtroAtivo, setFiltroAtivo] = useState<FiltroTipo>("todos");
  const [ordemAscendente, setOrdemAscendente] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTermoDebounced(termoBusca.trim()), 300);
    return () => clearTimeout(timer);
  }, [termoBusca]);

  useEffect(() => {
    if (materialId > 0) return;

    salvarBusca(termoBusca);

    // Endereço com ?q= — o "voltar" do navegador também volta pra busca
    const url = termoBusca.trim() ? `/linha-do-tempo?q=${encodeURIComponent(termoBusca.trim())}` : "/linha-do-tempo";
    if (window.location.pathname + window.location.search !== url) {
      window.history.replaceState(window.history.state, "", url);
    }
  }, [termoBusca, materialId]);

  const { data: resultadosBusca, isLoading: buscando } = trpc.materiais.buscarParaLinhaDoTempo.useQuery(
    { termo: termoDebounced },
    { enabled: materialId === 0 && termoDebounced.length >= 2, placeholderData: (anterior) => anterior }
  );

  const buscarMesmaBitola = (bitola: string) => {
    salvarBusca(bitola);
    navigate(`/linha-do-tempo?q=${encodeURIComponent(bitola)}`);
  };

  const eventos = useMemo<EventoTimeline[]>(() => {
    if (!data) return [];
    const lista: EventoTimeline[] = [];

    (data.entradas || []).forEach((e: any) => {
      lista.push({
        tipo: "entrada",
        data: e.dataEntrada,
        titulo: "Entrada no estoque",
        descricao: `${e.tipo} ${e.bitola} — ${e.aco} · Corrida ${e.corrida || "-"} · Local: ${e.local || "-"} · NF ${e.nf || "-"} · Fornecedor: ${e.fornecedor || "-"}${e.obraCompraNome ? ` · Comprado p/ ${e.obraCompraNome}` : ""}`,
        usuarioNome: e.usuarioNome,
        metadados: [e.local ? `Local ${e.local}` : "Local não informado", e.nf ? `NF ${e.nf}` : "NF não informada"],
      });
    });

    // Saída gerada pela aprovação de uma requisição de produção (QR code)
    const requisicoesAprovadas = new Set(
      ((data as any).requisicoes || [])
        .filter((r: any) => r.status === "aprovada")
        .map((r: any) => r.numero)
    );

    (data.saidas || []).forEach((s: any) => {
      const viaRequisicao = !!s.numeroRequisicao && requisicoesAprovadas.has(s.numeroRequisicao);

      lista.push({
        tipo: "saida",
        data: s.dataSaida,
        titulo: viaRequisicao ? "Baixa por requisição de produção (aprovada pelo ADM)" : "Saída do estoque",
        descricao: `${s.quantidade} unid. — Destino: ${s.obraNome || "LIVRE"}${s.corrida ? ` · Corrida: ${s.corrida}` : ""}${s.local ? ` · Local: ${s.local}` : ""}${s.numeroRequisicao ? ` · Requisição: ${s.numeroRequisicao}` : ""}${s.motivo ? ` · Motivo: ${s.motivo}` : ""}`,
        usuarioNome: s.usuarioNome,
        metadados: [s.obraNome ? `Destino ${s.obraNome}` : "Destino livre", s.numeroRequisicao ? `Req. ${s.numeroRequisicao}` : "Baixa de estoque"],
      });
    });

    (data.grds || []).forEach((g: any) => {
      lista.push({
        tipo: "grd",
        data: g.createdAt,
        titulo: `GRD ${g.numero}`,
        descricao: `Material incluído na Guia de Remessa de Documentos para a obra ${g.obra}${g.cliente ? `, cliente ${g.cliente}` : ""}.`,
        usuarioNome: g.usuarioNome,
        metadados: [g.obra ? `Obra ${g.obra}` : "Obra não informada", g.cliente ? `Cliente ${g.cliente}` : "Cliente não informado"],
      });
    });

    (data.relatorios || []).forEach((r: any) => {
      lista.push({
        tipo: "relatorio",
        data: r.createdAt,
        titulo: `Relatório de Recebimento REL-${String(r.relatorioId).padStart(5, "0")}`,
        descricao: "Material incluído neste relatório de recebimento e conferência.",
        usuarioNome: r.usuarioNome,
        metadados: ["Recebimento conferido"],
      });
    });

    ((data as any).requisicoes || []).forEach((r: any) => {
      lista.push({
        tipo: "requisicao",
        data: r.createdAt,
        titulo: `Separado para produção — Requisição ${r.numero}`,
        descricao: `${r.quantidade} unid. separadas por leitura de QR code para ${r.obraNome} · Etapa: ${r.etapa}. Situação: ${STATUS_REQUISICAO_TEXTO[r.status] ?? r.status}${r.usuarioAprovacao && (r.status === "aprovada" || r.status === "rejeitada") ? ` por ${r.usuarioAprovacao}` : ""}${r.status === "rejeitada" && r.motivoRejeicao ? ` · Motivo: ${r.motivoRejeicao}` : ""}.`,
        usuarioNome: r.usuarioNome,
        metadados: [`Req. ${r.numero}`, STATUS_REQUISICAO_TEXTO[r.status] ?? r.status],
      });
    });

    (data.edicoes || []).forEach((ed: any) => {
      lista.push({
        tipo: "edicao",
        data: ed.dataHora,
        titulo: "Edição do cadastro",
        descricao: ed.detalhes,
        usuarioNome: ed.usuarioNome,
        metadados: ["Alteração registrada na auditoria"],
      });
    });

    return lista.sort((a, b) => {
      const diferenca = new Date(b.data).getTime() - new Date(a.data).getTime();
      return ordemAscendente ? -diferenca : diferenca;
    });
  }, [data, ordemAscendente]);

  const material = data?.material;
  const eventosFiltrados = filtroAtivo === "todos"
    ? eventos
    : eventos.filter((evento) => evento.tipo === filtroAtivo);
  const totalPorTipo = (tipo: FiltroTipo) => tipo === "todos"
    ? eventos.length
    : eventos.filter((evento) => evento.tipo === tipo).length;

  const exportarHistorico = () => {
    if (!material || eventos.length === 0) return;
    const linhas = [
      `Linha do tempo — ${material.tipo} ${material.bitola}`,
      `Aço: ${material.aco || "-"} | Corrida: ${material.corrida || "-"} | NF: ${material.nf || "-"}`,
      "",
      ...eventos.map((evento) => `${formatarData(evento.data)} ${formatarHora(evento.data)} — ${evento.titulo} — ${evento.descricao}`),
    ];
    const blob = new Blob([linhas.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `linha-do-tempo-${material.id}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <StockDashboardLayout>
      <div className="mx-auto max-w-[1250px] space-y-6 pb-10">
        <div className="text-xs font-semibold text-muted-foreground">
          Rastreabilidade <span className="mx-1">/</span> Materiais <span className="mx-1">/</span> Linha do tempo
        </div>

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="mt-0.5 shrink-0"
              onClick={() => {
                if (materialId === 0) return navigate("/materiais");
                // Volta pra busca como estava
                const busca = lerBuscaSalvaDaSessao();
                navigate(busca ? `/linha-do-tempo?q=${encodeURIComponent(busca)}` : "/linha-do-tempo");
              }}
              aria-label="Voltar"
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h2 className="text-2xl font-bold tracking-tight md:text-[29px]">Linha do tempo do material</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {materialId > 0
                  ? "Um rastro completo, legível e auditável — da entrada à última movimentação."
                  : "Busque qualquer material, mesmo que já tenha saído do estoque."}
              </p>
            </div>
          </div>
          {materialId > 0 && material && (
            <div className="hidden gap-2 md:flex">
              <Button variant="outline" className="gap-2" onClick={exportarHistorico}>
                <Download className="h-4 w-4" /> Exportar histórico
              </Button>
              <Button className="gap-2" onClick={() => navigate(`/materiais?editar=${material.id}`)}>
                <Edit2 className="h-4 w-4" /> Editar material
              </Button>
            </div>
          )}
        </div>

        {materialId === 0 ? (
          <Card className="p-5">
            <BuscaComSugestoes valor={termoBusca} onChange={setTermoBusca} />
            <div className="mt-4">
              {termoBusca.trim().length < 2 ? (
                <p className="text-sm text-muted-foreground">Digite ao menos 2 caracteres para buscar — incluindo materiais que já saíram do estoque. Dá pra combinar palavras, ex.: "W 200 A572".</p>
              ) : buscando && !resultadosBusca ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Buscando...</div>
              ) : !resultadosBusca || resultadosBusca.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum material encontrado com esse termo.</p>
              ) : (
                <>
                <p className="mb-2 text-xs text-muted-foreground">
                  {resultadosBusca.length === 50 ? "Mostrando os 50 primeiros — refine a busca." : `${resultadosBusca.length} ${resultadosBusca.length === 1 ? "material encontrado" : "materiais encontrados"}`}
                </p>
                <div className="divide-y overflow-hidden rounded-lg border">
                  {resultadosBusca.map((m: any) => (
                    <a
                      key={m.id}
                      href={`/linha-do-tempo/${m.id}`}
                      onClick={(e) => {
                        // Navegação interna — mantém a busca; Ctrl/clique do meio abre em outra aba normalmente
                        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                        e.preventDefault();
                        navigate(`/linha-do-tempo/${m.id}`);
                      }}
                      className="flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {m.tipo} {m.bitola} — {m.aco}
                          {!m.ativo && <span className="rounded-full bg-muted px-2 py-0.5 text-[9px] font-bold uppercase text-muted-foreground">Fora do estoque</span>}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {m.obraNome || "LIVRE"}{m.local ? ` · ${m.local}` : ""}</span>
                          <span>{m.quantidade} pç · {m.categoria === "CHAPA" ? `${m.largura || 0}×${m.comprimento || 0}` : m.comprimento} mm</span>
                          {m.corrida && <span className="font-medium">Corrida {m.corrida}</span>}
                          {m.nf && <span>NF {m.nf}</span>}
                        </div>
                      </div>
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </a>
                  ))}
                </div>
                </>
              )}
            </div>
          </Card>
        ) : isLoading ? (
          <Card className="flex items-center justify-center gap-2 p-8 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico...</Card>
        ) : !material ? (
          <Card className="p-8 text-center text-muted-foreground">Material não encontrado.</Card>
        ) : (
          <>
            <Card className="p-5 shadow-sm md:p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-bold tracking-tight">{material.tipo} {material.bitola}</h3>
                    <span className="rounded-full border border-[#ead9a2] bg-[#fff8e5] px-2.5 py-1 text-[10px] font-bold uppercase text-[#9b7412]">{material.aco}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${material.ativo ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
                      {material.ativo ? "● Ativo no estoque" : "Não está mais no estoque"}
                    </span>
                  </div>
                  {/* Atalho pra comparar com outros perfis da mesma bitola */}
                  <button
                    type="button"
                    onClick={() => buscarMesmaBitola(material.bitola)}
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900"
                  >
                    <Search className="h-3.5 w-3.5" /> Buscar outros com bitola {material.bitola}
                  </button>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> <strong className="text-foreground">{material.obraNome || "LIVRE"}</strong> · Local: <strong className="text-foreground">{material.local || "não informado"}</strong></span>
                    {material.corrida && <span className="flex items-center gap-1"><Hash className="h-3.5 w-3.5" /> Corrida: <strong className="text-foreground">{material.corrida}</strong></span>}
                    {material.nf && <span>NF: <strong className="text-foreground">{material.nf}</strong></span>}
                    {material.obraCompraNome && <span>Comprado p/ <strong className="text-foreground">{material.obraCompraNome}</strong></span>}
                  </div>
                </div>
                <Button variant="outline" size="icon" aria-label="Mais ações"><MoreHorizontal className="h-4 w-4" /></Button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-4 border-t pt-4 md:grid-cols-4">
                <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Quantidade atual</div><div className="mt-1 font-bold">{material.quantidade || 0} barras</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Peso total</div><div className="mt-1 font-bold">{material.pesoTotal || "0"} kg</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Comprimento</div><div className="mt-1 font-bold">{material.comprimento || 0} mm</div></div>
                <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Último evento</div><div className="mt-1 font-bold">{eventos[0] ? formatarData(eventos[0].data) : "—"}</div></div>
              </div>
            </Card>

            {/* Pacote: mesmo perfil, corrida e NF — pode estar dividido em vários cadastros */}
            {pacote && (
              <Card className="p-5 shadow-sm md:p-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold"><Layers className="h-4 w-4" /> Pacote</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Mesmo perfil, corrida e NF em estoque{material.corrida ? ` · Corrida ${material.corrida}` : ""}{material.nf ? ` · NF ${material.nf}` : ""}
                    </p>
                  </div>
                  {pacote.grds.length > 0 && (
                    <span className="rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-700">
                      GRD {pacote.grds.join(", ")}
                    </span>
                  )}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Peças no pacote</div><div className="mt-1 font-bold">{pacote.totalPecas} pç</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Cadastros</div><div className="mt-1 font-bold">{pacote.cadastros.length}</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Reservado p/ produção</div><div className={`mt-1 font-bold ${pacote.reservado > 0 ? "text-amber-700" : ""}`}>{pacote.reservado} pç</div></div>
                  <div><div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Obra da compra</div><div className="mt-1 truncate font-bold">{material.obraCompraNome || "—"}</div></div>
                </div>

                {pacote.cadastros.length > 1 && (
                  <div className="mt-4 divide-y overflow-hidden rounded-lg border">
                    {pacote.cadastros.map((c: any) => {
                      const atual = c.id === material.id;
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={atual}
                          onClick={() => navigate(`/linha-do-tempo/${c.id}`)}
                          className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors ${atual ? "bg-muted/40" : "hover:bg-muted/40"}`}
                        >
                          <span className="min-w-0">
                            <strong className="text-foreground">Código {c.id}</strong>
                            {atual && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-700">Este</span>}
                            <span className="block truncate text-muted-foreground">
                              {c.categoria === "CHAPA" ? `${c.largura || 0}×${c.comprimento || 0} mm` : `${c.comprimento || 0} mm`} · {c.obraNome || "LIVRE"}{c.local ? ` · ${c.local}` : ""}
                            </span>
                          </span>
                          <strong className="shrink-0">{c.quantidade} pç</strong>
                        </button>
                      );
                    })}
                  </div>
                )}
              </Card>
            )}

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_245px]">
              <Card className="overflow-hidden shadow-sm">
                <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
                  <div><h3 className="text-sm font-bold">Histórico do material</h3><span className="text-xs text-muted-foreground">{eventos.length} eventos registrados</span></div>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOrdemAscendente((valor) => !valor)}>
                    {ordemAscendente ? "Mais antigos" : "Mais recentes"}<ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="p-4 md:p-6">
                  {eventosFiltrados.length === 0 ? (
                    <div className="py-10 text-center text-sm text-muted-foreground">Nenhum evento encontrado para este filtro.</div>
                  ) : (
                    <div className="space-y-0">
                      {eventosFiltrados.map((evento, index) => {
                        const config = EVENTO_CONFIG[evento.tipo];
                        const Icone = ICONES_EVENTO[evento.tipo];
                        return (
                          <div key={`${evento.tipo}-${evento.data}-${index}`} className="grid min-h-[124px] grid-cols-[62px_22px_minmax(0,1fr)] gap-3 md:grid-cols-[82px_24px_minmax(0,1fr)] md:gap-4">
                            <div className="pt-1 text-right text-[11px] leading-4 text-muted-foreground"><strong className="block text-xs text-foreground">{formatarData(evento.data)}</strong>{formatarHora(evento.data)}</div>
                            <div className="relative flex justify-center"><span className={`relative z-[1] mt-1 h-3.5 w-3.5 rounded-full border-[3px] border-white ring-2 ${config.dot}`} />{index < eventosFiltrados.length - 1 && <span className="absolute top-4 bottom-0 w-0.5 bg-border" />}</div>
                            <div className={`mb-4 rounded-xl border border-border border-l-4 p-3.5 ${config.border} ${config.bg}`}>
                              <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-2"><Icone className={`h-4 w-4 shrink-0 ${config.text}`} /><strong className="text-sm">{evento.titulo}</strong></div><span className={`shrink-0 text-[10px] font-bold uppercase tracking-wide ${config.text}`}>{config.shortLabel}</span></div>
                              <p className="mt-2 text-xs leading-5 text-foreground/80">{evento.descricao}</p>
                              <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">{evento.usuarioNome && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {evento.usuarioNome}</span>}{(evento.metadados || []).map((meta) => <span key={meta} className="flex items-center gap-1"><PackageCheck className="h-3 w-3" /> {meta}</span>)}</div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </Card>

              <Card className="h-fit p-5 shadow-sm">
                <h3 className="text-sm font-bold">Filtrar eventos</h3>
                <div className="mt-3 divide-y">
                  {(["todos", "grd", "entrada", "requisicao", "saida", "relatorio", "edicao"] as FiltroTipo[]).map((tipo) => {
                    const selecionado = filtroAtivo === tipo;
                    const config = tipo === "todos" ? null : EVENTO_CONFIG[tipo];
                    return <button key={tipo} type="button" onClick={() => setFiltroAtivo(tipo)} className={`flex w-full items-center justify-between py-2.5 text-left text-xs transition-colors ${selecionado ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}><span className="flex items-center gap-2">{tipo === "todos" ? <span className="h-3.5 w-0.5 rounded bg-emerald-500" /> : <span className={`h-3.5 w-0.5 rounded ${config?.dot.split(" ")[0]}`} />}{tipo === "todos" ? "Todos" : config?.label}</span><strong>{totalPorTipo(tipo)}</strong></button>;
                  })}
                </div>
                <div className="mt-5 border-t pt-4"><h3 className="text-sm font-bold">Legenda</h3><p className="mt-2 text-[11px] leading-5 text-muted-foreground"><span className="mr-1.5 text-blue-600">●</span> GRDs e documentos gerados<br /><span className="mr-1.5 text-emerald-600">●</span> Entradas e recebimentos<br /><span className="mr-1.5 text-indigo-600">●</span> Separações para produção (QR code)<br /><span className="mr-1.5 text-orange-600">●</span> Saídas e baixas de estoque<br /><span className="mr-1.5 text-violet-600">●</span> Alterações e auditoria</p></div>
                <div className="mt-5 flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> Ordenado por data e hora</div>
              </Card>
            </div>
          </>
        )}
      </div>
    </StockDashboardLayout>
  );
}
