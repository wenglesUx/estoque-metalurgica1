import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Plus, Edit2, Trash2, Search, ArrowRightLeft, ChevronDown,
  FileCode, X, Calculator, CheckCircle2, AlertCircle,
  FileText, Square, CheckSquare, Download, PackageMinus, Tag,
  Layers, Maximize2, ChevronLeft, ChevronRight, Eye, FileDown,
  MoreHorizontal, SlidersHorizontal, ArrowUpDown, Image as ImageIcon, Briefcase,
  FlaskConical, Undo2, QrCode
} from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { PrintDialog } from "@/modules/labels/components/PrintDialog";
import { XmlItemRow } from "@/components/XmlItemRow";
import { FiltroMaterialBar } from "@/components/FiltroMaterialBar";
import { useFiltroMaterial } from "@/hooks/useFiltroMaterial";
import { RelatorioRecebimentoForm } from "@/components/RelatorioRecebimentoForm";
import { RelatoriosRecebimentoSalvos } from "@/components/RelatoriosRecebimentoSalvos";
import {
  type DadosRelatorio, type FotoRelatorio,
  agruparItensEmCargas, comprimirImagemRecebimento, gerarPdfRecebimento,
  numeroDocumentoRelatorio, pesoDosItens, validarDadosRelatorio,
} from "@/lib/relatorioRecebimento";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

import ExcelJS from "exceljs";

// ─── Constantes ────────────────────────────────────────────────────────────────
const PAGE_SIZE = 50;

function parsePtBrNumber(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "");
  if (!normalized) return null;
  const normalizedNumber = normalized.includes(",")
    ? normalized.replace(/\./g, "").replace(",", ".")
    : normalized;
  const numberValue = Number(normalizedNumber);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatKg(value: number, digits = 2): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

// Uma NF-e carregada na tela de importação por XML, ainda em edição. Pedido e
// local de descarga são da nota — valem pra todos os itens dela ao salvar.
type NotaXml = {
  id: string;
  nf: string;
  fornecedor: string;
  itens: any[];
  pesoOriginal: number;
  pedido: string;
  local: string;
};

// Nota já salva no banco (itens com id), aguardando GRD/Relatório opcionais.
type NotaSalvaXml = Omit<NotaXml, "local"> & { grdGerada: boolean };

const chaveNotaXml = (nf: unknown, fornecedor: unknown) =>
  `${String(nf || "").trim().toUpperCase()}|${String(fornecedor || "").trim().toUpperCase()}`;

const pesoItensXml = (itens: any[]) =>
  itens.reduce((s: number, it: any) => s + (parseFloat(String(it.pesoTotal)) || 0), 0);

const lerArquivoComoTexto = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsText(file);
  });


// ─── Tipos ─────────────────────────────────────────────────────────────────────
interface FormData {
  tipo: string; bitola: string; aco: string;
  quantidade: number; comprimento: number; largura: number;
  categoria: string;
  local: string; rua: string; vao: string; obraId: number | undefined; obraNome: string;
  fornecedor: string; nf: string; numeroCertificado: string; corrida: string;
  estoqueMinimo: number;
  observacoes: string; numeroPedido: string;
}
const emptyForm = (categoria: string = "PERFIL"): FormData => ({
  tipo: "", bitola: "", aco: "", quantidade: 1, comprimento: 0, largura: 0,
  categoria,
  local: "", rua: "", vao: "", obraId: undefined, obraNome: "", obraCompraId: undefined, obraCompraNome: "",
  fornecedor: "", nf: "", numeroCertificado: "", corrida: "",
  estoqueMinimo: 50,
  observacoes: "", numeroPedido: "",
});

// Mantém fornecedor/NF/local/obra/categoria/aço (contexto do lote) e limpa só os
// campos específicos do item (tipo, bitola, medidas, certificado, corrida) —
// usado pelo botão "Salvar e Cadastrar Outro".
const continuarForm = (anterior: FormData): FormData => ({
  ...emptyForm(anterior.categoria),
  categoria: anterior.categoria,
  aco: anterior.aco,
  local: anterior.local, rua: anterior.rua, vao: anterior.vao,
  obraId: anterior.obraId, obraNome: anterior.obraNome,
  fornecedor: anterior.fornecedor, nf: anterior.nf,
  estoqueMinimo: anterior.estoqueMinimo,
  numeroPedido: anterior.numeroPedido,
});

interface GrdForm {
  numero: string; data: string; cliente: string; obra: string;
}

// ─── Hook: peso calculado via base técnica ──────────────────────────────────────
function usePesoCalculado(
  tipo: string, bitola: string, aco: string,
  quantidade: number, comprimento: number, largura: number, categoria: string, enabled: boolean
) {
  const skip = !enabled || !tipo || !bitola || !aco;
  const { data: spec } = trpc.especificacoes.lookup.useQuery(
    { tipo: tipo.trim().toUpperCase(), bitola: bitola.trim().toUpperCase(), aco: aco.trim().toUpperCase(), categoria },
    { enabled: !skip, staleTime: 30_000 }
  );

  if (skip) return { pesoTotal: null, pesoPorMetro: null, encontrado: false };

  if (categoria === "CHAPA") {
    if (!spec) return { pesoTotal: null, pesoPorMetro: null, encontrado: false };
    if (!largura || !comprimento) return { pesoTotal: null, pesoPorMetro: parseFloat(String(spec.pesoPorMetro)), encontrado: true };
    const pesoPorM2 = parseFloat(String(spec.pesoPorMetro));
    const areaM2 = (largura * comprimento) / 1_000_000;
    const pesoTotal = +(pesoPorM2 * areaM2 * (quantidade || 1)).toFixed(3);
    return { pesoTotal, pesoPorMetro: pesoPorM2, encontrado: true };
  }

  if (!spec) return { pesoTotal: null, pesoPorMetro: null, encontrado: false };
  const pesoPorMetro = parseFloat(String(spec.pesoPorMetro));
  const pesoTotal = +(pesoPorMetro * ((comprimento || 0) / 1000) * (quantidade || 1)).toFixed(3);
  return { pesoTotal, pesoPorMetro, encontrado: true };
}

// ─── Componente: Detalhe do material (popup mobile) ────────────────────────────
function MaterialDetailDialog({ material, open, onOpenChange, obras, onEdit, onDelete, onToggleExcluirRelatorios, togglingExcluir }: {
  material: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  obras: any[];
  onEdit: (m: any) => void;
  onDelete: (id: number) => void;
  onToggleExcluirRelatorios: (m: any) => void;
  togglingExcluir: boolean;
}) {
  if (!material) return null;
  const nomeObraCompleto = material.obraNome && material.obraNome !== "LIVRE"
    ? `${obras?.find((o: any) => o.id === material.obraId)?.codigo ?? ""} — ${material.obraNome}`.replace(/^— /, "")
    : "LIVRE";
  const dimensao = material.categoria === "CHAPA"
    ? `${(material.largura || 0).toLocaleString("pt-BR")} × ${(material.comprimento || 0).toLocaleString("pt-BR")} mm`
    : `${(material.comprimento || 0).toLocaleString("pt-BR")} mm`;
  const pesoFormatado = `${parseFloat(String(material.pesoTotal || 0)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg`;

  const rastreabilidade = [
    { label: "Fornecedor", value: material.fornecedor },
    { label: "NF", value: material.nf },
    { label: "Certificado", value: material.numero_certificado },
    { label: "Corrida", value: material.corrida },
  ].filter(r => r.value);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Sem margem lateral: o modal é centralizado por translate, e uma
          margem empurrava ele pra direita no celular */}
      <DialogContent className="w-[calc(100%-2rem)] max-w-sm sm:max-w-sm md:max-w-sm p-0 gap-0 overflow-hidden">
        <div className="h-1.5 bg-[#d6a21b]" />
        <div className="pl-5 pr-12 pt-4 pb-4 border-b bg-[#f8f6f1]/50">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-lg">{material.tipo} · {material.bitola}</span>
          </div>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {material.aco && (
              <span className="rounded-full bg-[#f8f6f1] border border-[#ead9a2] px-2 py-0.5 text-[10px] font-bold uppercase text-[#9b7412]">{material.aco}</span>
            )}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">{material.categoria || "PERFIL"}</span>
            {material.excluirRelatorios && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase text-red-700">
                <FlaskConical className="w-2.5 h-2.5" /> Fora dos relatórios
              </span>
            )}
          </div>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Grid principal de estatísticas */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card p-2.5">
              <div className="text-[9px] font-bold uppercase text-muted-foreground">Quantidade</div>
              <div className="text-base font-bold mt-0.5">{material.quantidade} <span className="text-xs font-normal text-muted-foreground">PÇ</span></div>
            </div>
            <div className="rounded-lg border bg-card p-2.5">
              <div className="text-[9px] font-bold uppercase text-muted-foreground">{material.categoria === "CHAPA" ? "Dimensões" : "Comprimento"}</div>
              <div className="text-sm font-bold mt-0.5">{dimensao}</div>
            </div>
            <div className="rounded-lg border bg-card p-2.5">
              <div className="text-[9px] font-bold uppercase text-muted-foreground">Peso Total</div>
              <div className="text-sm font-bold mt-0.5">{pesoFormatado}</div>
            </div>
          </div>

          {/* Localização */}
          <div className="rounded-lg border bg-card p-3">
            <div className="text-[9px] font-bold uppercase text-muted-foreground mb-1.5">Localização</div>
            <div className="flex items-center justify-between text-sm">
              <span className="font-semibold">{nomeObraCompleto}</span>
              <span className="text-muted-foreground">{material.local || "—"}</span>
            </div>
            {(!material.obraNome || material.obraNome === "LIVRE") && material.obraCompraNome && (
              <div className="text-[10px] text-amber-700 font-semibold mt-1">Comprado p/ {material.obraCompraNome}</div>
            )}
            {(material.rua || material.vao) && (
              <div className="text-[10px] text-muted-foreground mt-1">Rua/Vão (legado): {[material.rua, material.vao].filter(Boolean).join(" / ")}</div>
            )}
          </div>

          {/* Rastreabilidade */}
          {rastreabilidade.length > 0 && (
            <div className="rounded-lg border bg-card p-3">
              <div className="text-[9px] font-bold uppercase text-muted-foreground mb-2">Rastreabilidade</div>
              <div className="grid grid-cols-2 gap-2.5">
                {rastreabilidade.map(r => (
                  <div key={r.label}>
                    <div className="text-[9px] text-muted-foreground">{r.label}</div>
                    <div className="text-xs font-medium truncate">{r.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex flex-row flex-wrap gap-2 px-5 py-4 border-t bg-muted/20">
          <a href={`/linha-do-tempo/${material.id}`} className="flex-1 min-w-[120px]">
            <Button variant="outline" size="sm" className="w-full"><FileText className="w-3.5 h-3.5 mr-1.5" /> Linha do Tempo</Button>
          </a>
          <PermissionGate permission="materiais:editar"><Button variant="outline" size="sm" className="flex-1" onClick={() => { onOpenChange(false); onEdit(material); }}><Edit2 className="w-3.5 h-3.5 mr-1.5" /> Editar</Button></PermissionGate>
          <PermissionGate permission="materiais:remover"><Button variant="destructive" size="sm" className="flex-1" onClick={() => { onOpenChange(false); onDelete(material.id); }}><Trash2 className="w-3.5 h-3.5 mr-1.5" /> Excluir</Button></PermissionGate>
          <PermissionGate permission="materiais:editar">
            <Button
              variant="outline"
              size="sm"
              className={`w-full ${material.excluirRelatorios ? "text-emerald-700 border-emerald-300 hover:bg-emerald-50" : "text-red-700 border-red-200 hover:bg-red-50"}`}
              disabled={togglingExcluir}
              onClick={() => onToggleExcluirRelatorios(material)}
            >
              {material.excluirRelatorios
                ? <><Undo2 className="w-3.5 h-3.5 mr-1.5" /> Voltar a contar nos relatórios</>
                : <><FlaskConical className="w-3.5 h-3.5 mr-1.5" /> Marcar como teste (excluir dos relatórios)</>}
            </Button>
          </PermissionGate>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente: Paginação ──────────────────────────────────────────────────────
function Paginacao({ page, totalPages, total, pageSize, onChange }: {
  page: number; totalPages: number; total: number; pageSize: number; onChange: (p: number) => void;
}) {
  if (totalPages <= 1) return (
    <div className="px-4 py-2 text-xs text-muted-foreground text-right">
      {total} item(s)
    </div>
  );

  const inicio = (page - 1) * pageSize + 1;
  const fim = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t bg-muted/20 text-sm">
      <span className="text-xs text-muted-foreground">
        Exibindo <strong>{inicio}–{fim}</strong> de <strong>{total}</strong> itens
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onChange(1)} disabled={page === 1} title="Primeira">
          <ChevronLeft className="w-3 h-3" /><ChevronLeft className="w-3 h-3 -ml-2" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onChange(page - 1)} disabled={page === 1}>
          <ChevronLeft className="w-3 h-3" />
        </Button>
        <span className="px-3 py-1 text-xs font-medium bg-background border rounded-md">
          {page} / {totalPages}
        </span>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onChange(page + 1)} disabled={page === totalPages}>
          <ChevronRight className="w-3 h-3" />
        </Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => onChange(totalPages)} disabled={page === totalPages} title="Última">
          <ChevronRight className="w-3 h-3" /><ChevronRight className="w-3 h-3 -ml-2" />
        </Button>
      </div>
    </div>
  );
}

// ─── Componente Principal ───────────────────────────────────────────────────────
export default function Materiais() {
  const { data: materiais, isLoading, refetch } = trpc.materiais.list.useQuery();
  const { data: duplicadosExistentes } = trpc.materiais.listarDuplicados.useQuery();
  const [mostrarDuplicadosExistentes, setMostrarDuplicadosExistentes] = useState(false);
  // Material separado em requisição de produção ainda não aprovada pelo ADM
  const { data: reservasProducao } = trpc.requisicoesProducao.reservas.useQuery(undefined, { retry: false });
  const reservaPorMaterial = useMemo(() => {
    const mapa = new Map<number, { pecas: number; requisicaoId: number; numeros: string[]; aguardandoAdm: boolean }>();
    for (const r of reservasProducao ?? []) {
      const atual = mapa.get(r.materialId) ?? { pecas: 0, requisicaoId: r.requisicaoId, numeros: [], aguardandoAdm: false };
      atual.pecas += r.quantidade;
      if (!atual.numeros.includes(r.numero)) atual.numeros.push(r.numero);
      if (r.status === "aguardando_aprovacao") {
        atual.aguardandoAdm = true;
        atual.requisicaoId = r.requisicaoId;
      }
      mapa.set(r.materialId, atual);
    }
    return mapa;
  }, [reservasProducao]);
  const { data: obras } = trpc.obras.list.useQuery();
  const { data: locaisAtivos } = trpc.locais.listarAtivos.useQuery();
  // Números de pedidos em aberto (Materiais a Chegar) — sugestão pro campo
  // "Nº do Pedido" do cadastro manual, pra reduzir erro de digitação que
  // impede o cruzamento automático de bater.
  const { data: pedidosCompraAbertos } = trpc.pedidosCompra.listar.useQuery();
  const numerosPedidoAbertos = useMemo(
    () => (pedidosCompraAbertos || []).filter((p: any) => p.status !== "recebido" && p.status !== "cancelado").map((p: any) => p.numeroPedido),
    [pedidosCompraAbertos]
  );
  const { data: especificacoes } = trpc.especificacoes.listar.useQuery();
  const { data: currentUser } = trpc.auth.me.useQuery(undefined, { staleTime: 60_000 });
  const isOwner = currentUser?.role === "owner";
  // Editar/excluir relatório de recebimento salvo é só pra administrador (o servidor também barra).
  const podeAdministrarRelatorios = currentUser?.role === "owner" || currentUser?.role === "admin";

  // Helper: exibe "CODIGO — Nome" quando tem obra, "LIVRE" quando não tem
  const nomeObra = (m: any) =>
    m.obraNome && m.obraNome !== "LIVRE"
      ? `${obras?.find((o: any) => o.id === m.obraId)?.codigo ?? ""} — ${m.obraNome}`.replace(/^— /, "")
      : "LIVRE";

  const createMaterial   = trpc.materiais.create.useMutation();
  const salvarRelatorioMutation = trpc.relatoriosRecebimento.criar.useMutation();
  const uploadImagemRecebimentoMutation = trpc.relatoriosRecebimento.uploadImagem.useMutation();
  const utils = trpc.useUtils();
  // Sempre que a lista de materiais muda (cadastro, edição, exclusão, baixa...),
  // a checagem de duplicados precisa ser refeita também — senão o banner de
  // duplicidade fica desatualizado até o usuário recarregar a página manualmente.
  const refetchMateriais = () => {
    refetch();
    utils.materiais.listarDuplicados.invalidate();
  };
  const updateMaterial   = trpc.materiais.update.useMutation();
  const deleteMaterial   = trpc.materiais.delete.useMutation();
  const marcarExclusaoRelatorio = trpc.dashboard.marcarExclusaoRelatorio.useMutation({
    onSuccess: (_data, variables) => {
      toast.success(variables.excluir ? "Material marcado como teste — não vai mais contar no dashboard e relatórios." : "Material voltou a contar no dashboard e relatórios.");
      refetchMateriais();
    },
    onError: () => toast.error("Não foi possível atualizar esse material."),
  });
  const hardDeleteMutation = trpc.materiais.hardDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`${data?.deletados ?? 0} material(is) removido(s) permanentemente.`);
      setModoDeletar(false);
      setSelecionadosDeletar(new Set());
      setConfirmacaoDeletar("");
      setShowConfirmDeletar(false);
      refetchMateriais();
    },
    onError: () => toast.error("Erro ao deletar materiais."),
  });
  const baixaLote        = trpc.materiais.baixaLote.useMutation();
  const mudarObraLote    = trpc.materiais.mudarObraLote.useMutation();
  const processarNfe     = trpc.importacao.processarNfe.useMutation();
  const gerarGrdMutation = trpc.grd.gerar.useMutation();
  const { data: proximoNumeroData } = trpc.grd.proximoNumero.useQuery();

  // ── Estados ─────────────────────────────────────────────────────────────────
  const [showForm, setShowForm]     = useState(false);
  const [editingId, setEditingId]   = useState<number | null>(null);
  const [formData, setFormData]     = useState<FormData>(emptyForm());
  const [mostrarRastreabilidade, setMostrarRastreabilidade] = useState(false);
  // Lote de cadastro manual: itens já "adicionados" localmente (ainda não salvos
  // no banco), com o peso já calculado no momento da adição. Só vão pro banco
  // quando o usuário clicar em "Salvar".
  const [itensLote, setItensLote] = useState<Array<FormData & { pesoCalculadoSnapshot: number | null }>>([]);
  // Índice do item do lote sendo editado (clicado na listinha de pré-cadastro).
  // null = modo "adicionar novo item".
  const [editingLoteIndex, setEditingLoteIndex] = useState<number | null>(null);

  // Tipos e aços conhecidos, derivados das Especificações já cadastradas — separados por categoria
  // pra não misturar tipos de perfil (W, HP...) com os de chapa.
  const tiposConhecidos = useMemo(() => {
    return Array.from(new Set(
      (especificacoes || [])
        .filter(e => (e.categoria || "PERFIL") === (formData.categoria || "PERFIL"))
        .map(e => e.tipo)
    )).sort();
  }, [especificacoes, formData.categoria]);

  const acosConhecidos = useMemo(() => {
    return Array.from(new Set((especificacoes || []).map(e => e.aco))).sort();
  }, [especificacoes]);

  const [openXml, setOpenXml]       = useState(false);
  // Várias NF-e podem ser carregadas de uma vez — cada uma é editada no seu
  // próprio bloco e todas são salvas juntas.
  const [notasXml, setNotasXml]     = useState<NotaXml[]>([]);
  const [notasRecolhidasXml, setNotasRecolhidasXml] = useState<Set<string>>(new Set());
  const [processandoXml, setProcessandoXml] = useState(false);

  const [openSeparar, setOpenSeparar]   = useState(false);
  const [separatingId, setSeparatingId] = useState<number | null>(null);
  const [sepObraId, setSepObraId]       = useState<number | undefined>(undefined);

  
  // ── Paginação ────────────────────────────────────────────────────────────────
  const [page, setPage] = useState(1);

  // ── Mobile: popup detalhes ───────────────────────────────────────────────────
  const [detalheItem, setDetalheItem]   = useState<any>(null);
  const [openDetalhe, setOpenDetalhe]   = useState(false);

  // ── GRD ─────────────────────────────────────────────────────────────────────
  const [modoGrd, setModoGrd]           = useState(false);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [openGrdModal, setOpenGrdModal] = useState(false);
  const [openRelatoriosSalvos, setOpenRelatoriosSalvos] = useState(false);
  const [grdForm, setGrdForm]           = useState<GrdForm>({
    numero: "", data: new Date().toISOString().slice(0, 10),
    cliente: "", obra: ""
  });
  const [certificadosAnexados, setCertificadosAnexados] = useState<File[]>([]);
  // true quando a GRD está sendo gerada a partir da tela de importação de NF-e
  // (em vez da lista de materiais já salvos) — nesse caso, ao confirmar a GRD,
  // o salvamento dos materiais é disparado automaticamente em seguida.
  const [grdOrigemXml, setGrdOrigemXml] = useState(false);
  // Pós-salvamento: depois de confirmar a importação, as notas já salvas ficam
  // aqui pra permitir gerar a GRD de cada nota e/ou um Relatório único da
  // carga (todas as notas) sem precisar salvar de novo.
  const [mostrarPosSalvamento, setMostrarPosSalvamento] = useState(false);
  const [notasSalvasXml, setNotasSalvasXml]             = useState<NotaSalvaXml[]>([]);
  // Nota cuja GRD está sendo gerada agora (a GRD é sempre por nota).
  const [grdNotaXmlId, setGrdNotaXmlId]                 = useState<string | null>(null);
  const notaGrdXml = notasSalvasXml.find(n => n.id === grdNotaXmlId);
  const itensGrdXml = notaGrdXml?.itens || [];
  const [openRelatorioModal, setOpenRelatorioModal]     = useState(false);
  const [relatorioOrigemXml, setRelatorioOrigemXml]     = useState(false);
  // Dados do relatório em preenchimento (uma carga por NF/fornecedor) e as
  // fotos escolhidas pra cada carga, ainda não enviadas.
  const [relatorioDados, setRelatorioDados]             = useState<DadosRelatorio | null>(null);
  const [fotosNovasRelatorio, setFotosNovasRelatorio]   = useState<Record<string, File[]>>({});
  const [gerandoRelatorio, setGerandoRelatorio]         = useState(false);

  // ── Etiqueta ─────────────────────────────────────────────────────────────────
  const [openEtiqueta, setOpenEtiqueta]         = useState(false);
  const [materialEtiqueta, setMaterialEtiqueta] = useState<any>(null);

  // ── Baixa em Lote ────────────────────────────────────────────────────────────
  const [modoBaixa, setModoBaixa]                 = useState(false);
  const [selecionadosBaixa, setSelecionadosBaixa] = useState<Set<number>>(new Set());
  const [openBaixaModal, setOpenBaixaModal]       = useState(false);
  const [obraDestinoBaixa, setObraDestinoBaixa]   = useState("");
  const [motivoBaixa, setMotivoBaixa]             = useState("");
  const [dataBaixa, setDataBaixa]                 = useState(() => new Date().toISOString().slice(0, 10));
  const [numeroRequisicaoBaixa, setNumeroRequisicaoBaixa] = useState("");
  const [quantidadesBaixa, setQuantidadesBaixa]   = useState<Record<number, number>>({});

  // ── Mudar Obra em Lote ──────────────────────────────────────────────────────
  const [modoMudarObra, setModoMudarObra]                 = useState(false);
  const [selecionadosMudarObra, setSelecionadosMudarObra] = useState<Set<number>>(new Set());
  const [openMudarObraModal, setOpenMudarObraModal]       = useState(false);
  const [novaObraIdLote, setNovaObraIdLote]               = useState<number | "">("");


  // ── Solicitar Separar ────────────────────────────────────────────────────────
  const [modoSolicitar, setModoSolicitar]                 = useState(false);  const [selecionadosSolicitar, setSelecionadosSolicitar] = useState<Set<number>>(new Set());
  const [openSolicitarModal, setOpenSolicitarModal]       = useState(false);
  const [observacaoSolicitar, setObservacaoSolicitar]     = useState("");
  const [dataLimiteSolicitar, setDataLimiteSolicitar]     = useState("");
  const [obraDestinoSolicitar, setObraDestinoSolicitar]   = useState<number | undefined>(undefined);
  const [quantidadesSolicitar, setQuantidadesSolicitar]   = useState<Record<number, number>>({});
  const createSolicitacao = trpc.solicitacoes.create.useMutation();

  // ── Relatório de Recebimento ─────────────────────────────────────────────────
  const [modoRelatorio, setModoRelatorio]                 = useState(false);
  const [selecionadosRelatorio, setSelecionadosRelatorio] = useState<Set<number>>(new Set());

  // ── Hard Delete (owner only) ──────────────────────────────────────────────────
  const [modoDeletar, setModoDeletar]                 = useState(false);
  const [selecionadosDeletar, setSelecionadosDeletar] = useState<Set<number>>(new Set());
  const [showConfirmDeletar, setShowConfirmDeletar]   = useState(false);
  const [confirmacaoDeletar, setConfirmacaoDeletar]   = useState("");

  // ── Cálculo dinâmico de peso ─────────────────────────────────────────────────
  const { pesoTotal: pesoCalculado, pesoPorMetro, encontrado: especEncontrada } =
    usePesoCalculado(formData.tipo, formData.bitola, formData.aco,
      formData.quantidade, formData.comprimento, formData.largura, formData.categoria, showForm);

  const mostrarAlertaEspecificacao = (formData.categoria === "PERFIL" || formData.categoria === "CHAPA") && !especEncontrada && formData.tipo && formData.bitola && formData.aco;



   const [filterTipo, setFilterTipo] = useState("");
  const [filterObra, setFilterObra] = useState("");
  const [activeTab, setActiveTab]   = useState("PERFIL");
  const [hideActions, setHideActions] = useState(true);
  const [mostrarRastreabilidadeTabela, setMostrarRastreabilidadeTabela] = useState(false);
  
 const { filtro, setFiltro, resetFiltro, filtrados: filtradosHook, temFiltroAtivo } = useFiltroMaterial(
    activeTab ? (materiais || []).filter(m => (m.categoria || "PERFIL") === activeTab) : (materiais || [])
  );
  const [filterText, setFilterText] = useState(""); // mantido para compatibilidade interna
 
 


  // ── Filtros + paginação ───────────────────────────────────────────────────────
  // filteredMateriais agora vem do hook useFiltroMaterial
  const idsDuplicados = useMemo(() => {
    const set = new Set<number>();
    (duplicadosExistentes || []).forEach((grupo: any) => grupo.ids.forEach((id: number) => set.add(id)));
    return set;
  }, [duplicadosExistentes]);

  const [somenteDuplicados, setSomenteDuplicados] = useState(false);
  const filteredMateriais = somenteDuplicados
    ? filtradosHook.filter(m => idsDuplicados.has(m.id))
    : filtradosHook;

  // ── Ordenação rápida ──────────────────────────────────────────────────────────
  // Botão único que alterna, a cada clique, entre os critérios de organização
  // da tabela. "Padrão" volta à ordem original (como veio do servidor).
  const CRITERIOS_ORDENACAO = [
    { label: "Padrão",             campo: null as null },
    { label: "Tipo de Material",   campo: "tipo" as const },
    { label: "Quantidade",         campo: "quantidade" as const },
    { label: "Local",              campo: "local" as const },
    { label: "Data de Cadastro",   campo: "createdAt" as const },
    { label: "Comprimento",        campo: "comprimento" as const },
    { label: "Peso",               campo: "pesoTotal" as const },
    { label: "Aço",                campo: "aco" as const },
  ];
  const [ordenacaoIndex, setOrdenacaoIndex] = useState(0);
  const criterioOrdenacao = CRITERIOS_ORDENACAO[ordenacaoIndex];
  const alternarOrdenacao = () => {
    setOrdenacaoIndex(i => (i + 1) % CRITERIOS_ORDENACAO.length);
    setPage(1);
  };

  const materiaisOrdenados = useMemo(() => {
    const campo = criterioOrdenacao.campo;
    if (!campo) return filteredMateriais;

    const copia = [...filteredMateriais];
    copia.sort((a: any, b: any) => {
      if (campo === "createdAt") {
        // Mais recentes primeiro — é o que costuma interessar ao consultar por data de cadastro.
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }
      if (campo === "quantidade" || campo === "comprimento") {
        return (Number(a[campo]) || 0) - (Number(b[campo]) || 0);
      }
      if (campo === "pesoTotal") {
        return (parseFloat(String(a.pesoTotal)) || 0) - (parseFloat(String(b.pesoTotal)) || 0);
      }
      return String(a[campo] ?? "").localeCompare(String(b[campo] ?? ""), "pt-BR");
    });
    return copia;
  }, [filteredMateriais, criterioOrdenacao]);

  const tiposUnicos = useMemo(() =>
    Array.from(new Set((materiais || []).filter(m => (m.categoria || "PERFIL") === activeTab).map(m => m.tipo.toUpperCase()))).sort(),
    [materiais, activeTab]);

  const acosUnicos = useMemo(() =>
    Array.from(new Set((materiais || []).filter(m => m.aco).map(m => m.aco!.toUpperCase()))).sort(),
    [materiais]);

  const obrasUnicas = useMemo(() =>
    Array.from(new Set((materiais || []).filter(m => m.obraNome && m.obraNome !== "LIVRE").map(m => m.obraNome!))).sort(),
    [materiais]);

  const fornecedoresUnicos = useMemo(() =>
    Array.from(new Set((materiais || []).filter(m => m.fornecedor).map(m => m.fornecedor!))).sort(),
    [materiais]);

  const totalPages = Math.max(1, Math.ceil(materiaisOrdenados.length / PAGE_SIZE));
  const handleFilterChange = (fn: () => void) => { fn(); setPage(1); };

  const materiaisPagina = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return materiaisOrdenados.slice(start, start + PAGE_SIZE);
  }, [materiaisOrdenados, page]);

  // ── GRD handlers ─────────────────────────────────────────────────────────────
  const toggleModoGrd = () => {
    setModoGrd(v => !v); setSelecionados(new Set());
    if (modoBaixa)    { setModoBaixa(false);    setSelecionadosBaixa(new Set()); }
    if (modoMudarObra) { setModoMudarObra(false); setSelecionadosMudarObra(new Set()); }
    if (modoSolicitar){ setModoSolicitar(false); setSelecionadosSolicitar(new Set()); }
    if (modoRelatorio){ setModoRelatorio(false); setSelecionadosRelatorio(new Set()); }
    if (modoDeletar)  { setModoDeletar(false);  setSelecionadosDeletar(new Set()); }
  };
  const toggleSelecionado = (id: number) => {
    setSelecionados(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const selecionarTodos = () => {
    selecionados.size === filteredMateriais.length
      ? setSelecionados(new Set())
      : setSelecionados(new Set(filteredMateriais.map(m => m.id)));
  };
  // Preenche o número exibido no modal da GRD com o próximo número real. Usa
  // o valor em cache na hora e confirma com o servidor em seguida — o cache
  // pode estar atrás quando várias GRDs são geradas em sequência.
  const prepararFormularioGrd = () => {
    setGrdForm(prev => ({ ...prev, numero: proximoNumeroData || "0001", data: new Date().toISOString().slice(0, 10) }));
    utils.grd.proximoNumero.fetch(undefined, { staleTime: 0 })
      .then(numero => { if (numero) setGrdForm(prev => ({ ...prev, numero })); })
      .catch(() => {});
  };
  const abrirModalGrd = () => {
    if (selecionados.size === 0) { toast.error("Selecione ao menos um material."); return; }
    prepararFormularioGrd();
    setGrdOrigemXml(false);
    setOpenGrdModal(true);
  };

  // ── Baixa handlers ────────────────────────────────────────────────────────────
  const toggleModoBaixa = () => {
    setModoBaixa(v => !v); setSelecionadosBaixa(new Set()); setQuantidadesBaixa({}); setMotivoBaixa("");
    if (modoGrd)      { setModoGrd(false);      setSelecionados(new Set()); }
    if (modoSolicitar){ setModoSolicitar(false); setSelecionadosSolicitar(new Set()); }
    if (modoRelatorio){ setModoRelatorio(false); setSelecionadosRelatorio(new Set()); }
    if (modoDeletar)  { setModoDeletar(false);  setSelecionadosDeletar(new Set()); }
  };
  const toggleSelecionadoBaixa = (id: number) => {
    setSelecionadosBaixa(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const selecionarTodosBaixa = () => {
    selecionadosBaixa.size === filteredMateriais.length
      ? setSelecionadosBaixa(new Set())
      : setSelecionadosBaixa(new Set(filteredMateriais.map(m => m.id)));
  };
  const abrirModalBaixa = () => {
    if (selecionadosBaixa.size === 0) { toast.error("Selecione ao menos um material."); return; }
    const qtds: Record<number, number> = {};
    (materiais || []).filter(m => selecionadosBaixa.has(m.id)).forEach(m => { qtds[m.id] = m.quantidade; });
    setQuantidadesBaixa(qtds);
    setOpenBaixaModal(true);
  };
  const handleConfirmarBaixa = async () => {
    const itens = Array.from(selecionadosBaixa).map(id => ({ id, quantidadeBaixa: quantidadesBaixa[id] ?? 1 }));
    const semQuantidade = itens.filter(item => !item.quantidadeBaixa || item.quantidadeBaixa < 1);
    if (semQuantidade.length > 0) { toast.error("Preencha uma quantidade válida (mínimo 1) para todos os itens selecionados."); return; }
    const invalidos = itens.filter(item => {
      const mat = (materiais || []).find(m => m.id === item.id);
      return mat && item.quantidadeBaixa > mat.quantidade;
    });
    if (invalidos.length > 0) { toast.error("Quantidade de baixa não pode ser maior que o estoque disponível."); return; }
    try {
      const resultado = await baixaLote.mutateAsync({
        itens,
        motivo: motivoBaixa || undefined,
        obraDestino: obraDestinoBaixa || undefined,
        dataBaixa: dataBaixa || undefined,
        numeroRequisicao: numeroRequisicaoBaixa || undefined,
      });
      const msg = [
        resultado.totalRemovidos > 0 && `${resultado.totalRemovidos} removido(s)`,
        resultado.totalAtualizados > 0 && `${resultado.totalAtualizados} atualizado(s)`,
      ].filter(Boolean).join(", ");
      toast.success(`Baixa realizada: ${msg}.`);
      setOpenBaixaModal(false); setModoBaixa(false); setSelecionadosBaixa(new Set()); setQuantidadesBaixa({}); setMotivoBaixa(""); setObraDestinoBaixa(""); setDataBaixa(new Date().toISOString().slice(0, 10)); setNumeroRequisicaoBaixa(""); refetchMateriais();
    } catch { toast.error("Erro ao realizar baixa em lote."); }
  };

  // ── Mudar Obra em Lote handlers ─────────────────────────────────────────────
  const toggleModoMudarObra = () => {
    setModoMudarObra(v => !v); setSelecionadosMudarObra(new Set()); setNovaObraIdLote("");
    if (modoGrd)      { setModoGrd(false);      setSelecionados(new Set()); }
    if (modoBaixa)    { setModoBaixa(false);    setSelecionadosBaixa(new Set()); }
    if (modoSolicitar){ setModoSolicitar(false); setSelecionadosSolicitar(new Set()); }
    if (modoRelatorio){ setModoRelatorio(false); setSelecionadosRelatorio(new Set()); }
    if (modoDeletar)  { setModoDeletar(false);  setSelecionadosDeletar(new Set()); }
  };
  const toggleSelecionadoMudarObra = (id: number) => {
    setSelecionadosMudarObra(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const selecionarTodosMudarObra = () => {
    selecionadosMudarObra.size === filteredMateriais.length
      ? setSelecionadosMudarObra(new Set())
      : setSelecionadosMudarObra(new Set(filteredMateriais.map(m => m.id)));
  };
  const abrirModalMudarObra = () => {
    if (selecionadosMudarObra.size === 0) { toast.error("Selecione ao menos um material."); return; }
    setOpenMudarObraModal(true);
  };
  const handleConfirmarMudarObra = async () => {
    const obraEscolhida = novaObraIdLote === "" ? null : obras?.find(o => o.id === novaObraIdLote);
    try {
      const resultado = await mudarObraLote.mutateAsync({
        materialIds: Array.from(selecionadosMudarObra),
        obraId: obraEscolhida?.id ?? null,
        obraNome: obraEscolhida?.nome ?? null,
      });
      toast.success(`Obra alterada em ${resultado.atualizados} material(is).`);
      setOpenMudarObraModal(false); setModoMudarObra(false); setSelecionadosMudarObra(new Set()); setNovaObraIdLote(""); refetchMateriais();
    } catch { toast.error("Erro ao mudar a obra em lote."); }
  };

  // ── Solicitar handlers ────────────────────────────────────────────────────────
  const toggleModoSolicitar = () => {
    setModoSolicitar(v => !v); setSelecionadosSolicitar(new Set()); setQuantidadesSolicitar({}); setObservacaoSolicitar("");
    if (modoGrd) { setModoGrd(false); setSelecionados(new Set()); }
    if (modoBaixa) { setModoBaixa(false); setSelecionadosBaixa(new Set()); }
  };
  const toggleSelecionadoSolicitar = (id: number) => {
    setSelecionadosSolicitar(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const selecionarTodosSolicitar = () => {
    selecionadosSolicitar.size === filteredMateriais.length
      ? setSelecionadosSolicitar(new Set())
      : setSelecionadosSolicitar(new Set(filteredMateriais.map(m => m.id)));
  };
  const abrirModalSolicitar = () => {
    if (selecionadosSolicitar.size === 0) { toast.error("Selecione ao menos um material."); return; }
    const qtds: Record<number, number> = {};
    (materiais || []).filter(m => selecionadosSolicitar.has(m.id)).forEach(m => { qtds[m.id] = m.quantidade; });
    setQuantidadesSolicitar(qtds);
    setOpenSolicitarModal(true);
  };
  const handleConfirmarSolicitacao = async () => {
    const itens = Array.from(selecionadosSolicitar).map(id => ({
      materialId: id, quantidadeSolicitada: quantidadesSolicitar[id] ?? 1,
    }));
    const semQuantidade = itens.filter(item => !item.quantidadeSolicitada || item.quantidadeSolicitada < 1);
    if (semQuantidade.length > 0) { toast.error("Preencha uma quantidade válida (mínimo 1) para todos os itens selecionados."); return; }
    try {
      await createSolicitacao.mutateAsync({
        usuarioSolicitante: "Sistema", observacaoSolicitante: observacaoSolicitar,
        obraDestinoId: obraDestinoSolicitar, dataLimite: dataLimiteSolicitar || undefined, itens,
      });
      toast.success("Solicitação de separação criada!");
      setOpenSolicitarModal(false); setModoSolicitar(false); setSelecionadosSolicitar(new Set());
      setQuantidadesSolicitar({}); setObservacaoSolicitar(""); setDataLimiteSolicitar(""); setObraDestinoSolicitar(undefined);
      refetchMateriais();
    } catch { toast.error("Erro ao criar solicitação."); }
  };

  // ── Relatório de Recebimento handlers ────────────────────────────────────────
  const toggleModoRelatorio = () => {
    setModoRelatorio(v => !v);
    setSelecionadosRelatorio(new Set());
    if (modoGrd)      { setModoGrd(false);      setSelecionados(new Set()); }
    if (modoBaixa)    { setModoBaixa(false);    setSelecionadosBaixa(new Set()); }
    if (modoMudarObra) { setModoMudarObra(false); setSelecionadosMudarObra(new Set()); }
    if (modoSolicitar){ setModoSolicitar(false); setSelecionadosSolicitar(new Set()); }
  };
  const toggleSelecionadoRelatorio = (id: number) => {
    setSelecionadosRelatorio(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const selecionarTodosRelatorio = () => {
    selecionadosRelatorio.size === filteredMateriais.length
      ? setSelecionadosRelatorio(new Set())
      : setSelecionadosRelatorio(new Set(filteredMateriais.map(m => m.id)));
  };

  // Abre o modal de configuração do relatório (lista de materiais OU pós-salvamento do XML).
  // Os materiais são separados em cargas — uma por nota fiscal/fornecedor —
  // porque o relatório cobre tudo que chegou no dia.
  const abrirConfiguracaoRelatorio = (origemXml = false) => {
    const itens = origemXml
      ? notasSalvasXml.flatMap(nota => nota.itens)
      : (materiais || []).filter(item => selecionadosRelatorio.has(item.id));
    if (itens.length === 0) { toast.error("Selecione ao menos um material."); return; }
    const cargas = agruparItensEmCargas(itens);
    // Vindo da importação de NF-e, cada nota vira uma carga do mesmo relatório,
    // e os dados lidos do XML valem mais do que os copiados em cada item.
    if (origemXml) {
      cargas.forEach((carga, indice) => {
        const nota = notasSalvasXml.find(n => chaveNotaXml(n.nf, n.fornecedor) === chaveNotaXml(carga.nf, carga.fornecedor));
        if (!nota) return;
        cargas[indice] = {
          ...carga,
          fornecedor: nota.fornecedor || carga.fornecedor,
          nf: nota.nf || carga.nf,
          numeroPedido: nota.pedido || carga.numeroPedido,
          pesoNota: String(nota.pesoOriginal),
          observacoes: "",
        };
      });
    }
    setRelatorioDados({ versao: 2, cargas, conferidoPor: "", vistoQualidade: "" });
    setFotosNovasRelatorio({});
    setRelatorioOrigemXml(origemXml);
    setOpenRelatorioModal(true);
  };

  const fecharConfiguracaoRelatorio = () => {
    setOpenRelatorioModal(false);
    setRelatorioOrigemXml(false);
    setRelatorioDados(null);
    setFotosNovasRelatorio({});
  };

  const gerarRelatorioConfigurado = async () => {
    if (!relatorioDados) return;
    const erro = validarDadosRelatorio(relatorioDados);
    if (erro) { toast.error(erro); return; }
    setGerandoRelatorio(true);
    try {
      const salvo = await salvarRelatorioMutation.mutateAsync({ dados: relatorioDados });
      const numeroDocumento = numeroDocumentoRelatorio(salvo.id);

      // Comprime e sobe as fotos de cada carga, já vinculadas à carga certa.
      const fotos: FotoRelatorio[] = [];
      for (const carga of relatorioDados.cargas) {
        for (const arquivo of fotosNovasRelatorio[carga.id] || []) {
          const comprimida = await comprimirImagemRecebimento(arquivo);
          await uploadImagemRecebimentoMutation.mutateAsync({
            relatorioId: salvo.id,
            nomeArquivo: arquivo.name,
            tipoArquivo: comprimida.tipo,
            conteudoBase64: comprimida.base64,
            cargaId: carga.id,
          });
          fotos.push({ ...comprimida, cargaId: carga.id });
        }
      }

      const nomeArquivo = await gerarPdfRecebimento(relatorioDados, numeroDocumento, fotos);
      toast.success(`PDF gerado: ${nomeArquivo}`);
      const veioDoXml = relatorioOrigemXml;
      fecharConfiguracaoRelatorio();
      if (!veioDoXml) {
        setModoRelatorio(false);
        setSelecionadosRelatorio(new Set());
      }
    } catch {
      toast.error("Erro ao salvar o relatório no servidor. Tente novamente.");
    } finally {
      setGerandoRelatorio(false);
    }
  };

  const gerarRelatorioRecebimento = () => abrirConfiguracaoRelatorio(false);


  // ── Hard Delete handlers ─────────────────────────────────────────────────────
  const toggleModoDeletar = () => {
    setModoDeletar(v => !v);
    setSelecionadosDeletar(new Set());
    setShowConfirmDeletar(false);
    setConfirmacaoDeletar("");
    if (modoGrd)      { setModoGrd(false);      setSelecionados(new Set()); }
    if (modoBaixa)    { setModoBaixa(false);    setSelecionadosBaixa(new Set()); }
    if (modoMudarObra) { setModoMudarObra(false); setSelecionadosMudarObra(new Set()); }
    if (modoSolicitar){ setModoSolicitar(false); setSelecionadosSolicitar(new Set()); }
    if (modoRelatorio){ setModoRelatorio(false); setSelecionadosRelatorio(new Set()); }
  };
  const toggleSelecionadoDeletar = (id: number) => {
    setSelecionadosDeletar(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };
  const selecionarTodosDeletar = () => {
    selecionadosDeletar.size === filteredMateriais.length
      ? setSelecionadosDeletar(new Set())
      : setSelecionadosDeletar(new Set(filteredMateriais.map(m => m.id)));
  };
  const confirmarHardDelete = () => {
    if (confirmacaoDeletar !== "CONFIRMAR") return;
    hardDeleteMutation.mutate({
      ids: Array.from(selecionadosDeletar),
      confirmacao: "CONFIRMAR",
    });
  };

  // ── GRD: gerar ───────────────────────────────────────────────────────────────
  const arquivoParaBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const resultado = reader.result as string;
        // remove o prefixo "data:application/pdf;base64," deixando só o conteúdo
        resolve(resultado.split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleGerarGrd = async () => {
    if (!grdForm.cliente || !grdForm.obra || !grdForm.numero) { toast.error("Preencha todos os campos da GRD."); return; }
    const itens = grdOrigemXml
      ? itensGrdXml.map(item => ({
          id: typeof item.id === "number" ? item.id : undefined,
          certificado: item.numero_certificado || item.numeroCertificado || "", tipo: item.tipo, bitola: item.bitola,
          comprimento: item.comprimento || 12000, quantidade: item.quantidade, unidade: "PÇ", aco: item.aco, nf: notaGrdXml?.nf || "",
        }))
      : (materiais || []).filter(m => selecionados.has(m.id)).map(m => ({
          id: m.id,
          certificado: (m as any).numero_certificado || "", tipo: m.tipo, bitola: m.bitola,
          comprimento: m.comprimento || 12000, quantidade: m.quantidade, unidade: "PÇ", aco: m.aco, nf: m.nf || "",
        }));
    try {
      const certificados = await Promise.all(certificadosAnexados.map(async (file) => ({
        nomeArquivo: file.name,
        tipoArquivo: file.type || "application/pdf",
        conteudoBase64: await arquivoParaBase64(file),
      })));
      const resultado = await gerarGrdMutation.mutateAsync({ ...grdForm, materiais: itens, certificados });
      const bytes = Uint8Array.from(atob(resultado.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/vnd.ms-excel.sheet.macroEnabled.12" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = resultado.fileName; link.click();
      URL.revokeObjectURL(url);
      toast.success(`GRD ${resultado.fileName} gerada com ${resultado.totalItens} itens${certificados.length > 0 ? ` e ${certificados.length} certificado(s) salvo(s)` : ""}!`);
      setOpenGrdModal(false);
      setCertificadosAnexados([]);
      refetchMateriais();
      utils.grd.proximoNumero.invalidate();
      if (grdOrigemXml) {
        setGrdOrigemXml(false);
        // Os materiais já foram salvos antes de chegar aqui — só fecha o modal
        // da GRD e volta pro painel pós-salvamento (onde ainda dá pra gerar a
        // GRD das outras notas e o Relatório).
        setNotasSalvasXml(prev => prev.map(n => n.id === grdNotaXmlId ? { ...n, grdGerada: true } : n));
      } else {
        setModoGrd(false); setSelecionados(new Set());
      }
    } catch (err: any) { toast.error("Erro ao gerar GRD: " + (err.message || "Tente novamente.")); }
  };

  // ── XML ───────────────────────────────────────────────────────────────────────
  // Notas carregadas que já tinham sido importadas antes — ficam nesta fila
  // esperando o usuário decidir, uma por vez, se importa de novo ou descarta.
  const [filaNfDuplicada, setFilaNfDuplicada] = useState<{ nota: NotaXml; totalItens: number; dataImportacao: string }[]>([]);
  const nfDuplicadaInfo = filaNfDuplicada[0] ?? null;

  // Mesma fórmula de usePesoCalculado, mas como função pura (sem hook) — usável
  // em loop sobre os itens importados da NF-e, um por um.
  const calcularPesoDeEspecificacao = (item: any): number | null => {
    if (!especificacoes) return null;
    const tipo = (item.tipo || "").trim().toUpperCase();
    const bitola = (item.bitola || "").trim().toUpperCase();
    const aco = (item.aco || "").trim().toUpperCase();
    const categoria = item.categoria || "PERFIL";
    const spec = especificacoes.find((e: any) =>
      (e.tipo || "").trim().toUpperCase() === tipo &&
      (e.bitola || "").trim().toUpperCase() === bitola &&
      (e.aco || "").trim().toUpperCase() === aco &&
      (e.categoria || "PERFIL") === categoria
    );
    if (!spec) return null;
    const pesoPorMetro = parseFloat(String(spec.pesoPorMetro));
    if (categoria === "CHAPA") {
      if (!item.largura || !item.comprimento) return null;
      const areaM2 = (item.largura * item.comprimento) / 1_000_000;
      return +(pesoPorMetro * areaM2 * (item.quantidade || 1)).toFixed(3);
    }
    return +(pesoPorMetro * ((item.comprimento || 0) / 1000) * (item.quantidade || 1)).toFixed(3);
  };

  const atualizarNotaXml = (id: string, patch: Partial<NotaXml>) => {
    setNotasXml(prev => prev.map(n => n.id === id ? { ...n, ...patch } : n));
  };
  const removerNotaXml = (id: string) => {
    setNotasXml(prev => prev.filter(n => n.id !== id));
  };
  // Nota sem nenhum item não tem o que cadastrar — sai da tela junto com o último item.
  const atualizarItensNotaXml = (id: string, itens: any[]) => {
    if (itens.length === 0) removerNotaXml(id);
    else atualizarNotaXml(id, { itens });
  };
  const alternarNotaRecolhidaXml = (id: string) => {
    setNotasRecolhidasXml(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });
  };

  // Aceita um ou vários XMLs de uma vez; cada arquivo vira uma nota na tela.
  const handleXmlUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const arquivos = Array.from(e.target.files || []);
    e.target.value = "";
    if (arquivos.length === 0) return;
    setProcessandoXml(true);
    const novas: NotaXml[] = [];
    const duplicadas: { nota: NotaXml; totalItens: number; dataImportacao: string }[] = [];
    const falhas: string[] = [];
    const repetidas: string[] = [];
    const chavesNaTela = new Set([
      ...notasXml.map(n => chaveNotaXml(n.nf, n.fornecedor)),
      ...filaNfDuplicada.map(d => chaveNotaXml(d.nota.nf, d.nota.fornecedor)),
    ]);
    for (const arquivo of arquivos) {
      try {
        const result = await processarNfe.mutateAsync({ xml: await lerArquivoComoTexto(arquivo) });
        const chave = chaveNotaXml(result.nf, result.fornecedor);
        if (chavesNaTela.has(chave)) { repetidas.push(String(result.nf || arquivo.name)); continue; }
        chavesNaTela.add(chave);
        const itensComId = result.itens.map((it: any) => {
          const base = { ...it, numeroCertificado: "", corrida: "", obraId: undefined, _calculoReversoPendente: true };
          // A NF veio numa unidade de contagem (UN/PÇ) ou desconhecida — o
          // peso não pode vir do número da nota, precisa ser calculado pela
          // especificação (tipo+bitola+aço), igual já acontece no cadastro
          // manual. Se não existir especificação cadastrada ainda, fica
          // pendente e bloqueia a confirmação até o usuário resolver.
          if (it.pesoOrigem === "calcular") {
            const pesoCalculado = calcularPesoDeEspecificacao(base);
            if (pesoCalculado !== null) {
              // Já resolvido no sentido certo (quantidade real da NF → peso
              // calculado) — desativa o cálculo reverso do XmlItemRow, que
              // faria o caminho oposto (peso → quantidade) e bagunçaria a
              // quantidade real que acabamos de extrair corretamente.
              return { ...base, pesoTotal: String(pesoCalculado), pesoCalculadoAuto: true, _calculoReversoPendente: false };
            }
            // Sem especificação cadastrada — não tem peso confiável nem pra
            // calcular nem pra reverter. Fica pendente de preenchimento manual.
            return { ...base, pesoTotal: "0.000", pesoPendente: true, _calculoReversoPendente: false };
          }
          return base;
        });
        const nota: NotaXml = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          nf: result.nf, fornecedor: result.fornecedor,
          itens: itensComId, pesoOriginal: pesoItensXml(itensComId),
          pedido: "", local: "",
        };

        const checagem = await utils.client.materiais.checkNfDuplicada.query({ nf: result.nf });
        if (checagem?.existe) {
          duplicadas.push({ nota, totalItens: checagem.totalItens, dataImportacao: checagem.dataImportacao! });
        } else {
          novas.push(nota);
        }
      } catch { falhas.push(arquivo.name); }
    }
    setProcessandoXml(false);
    if (novas.length > 0) setNotasXml(prev => [...prev, ...novas]);
    if (duplicadas.length > 0) setFilaNfDuplicada(prev => [...prev, ...duplicadas]);
    if (falhas.length > 0) {
      toast.error(arquivos.length === 1 ? "Erro ao processar XML" : `Erro ao processar ${falhas.length} ${falhas.length === 1 ? "arquivo" : "arquivos"}: ${falhas.join(", ")}`);
    }
    if (repetidas.length > 0) {
      toast.warning(`${repetidas.length === 1 ? `A NF ${repetidas[0]} já está` : `As NFs ${repetidas.join(", ")} já estão`} na tela — não ${repetidas.length === 1 ? "foi adicionada" : "foram adicionadas"} de novo.`);
    }
  };
  const confirmarApesarDaDuplicidade = () => {
    if (acaoPendenteDuplicidade) acaoPendenteDuplicidade();
    setDuplicadosEncontrados(null);
    setAcaoPendenteDuplicidade(null);
  };

  const cancelarPorDuplicidade = () => {
    setDuplicadosEncontrados(null);
    setAcaoPendenteDuplicidade(null);
  };

  const confirmarImportacaoMesmoAssim = () => {
    if (nfDuplicadaInfo) {
      const { nota } = nfDuplicadaInfo;
      setNotasXml(prev => [...prev, nota]);
    }
    setFilaNfDuplicada(prev => prev.slice(1));
  };

  const cancelarImportacaoDuplicada = () => {
    setFilaNfDuplicada(prev => prev.slice(1));
  };

  // Embargo de material duplicado: checa tipo+bitola+aço+corrida contra o que
  // já existe ativo no estoque. Só considera itens com corrida preenchida —
  // sem isso o cruzamento gera falso positivo demais (tipo+bitola+aço sozinhos
  // se repetem legitimamente entre entregas diferentes).
  const [duplicadosEncontrados, setDuplicadosEncontrados] = useState<string[] | null>(null);
  const [acaoPendenteDuplicidade, setAcaoPendenteDuplicidade] = useState<(() => void) | null>(null);

  const checarDuplicidadesEmLote = async (itens: any[]): Promise<string[]> => {
    if (itens.length === 0) return [];
    const resultados = await Promise.all(itens.map(async (item) => {
      const r = await utils.client.materiais.checkDuplicado.query({
        tipo: item.tipo, bitola: item.bitola, aco: item.aco, corrida: item.corrida,
        quantidade: item.quantidade, local: item.local, comprimento: item.comprimento,
      });
      return r?.existe
        ? `${item.tipo} ${item.bitola} — ${item.aco} (${item.quantidade} un., ${item.comprimento}mm, local ${item.local || "-"}${item.corrida ? `, corrida ${item.corrida}` : ""})`
        : null;
    }));
    return resultados.filter((r): r is string => r !== null);
  };

  // Roda a checagem; se achar duplicidade, guarda a ação real pra depois da
  // confirmação do usuário. Se não achar nada, executa a ação na hora.
  const comConfirmacaoDeDuplicidade = async (itens: any[], acao: () => void) => {
    const duplicados = await checarDuplicidadesEmLote(itens);
    if (duplicados.length > 0) {
      setDuplicadosEncontrados(duplicados);
      setAcaoPendenteDuplicidade(() => acao);
      return;
    }
    acao();
  };

  // Monta os itens no formato usado pelo PDF/GRD, a partir do que está na
  // tela de importação (ainda não salvo no banco).
  const montarItensXmlParaDocumento = (nota: NotaXml) => nota.itens.map(item => ({
    ...item,
    nf: nota.nf, fornecedor: nota.fornecedor,
    obraNome: obras?.find(o => o.id === item.obraId)?.nome || "LIVRE",
    local: nota.local,
    numero_certificado: item.numeroCertificado,
  }));

  // Loop de salvamento de uma nota. Devolve o que conseguiu salvar mesmo se
  // parar no meio, pra quem chama não mandar o mesmo item duas vezes.
  const salvarNotaXmlNoBanco = async (nota: NotaXml, snapshot: any[], avisosPedido: Set<string>): Promise<{ salvos: any[]; completo: boolean }> => {
    const salvos: any[] = [];
    try {
      for (let i = 0; i < nota.itens.length; i++) {
        const item = nota.itens[i];
        const resultado: any = await createMaterial.mutateAsync({
          ...item, nf: nota.nf, fornecedor: nota.fornecedor,
          obraNome: obras?.find(o => o.id === item.obraId)?.nome || "LIVRE",
          obraCompraId: item.obraCompraId,
          obraCompraNome: obras?.find(o => o.id === item.obraCompraId)?.nome || null,
          local: nota.local, pesoTotal: item.pesoTotal ? String(item.pesoTotal) : "0.000",
          numeroPedido: nota.pedido || undefined,
        });
        salvos.push({ ...snapshot[i], id: resultado?.insertId ?? resultado?.[0]?.insertId });
        if (nota.pedido && resultado?.pedidoMatch && !resultado.pedidoMatch.vinculado && resultado.pedidoMatch.motivo) {
          avisosPedido.add(resultado.pedidoMatch.motivo);
        }
      }
      return { salvos, completo: true };
    } catch { return { salvos, completo: false }; }
  };

  // Confirmar já salva direto todas as notas da tela — GRD e Relatório passam
  // a ser ações independentes, disponíveis DEPOIS que os materiais já estão salvos.
  const confirmarImportacaoXml = async () => {
    for (const nota of notasXml) {
      const rotulo = notasXml.length > 1 ? ` da NF ${nota.nf}` : "";
      if (!nota.local.trim()) {
        toast.error(`Selecione o local de descarga${rotulo} antes de confirmar.`);
        return;
      }
      const itensInvalidos = nota.itens.filter(item => !item.quantidade || item.quantidade < 1 || !item.comprimento || item.comprimento < 1);
      if (itensInvalidos.length > 0) {
        toast.error(`Preencha quantidade e comprimento (mínimo 1) em todos os itens${rotulo} antes de confirmar.`);
        return;
      }
      const itensSemEspecificacao = nota.itens.filter((item: any) => item.pesoPendente && (!item.pesoTotal || parseFloat(String(item.pesoTotal)) <= 0));
      if (itensSemEspecificacao.length > 0) {
        toast.error(`${itensSemEspecificacao.length} ${itensSemEspecificacao.length === 1 ? "item" : "itens"}${rotulo} ${itensSemEspecificacao.length === 1 ? "não tem" : "não têm"} especificação cadastrada — não dá pra calcular o peso automaticamente. Cadastre a especificação (tipo+bitola+aço) ou preencha o peso manualmente antes de confirmar.`);
        return;
      }
    }
    const notas = notasXml;
    const snapshots = notas.map(montarItensXmlParaDocumento);
    await comConfirmacaoDeDuplicidade(snapshots.flat(), async () => {
      const avisosPedido = new Set<string>();
      const salvas: NotaSalvaXml[] = [];
      const restantes: NotaXml[] = [];
      let falhou = false;
      for (let n = 0; n < notas.length; n++) {
        const nota = notas[n];
        if (falhou) { restantes.push(nota); continue; }
        const { salvos, completo } = await salvarNotaXmlNoBanco(nota, snapshots[n], avisosPedido);
        if (salvos.length > 0) {
          salvas.push({ id: nota.id, nf: nota.nf, fornecedor: nota.fornecedor, pedido: nota.pedido, pesoOriginal: nota.pesoOriginal, itens: salvos, grdGerada: false });
        }
        if (!completo) {
          falhou = true;
          restantes.push({ ...nota, itens: nota.itens.slice(salvos.length) });
        }
      }
      refetchMateriais();
      avisosPedido.forEach((motivo) => toast.warning(motivo));
      // Junta com o que já tinha sido salvo numa tentativa anterior (nota que parou no meio).
      setNotasSalvasXml(prev => {
        const resultado = [...prev];
        for (const salva of salvas) {
          const idx = resultado.findIndex(r => r.id === salva.id);
          if (idx >= 0) resultado[idx] = { ...resultado[idx], itens: [...resultado[idx].itens, ...salva.itens] };
          else resultado.push(salva);
        }
        return resultado;
      });
      setNotasXml(restantes);
      if (falhou) {
        toast.error(salvas.length > 0
          ? "Erro ao salvar itens do XML. O que já foi salvo saiu da tela — confirme de novo para salvar o restante."
          : "Erro ao salvar itens do XML");
        return;
      }
      toast.success("Materiais importados com sucesso!");
      setMostrarPosSalvamento(true);
    });
  };

  // Fechar não descarta notas ainda em edição — só o painel pós-salvamento.
  const fecharImportacaoXml = () => {
    setOpenXml(false);
    if (mostrarPosSalvamento) {
      setMostrarPosSalvamento(false);
      setNotasSalvasXml([]);
      setGrdNotaXmlId(null);
    }
  };

  const limparImportacaoXml = () => {
    setNotasXml([]);
    setNotasSalvasXml([]);
    setNotasRecolhidasXml(new Set());
  };

  // A GRD é sempre por nota — abre o mesmo modal de GRD só com os itens dela.
  const handleAbrirGrdDeXml = (notaId: string) => {
    prepararFormularioGrd();
    setGrdNotaXmlId(notaId);
    setGrdOrigemXml(true);
    setOpenGrdModal(true);
  };

  // Validação usada tanto pra "adicionar ao lote" quanto pro salvamento final.
  const validarItemAtual = (): boolean => {
    if (!formData.tipo || !formData.bitola || !formData.aco) {
      toast.error("Preencha tipo, bitola e aço antes de continuar.");
      return false;
    }
    if (!formData.quantidade || formData.quantidade < 1) {
      toast.error("Informe uma quantidade válida (mínimo 1).");
      return false;
    }
    if (!formData.comprimento || formData.comprimento < 1) {
      toast.error("Informe um comprimento válido (mínimo 1mm).");
      return false;
    }
    if (formData.categoria === "CHAPA" && (!formData.largura || formData.largura < 1)) {
      toast.error("Informe a largura da chapa (mínimo 1mm).");
      return false;
    }
    return true;
  };

  // Duplicidade entre itens dentro do próprio lote de pré-cadastro (ainda não
  // salvos no banco) — mesma regra usada contra o banco em checkMaterialDuplicado:
  // tipo+bitola+aço+quantidade+comprimento+local, e corrida só entra na
  // comparação quando preenchida nos dois lados.
  const saoItensDuplicados = (a: FormData, b: FormData): boolean => {
    if (a.tipo !== b.tipo || a.bitola !== b.bitola || a.aco !== b.aco) return false;
    if (a.quantidade !== b.quantidade || a.comprimento !== b.comprimento) return false;
    if ((a.local || "").trim() !== (b.local || "").trim()) return false;
    if (a.corrida?.trim() && b.corrida?.trim() && a.corrida.trim() !== b.corrida.trim()) return false;
    return true;
  };

  // Botão "+": adiciona o item atual ao lote local (sem salvar no banco ainda)
  // ou, se estiver editando um item já presente no lote, atualiza esse item.
  // A checagem de duplicidade roda aqui — no momento do pré-cadastro — tanto
  // contra os outros itens já no lote quanto contra o que já existe salvo no
  // banco, em vez de esperar o "Salvar" final.
  const adicionarAoLote = async () => {
    if (!validarItemAtual()) return;

    const outrosItensLote = editingLoteIndex !== null
      ? itensLote.filter((_, i) => i !== editingLoteIndex)
      : itensLote;

    const efetivarAdicao = () => {
      if (editingLoteIndex !== null) {
        setItensLote(prev => prev.map((item, i) =>
          i === editingLoteIndex ? { ...formData, pesoCalculadoSnapshot: pesoCalculado } : item
        ));
        setEditingLoteIndex(null);
        toast.success("Item do lote atualizado.");
      } else {
        setItensLote(prev => [...prev, { ...formData, pesoCalculadoSnapshot: pesoCalculado }]);
        toast.success("Item adicionado ao lote. Continue cadastrando ou clique em Salvar.");
      }
      setFormData(continuarForm(formData));
    };

    const descricaoItem = `${formData.tipo} ${formData.bitola} — ${formData.aco} (${formData.quantidade} un., ${formData.comprimento}mm, local ${formData.local || "-"}${formData.corrida ? `, corrida ${formData.corrida}` : ""})`;

    if (outrosItensLote.some(item => saoItensDuplicados(item, formData))) {
      setDuplicadosEncontrados([`${descricaoItem} já está no lote de pré-cadastro, ainda não salvo`]);
      setAcaoPendenteDuplicidade(() => efetivarAdicao);
      return;
    }

    await comConfirmacaoDeDuplicidade([formData], efetivarAdicao);
  };

  // Clique num item já listado no lote: carrega os dados de volta pros campos
  // do formulário para edição, em vez de só permitir remover.
  const editarItemLote = (index: number) => {
    const { pesoCalculadoSnapshot, ...dadosItem } = itensLote[index];
    setFormData(dadosItem);
    setEditingLoteIndex(index);
  };

  const cancelarEdicaoItemLote = () => {
    setEditingLoteIndex(null);
    setFormData(continuarForm(formData));
  };

  const removerDoLote = (index: number) => {
    setItensLote(prev => prev.filter((_, i) => i !== index));
    if (editingLoteIndex === index) {
      setEditingLoteIndex(null);
      setFormData(continuarForm(formData));
    } else if (editingLoteIndex !== null && editingLoteIndex > index) {
      setEditingLoteIndex(editingLoteIndex - 1);
    }
  };

  // ── Form submit ───────────────────────────────────────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        const pesoParaSalvar = pesoCalculado !== null ? String(pesoCalculado) : "0.000";
        await updateMaterial.mutateAsync({ id: editingId, ...formData, pesoTotal: pesoParaSalvar, obraNome: formData.obraNome || "LIVRE", recalcularPeso: true });
        toast.success("Material atualizado!");
        setFormData(emptyForm()); setShowForm(false); setEditingId(null);
        refetchMateriais();
        return;
      }

      // Cadastro novo: monta a lista final = itens já no lote + o item atual
      // (se ele tiver dados preenchidos — permite clicar em Salvar direto,
      // sem precisar clicar em "+" pro último item).
      const itemAtualPreenchido = formData.tipo || formData.bitola || formData.aco || formData.comprimento > 0;
      let listaFinal = itensLote;
      if (itemAtualPreenchido) {
        if (!validarItemAtual()) return;
        const itemAtual = { ...formData, pesoCalculadoSnapshot: pesoCalculado };
        // Se os campos ainda mostram um item que veio da listinha do lote (o
        // usuário clicou nele pra editar mas foi direto no Salvar sem clicar
        // no botão de atualizar), substitui o item original em vez de duplicá-lo.
        listaFinal = editingLoteIndex !== null
          ? itensLote.map((item, i) => (i === editingLoteIndex ? itemAtual : item))
          : [...itensLote, itemAtual];
      }
      if (listaFinal.length === 0) {
        toast.error("Adicione ao menos um item antes de salvar.");
        return;
      }

      await comConfirmacaoDeDuplicidade(listaFinal, async () => {
        const avisosPedido: string[] = [];
        for (const item of listaFinal) {
          const pesoParaSalvar = item.pesoCalculadoSnapshot !== null ? String(item.pesoCalculadoSnapshot) : "0.000";
          const resultado: any = await createMaterial.mutateAsync({ ...item, pesoTotal: pesoParaSalvar, obraNome: item.obraNome || "LIVRE" });
          // Feedback não-bloqueante: se o item tinha Nº do Pedido preenchido
          // mas não cruzou com nenhum item em aberto de Materiais a Chegar,
          // avisa o motivo em vez de falhar silenciosamente.
          if (item.numeroPedido && resultado?.pedidoMatch && !resultado.pedidoMatch.vinculado && resultado.pedidoMatch.motivo) {
            avisosPedido.push(resultado.pedidoMatch.motivo);
          }
        }
        toast.success(`${listaFinal.length} ${listaFinal.length === 1 ? "material cadastrado" : "materiais cadastrados"} com sucesso!`);
        avisosPedido.forEach((motivo) => toast.warning(motivo));
        setFormData(emptyForm()); setItensLote([]); setEditingLoteIndex(null); setShowForm(false); setEditingId(null);
        refetchMateriais();
      });
    } catch { toast.error("Erro ao processar solicitação"); }
  };
  const handleEdit = (m: any) => {
    setEditingId(m.id);
    setItensLote([]);
    setEditingLoteIndex(null);
    setFormData({
      tipo: m.tipo, bitola: m.bitola, aco: m.aco, quantidade: m.quantidade,
      comprimento: m.comprimento, largura: m.largura || 0, categoria: m.categoria || "PERFIL",
      local: m.local || "", rua: m.rua || "", vao: m.vao || "",
      obraId: m.obraId, obraNome: m.obraNome || "",
      obraCompraId: m.obraCompraId, obraCompraNome: m.obraCompraNome || "",
      fornecedor: m.fornecedor || "", nf: m.nf || "",
      numeroCertificado: m.numero_certificado || "", corrida: m.corrida || "",
      estoqueMinimo: parseFloat(String(m.estoqueMinimo || "50")) || 50,
      observacoes: m.observacoes || "", numeroPedido: m.numeroPedido || "",
    });
    setShowForm(true);
  };
  const handleDelete = async (id: number) => {
    if (!confirm("Tem certeza que deseja excluir este material?")) return;
    try { await deleteMaterial.mutateAsync({ id }); toast.success("Material excluído!"); refetchMateriais(); }
    catch { toast.error("Erro ao excluir material"); }
  };
  const handleToggleExcluirRelatorios = (m: any) => {
    marcarExclusaoRelatorio.mutate({ tipo: "material", id: m.id, excluir: !m.excluirRelatorios });
  };
  const confirmarSeparacao = async () => {
    if (!separatingId) return;
    const obra = obras?.find(o => o.id === sepObraId);
    await updateMaterial.mutateAsync({ id: separatingId, obraId: sepObraId ?? null, obraNome: obra ? `SEPARADO P/ ${obra.nome}` : "LIVRE" });
    toast.success("Material alocado!"); setOpenSeparar(false); setSeparatingId(null); refetchMateriais();
  };

  const obterLogoHcmComoPng = async (): Promise<string | null> => {
    try {
      const response = await fetch("/brand/hcm-industrial.svg");
      if (!response.ok) return null;
      const svgText = await response.text();
      const blob = new Blob([svgText], { type: "image/svg+xml" });
      const objectUrl = URL.createObjectURL(blob);
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 230;
      canvas.height = 206;
      const context = canvas.getContext("2d");
      if (!context) return null;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(objectUrl);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const exportarExcel = async () => {
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = "HCM Industrial";
      workbook.lastModifiedBy = "HCM Industrial";
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.properties.date1904 = false;

      const estoque = workbook.addWorksheet("Estoque", {
        views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
        properties: { defaultRowHeight: 18 },
        pageSetup: {
          orientation: "landscape",
          paperSize: 9,
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
          horizontalDpi: 300,
          verticalDpi: 300,
          margins: { left: 0.2, right: 0.2, top: 0.25, bottom: 0.25, header: 0.1, footer: 0.1 },
          printTitlesRow: "1:6",
        },
        headerFooter: { oddFooter: "&CHCM Industrial · Estoque de matéria prima&RPágina &P de &N" },
      });

      const palette = {
        ink: "151515",
        gold: "D6A21B",
        header: "E9A23B",
        gray: "D9D9D9",
        white: "FFFFFF",
        warm: "F4F4F1",
        border: "202020",
      };
      const thinBorder: ExcelJS.Borders = {
        top: { style: "thin", color: { argb: palette.border } },
        bottom: { style: "thin", color: { argb: palette.border } },
        left: { style: "thin", color: { argb: palette.border } },
        right: { style: "thin", color: { argb: palette.border } },
        diagonal: {},
      };

      estoque.columns = [
        { key: "tipo", width: 10 },
        { key: "bitola", width: 19 },
        { key: "quantidade", width: 9 },
        { key: "comprimento", width: 15 },
        { key: "pesoTotal", width: 17 },
        { key: "aco", width: 18 },
        { key: "obra", width: 19 },
        { key: "local", width: 22 },
      ];
      estoque.mergeCells("B1:G2");
      estoque.getCell("B1").value = "Estoque de matéria prima";
      estoque.getCell("B1").font = { name: "Arial", size: 16, bold: true, color: { argb: palette.ink } };
      estoque.getCell("B1").alignment = { horizontal: "center", vertical: "middle" };
      estoque.getCell("H1").value = "Último inventário realizado";
      estoque.getCell("H1").font = { name: "Arial", size: 9, bold: true, color: { argb: palette.ink } };
      estoque.getCell("H1").alignment = { horizontal: "right", vertical: "middle", wrapText: true };
      estoque.getCell("H2").value = new Date();
      estoque.getCell("H2").numFmt = "dd/mm/yyyy";
      estoque.getCell("H2").font = { name: "Arial", size: 10, bold: true, color: { argb: palette.ink } };
      estoque.getCell("H2").alignment = { horizontal: "right", vertical: "middle" };
      estoque.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.warm } };
      estoque.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      estoque.getRow(1).height = 24;
      estoque.getRow(2).height = 24;
      estoque.getRow(3).height = 5;
      estoque.getRow(4).height = 5;
      estoque.getRow(5).height = 26;
      for (let column = 1; column <= 8; column += 1) {
        const cell = estoque.getRow(3).getCell(column);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.gold } };
        cell.border = { bottom: { style: "medium", color: { argb: palette.ink } } };
      }

      const headers = ["TIPO", "BITOLA", "QTD", "COMPRIMENTO", "PESO TOTAL", "AÇO", "OBRA", "LOCAL"];
      headers.forEach((header, index) => {
        const cell = estoque.getRow(6).getCell(index + 1);
        cell.value = header;
        cell.font = { name: "Arial", size: 9, bold: true, color: { argb: palette.ink } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.header } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      const dados = filteredMateriais.map((m: any) => ({
        tipo: m.tipo || "",
        bitola: m.bitola || "",
        quantidade: Number(m.quantidade || 0),
        comprimento: m.categoria === "CHAPA"
          ? `${m.largura || 0} x ${m.comprimento || 0}`
          : Number(m.comprimento || 0),
        pesoTotal: Number(m.pesoTotal || 0),
        aco: m.aco || "",
        obra: nomeObra(m),
        local: m.local || "",
        fornecedor: m.fornecedor || "",
        nf: m.nf || "",
        certificado: m.numero_certificado || "",
        corrida: m.corrida || "",
      }));

      dados.forEach((item, index) => {
        const row = estoque.addRow([item.tipo, item.bitola, item.quantidade, item.comprimento, item.pesoTotal, item.aco, item.obra, item.local]);
        row.height = 18;
        row.eachCell((cell, columnNumber) => {
          cell.font = { name: "Arial", size: 9, color: { argb: palette.ink } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: index % 2 === 0 ? palette.gray : palette.white } };
          cell.border = thinBorder;
          cell.alignment = { horizontal: [1, 3, 4, 5, 6].includes(columnNumber) ? "center" : "left", vertical: "middle" };
        });
        row.getCell(3).numFmt = "0";
        row.getCell(4).numFmt = typeof item.comprimento === "number" ? "0.000" : "@";
        row.getCell(5).numFmt = '#,##0.00" kg"';
      });

      const lastRow = Math.max(6, 6 + dados.length);
      estoque.autoFilter = { from: "A6", to: `H${lastRow}` };
      const mainTable = estoque.addTable({
        name: "TabelaEstoqueHCM",
        ref: `A6:H${lastRow}`,
        headerRow: true,
        style: { theme: "TableStyleMedium2", showRowStripes: false, showFirstColumn: false, showLastColumn: false },
        columns: headers.map((name) => ({ name })),
        rows: dados.map((item) => [item.tipo, item.bitola, item.quantidade, item.comprimento, item.pesoTotal, item.aco, item.obra, item.local]),
      });
      void mainTable;
      for (let column = 1; column <= 8; column += 1) {
        estoque.getCell(6, column).border = { ...thinBorder, top: { style: "medium", color: { argb: palette.ink } } };
        estoque.getCell(lastRow, column).border = { ...thinBorder, bottom: { style: "medium", color: { argb: palette.ink } } };
      }
      for (let rowIndex = 6; rowIndex <= lastRow; rowIndex += 1) {
        estoque.getCell(rowIndex, 1).border = { ...estoque.getCell(rowIndex, 1).border, left: { style: "medium", color: { argb: palette.ink } } };
        estoque.getCell(rowIndex, 8).border = { ...estoque.getCell(rowIndex, 8).border, right: { style: "medium", color: { argb: palette.ink } } };
      }

      const logoDataUrl = await obterLogoHcmComoPng();
      if (logoDataUrl) {
        const logoId = workbook.addImage({ base64: logoDataUrl, extension: "png" });
        estoque.addImage(logoId, { tl: { col: 0.15, row: 0.18 }, ext: { width: 75, height: 68 } });
      }

      const rastreabilidade = workbook.addWorksheet("Rastreabilidade", { views: [{ state: "frozen", ySplit: 1, showGridLines: false }] });
      rastreabilidade.columns = [
        { header: "TIPO", key: "tipo", width: 12 },
        { header: "BITOLA", key: "bitola", width: 20 },
        { header: "QTD", key: "quantidade", width: 10 },
        { header: "COMPRIMENTO", key: "comprimento", width: 16 },
        { header: "PESO TOTAL (kg)", key: "pesoTotal", width: 18 },
        { header: "AÇO", key: "aco", width: 18 },
        { header: "OBRA", key: "obra", width: 22 },
        { header: "LOCAL", key: "local", width: 22 },
        { header: "FORNECEDOR", key: "fornecedor", width: 24 },
        { header: "NOTA FISCAL", key: "nf", width: 16 },
        { header: "CERTIFICADO", key: "certificado", width: 18 },
        { header: "CORRIDA", key: "corrida", width: 16 },
      ];
      dados.forEach((item) => rastreabilidade.addRow(item));
      rastreabilidade.getRow(1).eachCell((cell) => {
        cell.font = { name: "Arial", size: 9, bold: true, color: { argb: palette.ink } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: palette.header } };
        cell.border = thinBorder;
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });
      rastreabilidade.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell, columnNumber) => {
          cell.font = { name: "Arial", size: 9, color: { argb: palette.ink } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: rowNumber % 2 === 0 ? palette.gray : palette.white } };
          cell.border = thinBorder;
          cell.alignment = { horizontal: [3, 4, 5].includes(columnNumber) ? "center" : "left", vertical: "middle" };
        });
        row.getCell(5).numFmt = '#,##0.00" kg"';
      });
      rastreabilidade.autoFilter = { from: "A1", to: `L${Math.max(1, 1 + dados.length)}` };
      rastreabilidade.addTable({
        name: "TabelaRastreabilidadeHCM",
        ref: `A1:L${Math.max(1, 1 + dados.length)}`,
        headerRow: true,
        style: { theme: "TableStyleMedium2", showRowStripes: false, showFirstColumn: false, showLastColumn: false },
        columns: rastreabilidade.columns.map((column) => ({ name: String(column.header) })),
        rows: dados.map((item) => [item.tipo, item.bitola, item.quantidade, item.comprimento, item.pesoTotal, item.aco, item.obra, item.local, item.fornecedor, item.nf, item.certificado, item.corrida]),
      });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `materiais_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success("Planilha HCM exportada com sucesso!");
    } catch (error) {
      console.error("Erro ao exportar planilha HCM:", error);
      toast.error("Não foi possível gerar a planilha formatada.");
    }
  };
  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <StockDashboardLayout>
      {/* ── Modal Confirmação Hard Delete ─────────────────────────────────────── */}
      {showConfirmDeletar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-background border-2 border-red-400 dark:border-red-700 rounded-xl shadow-2xl p-6 w-full max-w-md mx-4 space-y-4">
            <div className="flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-red-600" />
              <h3 className="font-bold text-lg text-foreground">Exclusão Permanente</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Você está prestes a deletar permanentemente{" "}
              <strong className="text-red-600">{selecionadosDeletar.size} material(is)</strong>.
              Esta ação <strong>não pode ser desfeita</strong>.
            </p>
            <div className="space-y-1">
              <label className="text-sm font-medium">Digite <strong>CONFIRMAR</strong> para prosseguir:</label>
              <input
                value={confirmacaoDeletar}
                onChange={e => setConfirmacaoDeletar(e.target.value)}
                placeholder="CONFIRMAR"
                autoComplete="off"
                spellCheck={false}
                className="w-full px-3 py-2 rounded-lg border border-red-300 dark:border-red-700 bg-background text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
            </div>
            <div className="flex justify-between pt-2">
              <button
                onClick={() => { setShowConfirmDeletar(false); setConfirmacaoDeletar(""); }}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                disabled={confirmacaoDeletar !== "CONFIRMAR" || hardDeleteMutation.isPending}
                onClick={confirmarHardDelete}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {hardDeleteMutation.isPending ? <><span className="animate-spin">⏳</span> Deletando...</> : <><Trash2 className="w-4 h-4" /> Deletar permanentemente</>}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-6">

        {/* Alerta: duplicatas já existentes no sistema */}
        {duplicadosExistentes && duplicadosExistentes.length > 0 && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <button
              type="button"
              onClick={() => setMostrarDuplicadosExistentes(v => !v)}
              className="flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="flex items-center gap-2 text-sm font-bold text-amber-800">
                <AlertCircle className="h-4 w-4" />
                {duplicadosExistentes.length} possível{duplicadosExistentes.length === 1 ? "" : "eis"} duplicidade{duplicadosExistentes.length === 1 ? "" : "s"} encontrada{duplicadosExistentes.length === 1 ? "" : "s"} no estoque
              </span>
              <ChevronDown className={`h-4 w-4 text-amber-700 transition-transform ${mostrarDuplicadosExistentes ? "rotate-180" : ""}`} />
            </button>
            <div className="mt-2">
              <button
                type="button"
                onClick={() => { setSomenteDuplicados(v => !v); setPage(1); }}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  somenteDuplicados ? "bg-amber-600 text-white" : "bg-white border border-amber-300 text-amber-700 hover:bg-amber-100"
                }`}
              >
                {somenteDuplicados ? "✓ Mostrando só duplicados" : "Filtrar só duplicados"}
              </button>
            </div>
            {mostrarDuplicadosExistentes && (
              <ul className="mt-3 space-y-1.5 border-t border-amber-200 pt-3 text-sm text-amber-900">
                {duplicadosExistentes.map((d: any, idx: number) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-amber-600">•</span>
                    {d.tipo} {d.bitola} — {d.aco} (corrida {d.corrida}, {d.quantidade} un., local {d.local || "-"}) — {d.total} materiais com esses dados idênticos (IDs: {d.ids.join(", ")})
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Cabeçalho */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Estoque de Materiais</h2>
            <p className="text-muted-foreground mt-1">Gerencie sua matéria-prima e rastreabilidade.</p>
          </div>
          <div className="flex flex-col items-stretch gap-3 md:items-end md:max-w-[560px]">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <Tabs value={activeTab} onValueChange={v => { setActiveTab(v); setPage(1); }}>
                <TabsList className="h-10 rounded-xl bg-muted/70 p-1">
                  <TabsTrigger value="PERFIL" className="h-8 gap-2 rounded-lg px-3 text-xs sm:text-sm"><Layers className="h-4 w-4" /> Perfis</TabsTrigger>
                  <TabsTrigger value="CHAPA" className="h-8 gap-2 rounded-lg px-3 text-xs sm:text-sm"><Maximize2 className="h-4 w-4" /> Chapas</TabsTrigger>
                </TabsList>
              </Tabs>

              {modoDeletar ? (
                <div className="flex items-center gap-2">
                  <Button onClick={selecionarTodosDeletar} variant="outline" className="gap-2 border-red-300 text-red-700 hover:bg-red-50">
                    {selecionadosDeletar.size === filteredMateriais.length ? <><CheckSquare className="h-4 w-4" /> Desmarcar Todos</> : <><Square className="h-4 w-4" /> Selecionar Todos</>}
                  </Button>
                  <Button onClick={() => { if (selecionadosDeletar.size === 0) { toast.error("Selecione ao menos um material."); return; } setShowConfirmDeletar(true); }} disabled={selecionadosDeletar.size === 0} className="gap-2 bg-red-600 text-white hover:bg-red-700">
                    <Trash2 className="h-4 w-4" /> Deletar ({selecionadosDeletar.size})
                  </Button>
                  <Button onClick={toggleModoDeletar} variant="ghost" className="gap-2 text-muted-foreground"><X className="h-4 w-4" /> Cancelar</Button>
                </div>
              ) : modoRelatorio ? (
                <div className="flex items-center gap-2">
                  <Button onClick={selecionarTodosRelatorio} variant="outline" className="gap-2 border-emerald-300 text-emerald-700 hover:bg-emerald-50">
                    {selecionadosRelatorio.size === filteredMateriais.length ? <><CheckSquare className="h-4 w-4" /> Desmarcar Todos</> : <><Square className="h-4 w-4" /> Selecionar Todos</>}
                  </Button>
                  <Button onClick={gerarRelatorioRecebimento} disabled={selecionadosRelatorio.size === 0} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"><FileDown className="h-4 w-4" /> Gerar PDF ({selecionadosRelatorio.size})</Button>
                  <Button onClick={toggleModoRelatorio} variant="ghost" className="gap-2 text-muted-foreground"><X className="h-4 w-4" /> Cancelar</Button>
                </div>
              ) : modoGrd ? (
                <div className="flex items-center gap-2">
                  <Button onClick={selecionarTodos} variant="outline" className="gap-2 border-sky-300 text-sky-700 hover:bg-sky-50">
                    {selecionados.size === filteredMateriais.length ? <><CheckSquare className="h-4 w-4" /> Desmarcar Todos</> : <><Square className="h-4 w-4" /> Selecionar Todos</>}
                  </Button>
                  <Button onClick={abrirModalGrd} disabled={selecionados.size === 0} className="gap-2 bg-sky-600 text-white hover:bg-sky-700"><Download className="h-4 w-4" /> Gerar GRD ({selecionados.size})</Button>
                  <Button onClick={toggleModoGrd} variant="ghost" className="gap-2 text-muted-foreground"><X className="h-4 w-4" /> Cancelar</Button>
                </div>
              ) : modoBaixa ? (
                <div className="flex items-center gap-2">
                  <Button onClick={selecionarTodosBaixa} variant="outline" className="gap-2 border-red-300 text-red-700 hover:bg-red-50">
                    {selecionadosBaixa.size === filteredMateriais.length ? <><CheckSquare className="h-4 w-4" /> Desmarcar Todos</> : <><Square className="h-4 w-4" /> Selecionar Todos</>}
                  </Button>
                  <Button onClick={abrirModalBaixa} disabled={selecionadosBaixa.size === 0} className="gap-2 bg-red-600 text-white hover:bg-red-700"><PackageMinus className="h-4 w-4" /> Dar Baixa ({selecionadosBaixa.size})</Button>
                  <Button onClick={toggleModoBaixa} variant="ghost" className="gap-2 text-muted-foreground"><X className="h-4 w-4" /> Cancelar</Button>
                </div>
              ) : modoSolicitar ? (
                <div className="flex items-center gap-2">
                  <Button onClick={selecionarTodosSolicitar} variant="outline" className="gap-2 border-orange-300 text-orange-700 hover:bg-orange-50">
                    {selecionadosSolicitar.size === filteredMateriais.length ? <><CheckSquare className="h-4 w-4" /> Desmarcar Todos</> : <><Square className="h-4 w-4" /> Selecionar Todos</>}
                  </Button>
                  <Button onClick={abrirModalSolicitar} disabled={selecionadosSolicitar.size === 0} className="gap-2 bg-orange-600 text-white hover:bg-orange-700"><ArrowRightLeft className="h-4 w-4" /> Solicitar ({selecionadosSolicitar.size})</Button>
                  <Button onClick={toggleModoSolicitar} variant="ghost" className="gap-2 text-muted-foreground"><X className="h-4 w-4" /> Cancelar</Button>
                </div>
              ) : modoMudarObra ? (
                <div className="flex items-center gap-2">
                  <Button onClick={selecionarTodosMudarObra} variant="outline" className="gap-2 border-purple-300 text-purple-700 hover:bg-purple-50">
                    {selecionadosMudarObra.size === filteredMateriais.length ? <><CheckSquare className="h-4 w-4" /> Desmarcar Todos</> : <><Square className="h-4 w-4" /> Selecionar Todos</>}
                  </Button>
                  <Button onClick={abrirModalMudarObra} disabled={selecionadosMudarObra.size === 0} className="gap-2 bg-purple-600 text-white hover:bg-purple-700"><Briefcase className="h-4 w-4" /> Mudar Obra ({selecionadosMudarObra.size})</Button>
                  <Button onClick={toggleModoMudarObra} variant="ghost" className="gap-2 text-muted-foreground"><X className="h-4 w-4" /> Cancelar</Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" className="h-10 w-10 rounded-xl border-border/80 bg-background" aria-label="Mais ações de materiais" title="Mais ações">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-64 rounded-xl p-1.5">
                      <DropdownMenuLabel className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Operações de estoque</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={exportarExcel} className="gap-2 rounded-lg"><Download className="h-4 w-4 text-muted-foreground" /> Exportar Excel</DropdownMenuItem>
                      <DropdownMenuItem onClick={toggleModoRelatorio} className="gap-2 rounded-lg"><FileDown className="h-4 w-4 text-emerald-600" /> Relatório de Recebimento</DropdownMenuItem>
                      <PermissionGate permission="grds:gerar"><DropdownMenuItem onClick={toggleModoGrd} className="gap-2 rounded-lg"><FileText className="h-4 w-4 text-sky-600" /> Criar GRD</DropdownMenuItem></PermissionGate>
                      <PermissionGate permission="materiais:ajustar"><DropdownMenuItem onClick={toggleModoBaixa} className="gap-2 rounded-lg"><PackageMinus className="h-4 w-4 text-red-600" /> Baixa em Lote</DropdownMenuItem></PermissionGate>
                      <DropdownMenuItem onClick={toggleModoSolicitar} className="gap-2 rounded-lg"><ArrowRightLeft className="h-4 w-4 text-orange-600" /> Solicitar Separação</DropdownMenuItem>
                      <PermissionGate permission="materiais:ajustar"><DropdownMenuItem onClick={toggleModoMudarObra} className="gap-2 rounded-lg"><Briefcase className="h-4 w-4 text-purple-600" /> Mudar Obra em Lote</DropdownMenuItem></PermissionGate>
                      <PermissionGate permission="materiais:importar"><DropdownMenuItem onClick={() => setOpenXml(true)} className="gap-2 rounded-lg"><FileCode className="h-4 w-4 text-muted-foreground" /> Cadastrar com NF (XML)</DropdownMenuItem></PermissionGate>
                      {isOwner && <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={toggleModoDeletar} className="gap-2 rounded-lg text-red-700 focus:text-red-700"><Trash2 className="h-4 w-4" /> Deletar Materiais</DropdownMenuItem>
                      </>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setHideActions(v => !v)} className="gap-2 rounded-lg"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> {hideActions ? "Mostrar atalhos rápidos" : "Ocultar atalhos rápidos"}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setMostrarRastreabilidadeTabela(v => !v)} className="gap-2 rounded-lg"><Eye className="h-4 w-4 text-muted-foreground" /> {mostrarRastreabilidadeTabela ? "Ocultar rastreabilidade" : "Mostrar rastreabilidade"}</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setOpenRelatoriosSalvos(true)} className="gap-2 rounded-lg"><FileDown className="h-4 w-4 text-muted-foreground" /> Ver relatórios salvos</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <PermissionGate permission="materiais:criar">
                    <Button onClick={() => { setEditingId(null); setFormData(emptyForm()); setItensLote([]); setEditingLoteIndex(null); setShowForm(!showForm); }} className="h-10 gap-2 rounded-xl bg-accent px-4 shadow-sm hover:bg-accent/90"><Plus className="h-4 w-4" /> Novo Cadastro</Button>
                  </PermissionGate>
                </div>
              )}
            </div>
            {!hideActions && !modoDeletar && !modoRelatorio && !modoGrd && !modoBaixa && !modoSolicitar && !modoMudarObra && (
              <div className="hidden items-center justify-end gap-1 rounded-xl border border-border/60 bg-muted/30 px-2 py-1 lg:flex">
                <span className="mr-1 px-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Atalhos</span>
                <Button variant="ghost" size="sm" onClick={exportarExcel} className="h-7 gap-1.5 rounded-lg px-2 text-xs"><Download className="h-3.5 w-3.5" /> Exportar</Button>
                <Button variant="ghost" size="sm" onClick={toggleModoRelatorio} className="h-7 gap-1.5 rounded-lg px-2 text-xs"><FileDown className="h-3.5 w-3.5" /> Recebimento</Button>
              </div>
            )}
          </div>
        </div>

        {/* Banners de modo */}
        {modoDeletar && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border-2 border-red-300 dark:bg-red-950 dark:border-red-700 rounded-lg text-red-800 dark:text-red-200 text-sm">
            <Trash2 className="w-4 h-4 flex-shrink-0 text-red-600" />
            <span><strong>Modo Exclusão Permanente ativo</strong> — Selecione os materiais a deletar. Esta operação é irreversível.
              {selecionadosDeletar.size > 0 && <span className="ml-2 font-bold">{selecionadosDeletar.size} selecionado(s).</span>}
            </span>
          </div>
        )}
        {modoRelatorio && (
          <div className="flex items-center gap-3 px-4 py-3 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-800 text-sm">
            <FileDown className="w-4 h-4 flex-shrink-0" />
            <span><strong>Modo Relatório de Recebimento ativo</strong> — Selecione os materiais para incluir no PDF.
              {selecionadosRelatorio.size > 0 && <span className="ml-2 font-bold">{selecionadosRelatorio.size} item(ns) selecionado(s).</span>}
            </span>
          </div>
        )}
        {modoGrd && (
          <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg text-blue-800 text-sm">
            <FileText className="w-4 h-4 flex-shrink-0" />
            <span><strong>Modo GRD ativo</strong> — Selecione os materiais para incluir na GRD.
              {selecionados.size > 0 && <span className="ml-2 font-bold">{selecionados.size} item(ns) selecionado(s).</span>}
            </span>
          </div>
        )}
        {modoBaixa && (
          <div className="flex items-center gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm">
            <PackageMinus className="w-4 h-4 flex-shrink-0" />
            <span><strong>Modo Baixa em Lote ativo</strong> — Selecione os materiais a remover do estoque.
              {selecionadosBaixa.size > 0 && <span className="ml-2 font-bold">{selecionadosBaixa.size} item(ns) selecionado(s).</span>}
            </span>
          </div>
        )}
        {modoMudarObra && (
          <div className="flex items-center gap-3 px-4 py-3 bg-purple-50 border border-purple-200 rounded-lg text-purple-800 text-sm">
            <Briefcase className="w-4 h-4 flex-shrink-0" />
            <span><strong>Modo Mudar Obra ativo</strong> — Selecione os materiais pra reatribuir a obra atual (ou deixar livre).
              {selecionadosMudarObra.size > 0 && <span className="ml-2 font-bold">{selecionadosMudarObra.size} item(ns) selecionado(s).</span>}
            </span>
          </div>
        )}
        {modoSolicitar && (
          <div className="flex items-center gap-3 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg text-orange-800 text-sm">
            <ArrowRightLeft className="w-4 h-4 flex-shrink-0" />
            <span><strong>Modo Solicitar Separação ativo</strong> — Selecione os materiais a solicitar.
              {selecionadosSolicitar.size > 0 && <span className="ml-2 font-bold">{selecionadosSolicitar.size} item(ns) selecionado(s).</span>}
            </span>
          </div>
        )}

        {/* Filtros */}
        <Card className="p-4 border border-border bg-muted/30">
          <FiltroMaterialBar
            filtro={filtro}
            setFiltro={f => { setFiltro(f); setPage(1); }}
            resetFiltro={() => { resetFiltro(); setSomenteDuplicados(false); setPage(1); }}
            temFiltroAtivo={temFiltroAtivo}
            totalFiltrado={filteredMateriais.length}
            totalGeral={(materiais || []).filter(m => (m.categoria || "PERFIL") === activeTab).length}
            tiposDisponiveis={tiposUnicos}
            acosDisponiveis={acosUnicos}
            obrasDisponiveis={obrasUnicas}
            fornecedoresDisponiveis={fornecedoresUnicos}
            campos={["tipo", "aco", "obra", "local", "fornecedor", "comprimento"]}
            onChangePage={() => setPage(1)}
          />
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/60">
            <button
              type="button"
              onClick={alternarOrdenacao}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
              title="Clique para alternar o critério de organização da tabela"
            >
              <ArrowUpDown className="w-3.5 h-3.5" />
              Organizar por: <span className="font-semibold text-foreground">{criterioOrdenacao.label}</span>
            </button>
            {totalPages > 1 && (
              <p className="text-xs text-muted-foreground">
                Página {page}/{totalPages}
              </p>
            )}
          </div>
        </Card>

        {/* Modal formulário */}
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Editar Material" : "Novo Material"}</DialogTitle>
              <DialogDescription>{editingId ? "Atualize os dados do material" : "Cadastre um novo material"}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">CATEGORIA</label>
                  <select className="h-10 px-3 rounded-md border border-input bg-background text-sm" value={formData.categoria} onChange={e => setFormData({ ...formData, categoria: e.target.value })}>
                    <option value="PERFIL">PERFIL LINEAR</option>
                    <option value="CHAPA">CHAPA / PLACA</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">TIPO</label>
                  <Input list="lista-tipos" placeholder="Ex: W, HP" value={formData.tipo} onChange={e => setFormData({ ...formData, tipo: e.target.value.toUpperCase() })} required={itensLote.length === 0} />
                  <datalist id="lista-tipos">
                    {tiposConhecidos.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">BITOLA{formData.categoria === "CHAPA" ? " (espessura mm)" : ""}</label>
                  <Input placeholder={formData.categoria === "CHAPA" ? "Ex: 6.35" : "Ex: 150X13"} value={formData.bitola} onChange={e => setFormData({ ...formData, bitola: e.target.value.toUpperCase() })} required={itensLote.length === 0} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">AÇO</label>
                  <Input list="lista-acos" placeholder="Ex: A36" value={formData.aco} onChange={e => setFormData({ ...formData, aco: e.target.value.toUpperCase() })} required={itensLote.length === 0} />
                  <datalist id="lista-acos">
                    {acosConhecidos.map(a => <option key={a} value={a} />)}
                  </datalist>
                </div>
              </div>
              {mostrarAlertaEspecificacao && (
                <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border bg-yellow-50 text-yellow-700 border-yellow-200">
                  <AlertCircle className="w-3.5 h-3.5" /> Especificação não encontrada. Cadastre em <em>Especificações</em>.
                </div>
              )}
              {especEncontrada && formData.tipo && formData.bitola && formData.aco && (formData.categoria === "PERFIL" || formData.categoria === "CHAPA") && (
                <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-md border bg-green-50 text-green-700 border-green-200">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Especificação encontrada: <strong>{pesoPorMetro} {formData.categoria === "CHAPA" ? "kg/m²" : "kg/m"}</strong>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">QTD (barras)</label>
                  <Input type="number" min={1} placeholder="Ex: 10" value={formData.quantidade || ""} onChange={e => setFormData({ ...formData, quantidade: e.target.value === "" ? 0 : (parseInt(e.target.value) || 0) })} required={itensLote.length === 0} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">COMPRIMENTO (mm)</label>
                  <Input type="number" step="1" min={0} placeholder="Ex: 6000"
                    value={formData.comprimento || ""}
                    onChange={e => setFormData({ ...formData, comprimento: Math.round(parseFloat(e.target.value) || 0) })} required={itensLote.length === 0} />
                </div>
                {formData.categoria === "CHAPA" && (
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground uppercase">LARGURA (mm)</label>
                    <Input type="number" step="1" min={1} placeholder="Ex: 1500"
                      value={formData.largura || ""}
                      onChange={e => setFormData({ ...formData, largura: Math.round(parseFloat(e.target.value) || 0) })} required={itensLote.length === 0} />
                  </div>
                )}
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase flex items-center gap-1"><Calculator className="w-3 h-3" /> PESO CALCULADO</label>
                  <div className={`h-10 px-3 flex items-center rounded-md border text-sm font-bold transition-colors ${pesoCalculado !== null ? "bg-green-50 border-green-300 text-green-800" : "bg-muted/40 border-border text-muted-foreground"}`}>
                    {pesoCalculado !== null ? `${pesoCalculado.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg` : formData.tipo && formData.bitola && formData.aco ? "Calculando..." : "Preencha os dados acima"}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-2 space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">LOCAL</label>
                  <select
                    className="h-10 px-3 rounded-md border border-input bg-background text-sm w-full"
                    value={formData.local}
                    onChange={(e) => setFormData({ ...formData, local: e.target.value })}
                  >
                    <option value="">Selecione um local...</option>
                    {locaisAtivos?.map((l) => (
                      <option key={l.id} value={l.nome}>{l.nome}</option>
                    ))}
                  </select>
                  {locaisAtivos?.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Nenhum local cadastrado ainda. Cadastre em "Locais" no menu.
                    </p>
                  )}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">OBRA / DESTINO</label>
                <select className="h-10 px-3 rounded-md border border-input bg-background text-sm w-full md:w-1/2"
                  value={formData.obraId || ""}
                  onChange={e => { const id = e.target.value ? parseInt(e.target.value) : undefined; const obra = obras?.find(o => o.id === id); setFormData({ ...formData, obraId: id, obraNome: obra?.nome || "" }); }}>
                  <option value="">LIVRE</option>
                  {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground">Onde o material está fisicamente alocado agora — pode ser mudada depois, na baixa ou em lote.</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Obra de Compra <span className="normal-case font-normal">(referência — não muda depois)</span></label>
                <select className="h-10 px-3 rounded-md border border-input bg-background text-sm w-full md:w-1/2"
                  value={formData.obraCompraId || ""}
                  onChange={e => { const id = e.target.value ? parseInt(e.target.value) : undefined; const obra = obras?.find(o => o.id === id); setFormData({ ...formData, obraCompraId: id, obraCompraNome: obra?.nome || "" }); }}>
                  <option value="">Não informado</option>
                  {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
                <p className="text-[11px] text-muted-foreground">Pra qual obra essa compra foi originalmente destinada — só informativo, fica registrado pra sempre.</p>
              </div>
              {/* Estoque Mínimo: oculto por enquanto (será realocado em outro local do sistema em breve).
                  Mantido no DOM via `hidden` — não remover a lógica, só a exibição. */}
              <div className="border-t pt-4 hidden">
                <h4 className="text-xs font-bold mb-3 uppercase text-muted-foreground">Controle de Estoque</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Estoque Mínimo (kg)</label>
                    <Input type="number" step="0.01" placeholder="50.00" value={formData.estoqueMinimo} onChange={e => setFormData({ ...formData, estoqueMinimo: parseFloat(e.target.value) || 50 })} />
                  </div>
                </div>
              </div>

              <div className="border-t pt-3">
                <button
                  type="button"
                  onClick={() => setMostrarRastreabilidade(v => !v)}
                  className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mostrarRastreabilidade ? "rotate-180" : ""}`} />
                  Rastreabilidade
                  <span className="font-normal normal-case text-muted-foreground/70">(fornecedor, NF, certificado...)</span>
                </button>
                {mostrarRastreabilidade && (
                  <div className="mt-3 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <Input placeholder="Fornecedor" value={formData.fornecedor} onChange={e => setFormData({ ...formData, fornecedor: e.target.value })} />
                      <Input placeholder="NF" value={formData.nf} onChange={e => setFormData({ ...formData, nf: e.target.value })} />
                      <Input placeholder="Nº Certificado" value={formData.numeroCertificado} onChange={e => setFormData({ ...formData, numeroCertificado: e.target.value })} />
                      <Input placeholder="Corrida" value={formData.corrida} onChange={e => setFormData({ ...formData, corrida: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="md:col-span-2 space-y-1">
                        <Input
                          list="lista-pedidos-abertos"
                          placeholder="Nº do Pedido (Materiais a Chegar)"
                          value={formData.numeroPedido}
                          onChange={e => setFormData({ ...formData, numeroPedido: e.target.value })}
                        />
                        <datalist id="lista-pedidos-abertos">
                          {numerosPedidoAbertos.map((n: string) => <option key={n} value={n} />)}
                        </datalist>
                        <p className="text-[10px] text-muted-foreground">
                          Se preencher igual ao pedido em "Materiais a Chegar", a chegada é marcada automaticamente lá (precisa também de tipo/bitola/aço iguais).
                        </p>
                      </div>
                    </div>
                    {/* Observações: oculto no cadastro manual — esse campo é usado principalmente no
                        cadastro por NF-e, para anotar divergências no Relatório de Recebimento.
                        Mantido no DOM via `hidden` — não remover a lógica. */}
                    <div className="hidden">
                      <textarea
                        className="w-full h-10 min-h-10 px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
                        placeholder="Observações (opcional)"
                        value={formData.observacoes}
                        onChange={e => setFormData({ ...formData, observacoes: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>

              {!editingId && itensLote.length > 0 && (
                <div className="border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground flex items-center justify-between">
                    <span>Itens no lote — clique para editar, serão salvos juntos ao clicar em Salvar</span>
                    <span className="font-normal">{itensLote.length} {itensLote.length === 1 ? "item" : "itens"}</span>
                  </div>
                  <div className="max-h-32 overflow-y-auto divide-y divide-border">
                    {itensLote.map((item, idx) => (
                      <div
                        key={idx}
                        onClick={() => editarItemLote(idx)}
                        title="Clique para carregar este item nos campos de cadastro e editá-lo"
                        className={`px-3 py-1.5 text-xs flex justify-between items-center gap-2 cursor-pointer transition-colors ${
                          editingLoteIndex === idx ? "bg-accent/10" : "hover:bg-muted/50"
                        }`}
                      >
                        <span className="font-medium truncate">
                          {editingLoteIndex === idx && <span className="text-accent">✎ </span>}
                          {item.tipo} {item.bitola} — {item.aco}
                        </span>
                        <span className="text-muted-foreground whitespace-nowrap">
                          {item.quantidade}PÇ × {item.comprimento.toLocaleString("pt-BR")}mm
                          {item.pesoCalculadoSnapshot !== null && ` · ${item.pesoCalculadoSnapshot.toLocaleString("pt-BR")}kg`}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removerDoLote(idx); }}
                          className="text-muted-foreground hover:text-destructive shrink-0"
                          title="Remover item do lote"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => { setShowForm(false); setEditingId(null); setItensLote([]); setEditingLoteIndex(null); }}>Cancelar</Button>
                {!editingId && editingLoteIndex !== null && (
                  <Button type="button" variant="ghost" onClick={cancelarEdicaoItemLote}>Cancelar edição do item</Button>
                )}
                {!editingId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={adicionarAoLote}
                    title={editingLoteIndex !== null ? "Atualizar item no lote" : "Adicionar item ao lote (não salva ainda)"}
                  >
                    {editingLoteIndex !== null ? <CheckCircle2 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                  </Button>
                )}
                <Button type="submit" className="bg-accent hover:bg-accent/90">
                  {editingId
                    ? "Atualizar"
                    : itensLote.length > 0
                      ? `Salvar (${itensLote.length + (formData.tipo && editingLoteIndex === null ? 1 : 0)})`
                      : "Salvar"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* ─── TABELA ──────────────────────────────────────────────────────────── */}
        <Card className="overflow-hidden border border-border">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : (
            <>
              {/* DESKTOP: tabela completa (oculta em mobile) */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-bold">
                    <tr>
                      {modoGrd && <th className="px-4 py-3 w-10"><button onClick={selecionarTodos} className="text-blue-600">{selecionados.size === filteredMateriais.length && filteredMateriais.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      {modoBaixa && <th className="px-4 py-3 w-10"><button onClick={selecionarTodosBaixa} className="text-red-600">{selecionadosBaixa.size === filteredMateriais.length && filteredMateriais.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      {modoMudarObra && <th className="px-4 py-3 w-10"><button onClick={selecionarTodosMudarObra} className="text-purple-600">{selecionadosMudarObra.size === filteredMateriais.length && filteredMateriais.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      {modoSolicitar && <th className="px-4 py-3 w-10"><button onClick={selecionarTodosSolicitar} className="text-orange-600">{selecionadosSolicitar.size === filteredMateriais.length && filteredMateriais.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      {modoRelatorio && <th className="px-4 py-3 w-10"><button onClick={selecionarTodosRelatorio} className="text-emerald-600">{selecionadosRelatorio.size === filteredMateriais.length && filteredMateriais.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      {modoDeletar && <th className="px-4 py-3 w-10"><button onClick={selecionarTodosDeletar} className="text-red-600">{selecionadosDeletar.size === filteredMateriais.length && filteredMateriais.length > 0 ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}</button></th>}
                      <th className="px-4 py-3">Tipo / Bitola</th>
                      <th className="px-4 py-3">Qtd</th>
                      <th className="px-4 py-3">{activeTab === "CHAPA" ? "Dimensões" : "Compr"}</th>
                      <th className="px-4 py-3">Peso Total</th>
                      <th className="px-4 py-3">Aço</th>
                      <th className="px-4 py-3">Obra / Local</th>
                      {mostrarRastreabilidadeTabela && (
                        <>
                          <th className="px-4 py-3">Fornecedor / NF</th>
                          <th className="px-4 py-3">Certificado / Corrida</th>
                        </>
                      )}
                      <th className="px-4 py-3 text-center"><Tag className="w-3 h-3 inline" /></th>
                      {!modoGrd && !modoBaixa && !modoSolicitar && !modoRelatorio && !modoDeletar && !modoMudarObra && !hideActions && <th className="px-4 py-3 text-right">Ações</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {materiaisPagina.map((m) => {
                      const sel     = selecionados.has(m.id);
                      const selBaixa = selecionadosBaixa.has(m.id);
                      const selSolic = selecionadosSolicitar.has(m.id);
                      const selMudarObra = selecionadosMudarObra.has(m.id);
                      return (
                        <tr key={m.id}
                          onClick={modoGrd ? () => toggleSelecionado(m.id) : modoBaixa ? () => toggleSelecionadoBaixa(m.id) : modoSolicitar ? () => toggleSelecionadoSolicitar(m.id) : modoRelatorio ? () => toggleSelecionadoRelatorio(m.id) : modoDeletar ? () => toggleSelecionadoDeletar(m.id) : modoMudarObra ? () => toggleSelecionadoMudarObra(m.id) : undefined}
                          className={`transition-colors
                            ${modoGrd      ? "cursor-pointer hover:bg-blue-50"    : ""}
                            ${modoBaixa    ? "cursor-pointer hover:bg-red-50"     : ""}
                            ${modoSolicitar? "cursor-pointer hover:bg-orange-50"  : ""}
                            ${modoRelatorio? "cursor-pointer hover:bg-emerald-50" : ""}
                            ${modoDeletar  ? "cursor-pointer hover:bg-red-50"     : ""}
                            ${modoMudarObra? "cursor-pointer hover:bg-purple-50"  : ""}
                            ${!modoGrd && !modoBaixa && !modoSolicitar && !modoRelatorio && !modoDeletar && !modoMudarObra ? "hover:bg-muted/30" : ""}
                            ${sel ? "bg-blue-50 border-l-4 border-l-blue-500" : ""}
                            ${selBaixa ? "bg-red-50 border-l-4 border-l-red-500" : ""}
                            ${selSolic ? "bg-orange-50 border-l-4 border-l-orange-500" : ""}
                            ${selecionadosRelatorio.has(m.id) ? "bg-emerald-50 border-l-4 border-l-emerald-500" : ""}
                            ${selecionadosDeletar.has(m.id) ? "bg-red-100 border-l-4 border-l-red-700" : ""}
                            ${selMudarObra ? "bg-purple-50 border-l-4 border-l-purple-500" : ""}
                            ${m.obraNome && m.obraNome !== "LIVRE" && !sel && !selBaixa && !selSolic && !selMudarObra && !selecionadosRelatorio.has(m.id) && !selecionadosDeletar.has(m.id) ? "bg-blue-50/30" : ""}
                          `}
                        >
                          {modoGrd && <td className="px-4 py-3">{sel ? <CheckSquare className="w-4 h-4 text-blue-600" /> : <Square className="w-4 h-4 text-muted-foreground" />}</td>}
                          {modoBaixa && <td className="px-4 py-3">{selBaixa ? <CheckSquare className="w-4 h-4 text-red-600" /> : <Square className="w-4 h-4 text-muted-foreground" />}</td>}
                          {modoSolicitar && <td className="px-4 py-3">{selSolic ? <CheckSquare className="w-4 h-4 text-orange-600" /> : <Square className="w-4 h-4 text-muted-foreground" />}</td>}
                          {modoRelatorio && <td className="px-4 py-3">{selecionadosRelatorio.has(m.id) ? <CheckSquare className="w-4 h-4 text-emerald-600" /> : <Square className="w-4 h-4 text-muted-foreground" />}</td>}
                          {modoDeletar && <td className="px-4 py-3">{selecionadosDeletar.has(m.id) ? <CheckSquare className="w-4 h-4 text-red-700" /> : <Square className="w-4 h-4 text-muted-foreground" />}</td>}
                          {modoMudarObra && <td className="px-4 py-3">{selMudarObra ? <CheckSquare className="w-4 h-4 text-purple-600" /> : <Square className="w-4 h-4 text-muted-foreground" />}</td>}
                          <td className="px-4 py-3 font-medium">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {m.tipo} {m.bitola}
                              {idsDuplicados.has(m.id) && (
                                <span
                                  title="Existe outro material ativo com os mesmos dados (tipo, bitola, aço, quantidade, comprimento e local)"
                                  className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700"
                                >
                                  <AlertCircle className="w-2.5 h-2.5" /> Duplicado
                                </span>
                              )}
                              {(m as any).grdGerada && (
                                <span
                                  title="Esse material já entrou em pelo menos uma GRD gerada"
                                  className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700"
                                >
                                  <FileText className="w-2.5 h-2.5" /> GRD Gerada
                                </span>
                              )}
                              <BadgeReservaProducao reserva={reservaPorMaterial.get(m.id)} />
                            </div>
                          </td>
                          <td className="px-4 py-3">{m.quantidade}</td>
                          <td className="px-4 py-3">
                            {m.categoria === "CHAPA"
                              ? `${(m.largura || 0).toLocaleString("pt-BR")}×${(m.comprimento || 0).toLocaleString("pt-BR")}mm`
                              : `${(m.comprimento || 0).toLocaleString("pt-BR")}mm`}
                          </td>
                          <td className="px-4 py-3 font-bold text-primary">
                            {parseFloat(String(m.pesoTotal || 0)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg
                          </td>
                          <td className="px-4 py-3 text-xs">{m.aco}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-xs">{nomeObra(m)}</div>
                            {(!m.obraNome || m.obraNome === "LIVRE") && m.obraCompraNome && (
                              <div className="text-[9px] text-amber-700 font-semibold">Comprado p/ {m.obraCompraNome}</div>
                            )}
                            <div className="text-[10px] text-muted-foreground">{m.local}</div>
                          </td>
                          {mostrarRastreabilidadeTabela && (
                            <>
                              <td className="px-4 py-3 text-[10px]">
                                <div>{m.fornecedor || "-"}</div>
                                <div className="text-muted-foreground">NF: {m.nf || "-"}</div>
                              </td>
                              <td className="px-4 py-3 text-[10px]">
                                <div>Cert: {(m as any).numero_certificado || "-"}</div>
                                <div>Corr: {(m as any).corrida || "-"}</div>
                              </td>
                            </>
                          )}
                          <td className="px-4 py-3 text-center">
                            <div className="flex flex-col items-center gap-1">
                              {(m as any).etiquetaImpressa
                                ? <div title={`Impressa em: ${new Date((m as any).dataImpressaoEtiqueta).toLocaleString()}`}><CheckCircle2 className="w-4 h-4 text-green-500 mx-auto" /></div>
                                : <Square className="w-4 h-4 text-muted-foreground/20 mx-auto" />}
                              {(m as any).statusSolicitacao === "pendente" && <div className="px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[8px] font-bold rounded uppercase">SOLICITADO</div>}
                              {(m as any).statusSolicitacao === "concluido" && <div className="px-1.5 py-0.5 bg-green-100 text-green-700 text-[8px] font-bold rounded uppercase">SEPARADO</div>}
                            </div>
                          </td>
                          {!modoGrd && !modoBaixa && !modoSolicitar && !modoRelatorio && !modoDeletar && !modoMudarObra && !hideActions && (
                            <td className="px-4 py-3 text-right space-x-1">
                              <Button variant="ghost" size="icon" title="Gerar Etiqueta" onClick={() => { setMaterialEtiqueta(m); setOpenEtiqueta(true); }}><Tag className="w-4 h-4 text-violet-600" /></Button>
                              <Button variant="ghost" size="icon" title="Separar p/ Obra" onClick={() => { setSeparatingId(m.id); setSepObraId(m.obraId); setOpenSeparar(true); }}><ArrowRightLeft className="w-4 h-4 text-blue-600" /></Button>
                              <a href={`/linha-do-tempo/${m.id}`}><Button variant="ghost" size="icon" title="Linha do Tempo"><FileText className="w-4 h-4 text-emerald-600" /></Button></a>
                              <PermissionGate permission="materiais:editar"><Button variant="ghost" size="icon" onClick={() => handleEdit(m)}><Edit2 className="w-4 h-4" /></Button></PermissionGate>
                              <PermissionGate permission="materiais:remover"><Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(m.id)}><Trash2 className="w-4 h-4" /></Button></PermissionGate>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {materiaisPagina.length === 0 && (
                      <tr><td colSpan={9 + (mostrarRastreabilidadeTabela ? 2 : 0) + (!modoGrd && !modoBaixa && !modoSolicitar && !modoRelatorio && !modoDeletar && !modoMudarObra && !hideActions ? 1 : 0)} className="px-4 py-8 text-center text-muted-foreground">Nenhum material encontrado.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* MOBILE: tabela compacta com 5 colunas + botão detalhes */}
              <div className="md:hidden space-y-2.5 p-3">
                {materiaisPagina.map((m) => {
                  const sel = selecionados.has(m.id);
                  const selBaixa = selecionadosBaixa.has(m.id);
                  const selSolic = selecionadosSolicitar.has(m.id);
                  const selRel = selecionadosRelatorio.has(m.id);
                  const selDel = selecionadosDeletar.has(m.id);
                  const selMudarObra = selecionadosMudarObra.has(m.id);
                  const modoAtivo = modoGrd || modoBaixa || modoSolicitar || modoRelatorio || modoDeletar || modoMudarObra;
                  const marcado = sel || selBaixa || selSolic || selRel || selDel || selMudarObra;
                  const corSelecao = sel ? "border-l-blue-500 bg-blue-50/40"
                    : (selBaixa || selDel) ? "border-l-red-500 bg-red-50/40"
                    : selSolic ? "border-l-orange-500 bg-orange-50/40"
                    : selRel ? "border-l-emerald-500 bg-emerald-50/40"
                    : selMudarObra ? "border-l-purple-500 bg-purple-50/40"
                    : "border-l-transparent";
                  const onClickCard = modoGrd ? () => toggleSelecionado(m.id)
                    : modoBaixa ? () => toggleSelecionadoBaixa(m.id)
                    : modoSolicitar ? () => toggleSelecionadoSolicitar(m.id)
                    : modoRelatorio ? () => toggleSelecionadoRelatorio(m.id)
                    : modoDeletar ? () => toggleSelecionadoDeletar(m.id)
                    : modoMudarObra ? () => toggleSelecionadoMudarObra(m.id)
                    : undefined;

                  return (
                    <div
                      key={m.id}
                      onClick={onClickCard}
                      className={`rounded-xl border border-l-4 bg-card p-3.5 shadow-sm transition-colors ${corSelecao} ${modoAtivo ? "cursor-pointer active:bg-muted/40" : ""}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          {modoAtivo && (
                            <div className="mt-0.5 shrink-0">
                              {marcado
                                ? <CheckSquare className={`w-4 h-4 ${sel ? "text-blue-600" : (selBaixa || selDel) ? "text-red-600" : selRel ? "text-emerald-600" : selMudarObra ? "text-purple-600" : "text-orange-600"}`} />
                                : <Square className="w-4 h-4 text-muted-foreground" />}
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="font-bold text-[15px] leading-tight truncate">
                              {m.tipo} · {m.bitola}
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              {m.local || "—"} · {nomeObra(m)} · {m.categoria === "CHAPA" ? "Chapa" : "Perfil"}
                            </div>
                            {(!m.obraNome || m.obraNome === "LIVRE") && m.obraCompraNome && (
                              <div className="text-[10px] text-amber-700 font-semibold mt-0.5">Comprado p/ {m.obraCompraNome}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {m.aco && (
                            <span className="rounded-full bg-[#f8f6f1] border border-[#ead9a2] px-2 py-0.5 text-[10px] font-bold uppercase text-[#9b7412] whitespace-nowrap">{m.aco}</span>
                          )}
                          {!modoAtivo && (
                            <Button
                              variant="ghost" size="icon" className="h-7 w-7 -mr-1"
                              onClick={(e) => { e.stopPropagation(); setDetalheItem(m); setOpenDetalhe(true); }}
                            >
                              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                            </Button>
                          )}
                        </div>
                      </div>

                      {(idsDuplicados.has(m.id) || (m as any).grdGerada || (m as any).statusSolicitacao === "pendente" || (m as any).statusSolicitacao === "concluido" || reservaPorMaterial.has(m.id)) && (
                        <div className="flex items-center gap-1.5 flex-wrap mt-2">
                          <BadgeReservaProducao reserva={reservaPorMaterial.get(m.id)} />
                          {idsDuplicados.has(m.id) && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-700">
                              <AlertCircle className="w-2.5 h-2.5" /> Duplicado
                            </span>
                          )}
                          {(m as any).grdGerada && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-blue-700">
                              <FileText className="w-2.5 h-2.5" /> GRD Gerada
                            </span>
                          )}
                          {(m as any).statusSolicitacao === "pendente" && (
                            <span className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-orange-700">Solicitado</span>
                          )}
                          {(m as any).statusSolicitacao === "concluido" && (
                            <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-green-700">Separado</span>
                          )}
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/60">
                        <div>
                          <div className="text-[9px] font-bold uppercase text-muted-foreground">Quantidade</div>
                          <div className="text-sm font-bold mt-0.5">{m.quantidade} PÇ</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase text-muted-foreground">{m.categoria === "CHAPA" ? "Dimensão" : "Comprimento"}</div>
                          <div className="text-sm font-bold mt-0.5">
                            {m.categoria === "CHAPA"
                              ? `${(m.largura || 0).toLocaleString("pt-BR")}×${(m.comprimento || 0).toLocaleString("pt-BR")}`
                              : `${(m.comprimento || 0).toLocaleString("pt-BR")} mm`}
                          </div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold uppercase text-muted-foreground">Peso Total</div>
                          <div className="text-sm font-bold mt-0.5 text-accent-foreground">
                            {parseFloat(String(m.pesoTotal || 0)).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} kg
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {materiaisPagina.length === 0 && (
                  <div className="px-4 py-8 text-center text-muted-foreground text-sm">
                    Nenhum material encontrado.
                  </div>
                )}
              </div>
              {/* Paginação (desktop + mobile) */}
              <Paginacao
                page={page}
                totalPages={totalPages}
                total={filteredMateriais.length}
                pageSize={PAGE_SIZE}
                onChange={setPage}
              />
            </>
          )}
        </Card>
      </div>

      {/* ─── POPUP DETALHES (mobile) ─────────────────────────────────────────── */}
      <MaterialDetailDialog
        material={detalheItem}
        open={openDetalhe}
        onOpenChange={setOpenDetalhe}
        obras={obras || []}
        onEdit={(m) => { handleEdit(m); }}
        onDelete={handleDelete}
        onToggleExcluirRelatorios={handleToggleExcluirRelatorios}
        togglingExcluir={marcarExclusaoRelatorio.isPending}
      />

      {/* ─── MODAL ETIQUETA ──────────────────────────────────────────────────── */}
      {materialEtiqueta && (
        <PrintDialog
          open={openEtiqueta}
          onOpenChange={(open) => { setOpenEtiqueta(open); if (!open) setMaterialEtiqueta(null); }}
          material={materialEtiqueta}
        />
      )}

      {/* ─── MODAL BAIXA EM LOTE ─────────────────────────────────────────────── */}
      <Dialog open={openBaixaModal} onOpenChange={setOpenBaixaModal}>
        <DialogContent className="w-[92vw] max-w-2xl max-h-[90vh] overflow-y-auto p-0">
          <div className="h-1.5 bg-red-500" />
          <DialogHeader className="px-6 pt-5 pb-4 border-b bg-red-50/40">
            <DialogTitle className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white">
                <PackageMinus className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-lg">Baixa em Lote</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {selecionadosBaixa.size} {selecionadosBaixa.size === 1 ? "material selecionado" : "materiais selecionados"} — confirme as quantidades e o destino de uso
                </span>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 p-6">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Obra de Destino <span className="font-normal normal-case text-muted-foreground/70">(onde o material será usado)</span></label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
                value={obraDestinoBaixa}
                onChange={e => setObraDestinoBaixa(e.target.value)}
              >
                <option value="">Sem obra específica (mantém local atual)</option>
                {obras?.map(o => <option key={o.id} value={o.nome}>{o.nome}</option>)}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Data da Baixa</label>
                <Input
                  type="date"
                  value={dataBaixa}
                  onChange={e => setDataBaixa(e.target.value)}
                  className="focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-muted-foreground uppercase">Nº da Requisição <span className="font-normal normal-case text-muted-foreground/70">(opcional)</span></label>
                <Input
                  placeholder="Ex: REQ-0042"
                  value={numeroRequisicaoBaixa}
                  onChange={e => setNumeroRequisicaoBaixa(e.target.value)}
                  className="focus:border-red-400 focus:ring-2 focus:ring-red-400/20"
                />
              </div>
            </div>

            <div className="space-y-2.5">
              {(materiais || []).filter(m => selecionadosBaixa.has(m.id)).map(m => {
                const qtdBaixa = quantidadesBaixa[m.id] ?? m.quantidade;
                const estoqueRestante = m.quantidade - qtdBaixa;
                const baixaTotal = qtdBaixa >= m.quantidade;
                const excedeu = qtdBaixa > m.quantidade;
                return (
                  <div key={m.id} className="rounded-xl border border-border/80 bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm">{m.tipo} · {m.bitola}</span>
                          {m.aco && (
                            <span className="rounded-full bg-[#f8f6f1] px-2 py-0.5 text-[10px] font-bold uppercase text-[#9b7412]">{m.aco}</span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {nomeObra(m)} · {m.local}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-border/60">
                      <div>
                        <div className="text-[9px] font-bold uppercase text-muted-foreground">Estoque Atual</div>
                        <div className="text-sm font-semibold mt-0.5">{m.quantidade} PÇ</div>
                      </div>
                      <div>
                        <div className="text-[9px] font-bold uppercase text-muted-foreground">Qtd. a Baixar</div>
                        <Input
                          type="number" min={1} max={m.quantidade}
                          className={`h-8 mt-0.5 text-center text-sm font-bold ${excedeu ? "border-red-400 bg-red-50" : ""}`}
                          value={qtdBaixa || ""}
                          onChange={e => setQuantidadesBaixa(prev => ({ ...prev, [m.id]: e.target.value === "" ? 0 : (parseInt(e.target.value) || 0) }))}
                        />
                      </div>
                      <div>
                        <div className="text-[9px] font-bold uppercase text-muted-foreground">Resultado</div>
                        <div className={`text-sm font-semibold mt-0.5 ${baixaTotal ? "text-red-600" : "text-green-700"}`}>
                          {baixaTotal ? "Remove tudo" : `Resta ${estoqueRestante}`}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Motivo da Baixa <span className="font-normal normal-case text-muted-foreground/70">(opcional)</span></label>
              <Input placeholder="Ex: Consumido em obra, Descarte..." value={motivoBaixa} onChange={e => setMotivoBaixa(e.target.value)} />
            </div>
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" onClick={() => setOpenBaixaModal(false)}>Cancelar</Button>
            <Button onClick={handleConfirmarBaixa} disabled={baixaLote.isPending} className="bg-red-600 hover:bg-red-700 gap-2">
              <PackageMinus className="w-4 h-4" /> {baixaLote.isPending ? "Processando..." : "Confirmar Baixa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL MUDAR OBRA EM LOTE ─────────────────────────────────────────── */}
      <Dialog open={openMudarObraModal} onOpenChange={setOpenMudarObraModal}>
        <DialogContent className="w-[92vw] max-w-lg p-0 overflow-hidden">
          <div className="h-1.5 bg-purple-500" />
          <DialogHeader className="px-6 pt-5 pb-4 border-b bg-purple-50/40">
            <DialogTitle className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-600 text-white">
                <Briefcase className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-lg">Mudar Obra em Lote</span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
                  {selecionadosMudarObra.size} {selecionadosMudarObra.size === 1 ? "material selecionado" : "materiais selecionados"}
                </span>
              </span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 p-6">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Nova Obra Atual</label>
              <select
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none transition-colors focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20"
                value={novaObraIdLote}
                onChange={e => setNovaObraIdLote(e.target.value ? parseInt(e.target.value) : "")}
              >
                <option value="">LIVRE</option>
                {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
              <p className="text-[11px] text-muted-foreground">
                Isso muda só a alocação atual desses materiais — a obra de compra (referência) de cada um continua igual.
              </p>
            </div>

            <div className="rounded-lg border max-h-48 overflow-y-auto divide-y divide-border">
              {(materiais || []).filter(m => selecionadosMudarObra.has(m.id)).map(m => (
                <div key={m.id} className="px-3 py-2 text-xs flex justify-between items-center gap-2">
                  <span className="font-medium truncate">{m.tipo} {m.bitola} — {m.aco}</span>
                  <span className="text-muted-foreground shrink-0">{nomeObra(m)}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" onClick={() => setOpenMudarObraModal(false)}>Cancelar</Button>
            <Button onClick={handleConfirmarMudarObra} disabled={mudarObraLote.isPending} className="bg-purple-600 hover:bg-purple-700 gap-2">
              <Briefcase className="w-4 h-4" /> {mudarObraLote.isPending ? "Aplicando..." : "Confirmar Mudança"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL SOLICITAR SEPARAÇÃO ───────────────────────────────────────── */}
      <Dialog open={openSolicitarModal} onOpenChange={setOpenSolicitarModal}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-700">
              <ArrowRightLeft className="w-5 h-5" /> Solicitar Separação — {selecionadosSolicitar.size} {selecionadosSolicitar.size === 1 ? "item" : "itens"}
            </DialogTitle>
            <DialogDescription>Informe a quantidade e o destino de cada material.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-orange-50 px-3 py-2 text-[10px] font-bold uppercase text-orange-700 grid grid-cols-[1fr_auto] gap-2">
                <span>Material</span><span className="text-right w-32">Qtd Solicitada / Estoque</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-border">
                {(materiais || []).filter(m => selecionadosSolicitar.has(m.id)).map(m => {
                  const qtdSolicitada = quantidadesSolicitar[m.id] ?? m.quantidade;
                  return (
                    <div key={m.id} className="px-3 py-2.5 grid grid-cols-[1fr_auto] gap-3 items-center">
                      <div>
                        <div className="text-xs font-medium">{m.tipo} {m.bitola} — {m.aco}</div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">Estoque disponível: <strong>{m.quantidade} PÇ</strong></div>
                      </div>
                      <div className="flex items-center gap-1.5 w-32">
                        <Input type="number" min={1} max={m.quantidade} className="h-8 text-center text-sm font-bold w-full"
                          value={qtdSolicitada || ""} onChange={e => setQuantidadesSolicitar(prev => ({ ...prev, [m.id]: e.target.value === "" ? 0 : (parseInt(e.target.value) || 0) }))} />
                        <span className="text-[10px] text-muted-foreground whitespace-nowrap">/{m.quantidade}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Obra de Destino</label>
                <select className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
                  value={obraDestinoSolicitar || ""}
                  onChange={e => setObraDestinoSolicitar(e.target.value ? parseInt(e.target.value) : undefined)}>
                  <option value="">Selecione uma obra...</option>
                  {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Data Limite</label>
                <Input type="date" value={dataLimiteSolicitar} onChange={e => setDataLimiteSolicitar(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Observações</label>
              <textarea className="w-full min-h-[80px] p-3 rounded-md border border-input bg-background text-sm"
                placeholder="Detalhes da separação, urgência, etc..."
                value={observacaoSolicitar} onChange={e => setObservacaoSolicitar(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSolicitarModal(false)}>Cancelar</Button>
            <Button onClick={handleConfirmarSolicitacao} disabled={createSolicitacao.isPending} className="bg-orange-600 hover:bg-orange-700 gap-2">
              <ArrowRightLeft className="w-4 h-4" /> {createSolicitacao.isPending ? "Enviando..." : "Finalizar Solicitação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL GRD ───────────────────────────────────────────────────────── */}
      <Dialog open={openGrdModal} onOpenChange={(v) => { setOpenGrdModal(v); if (!v) { setGrdOrigemXml(false); setCertificadosAnexados([]); } }}>
        <DialogContent className="w-[90vw] max-w-[900px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-blue-600" />
              {grdForm.numero && grdForm.obra
                ? `GRD ${grdForm.numero} — ${grdForm.obra}`
                : `Gerar GRD — ${grdOrigemXml && notaGrdXml ? `NF ${notaGrdXml.nf} — ` : ""}${grdOrigemXml ? itensGrdXml.length : selecionados.size} ${(grdOrigemXml ? itensGrdXml.length : selecionados.size) === 1 ? "item" : "itens"}`}
            </DialogTitle>
            <DialogDescription>
              Preencha os dados da capa da Guia de Remessa de Documentos. Número e obra identificam a GRD na listagem depois de salva.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4 p-3 rounded-lg border-2 border-blue-200 bg-blue-50/40">
              <div className="space-y-1">
                <label className="text-xs font-bold text-blue-800 uppercase">Nº Relatório <span className="normal-case font-normal">(automático)</span></label>
                <div className="h-10 px-3 flex items-center rounded-md border border-input bg-muted/60 text-sm font-semibold text-foreground">
                  {grdForm.numero || "..."}
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-blue-800 uppercase">Obra *</label>
                <Input placeholder="Ex: PRÉDIO DE DESTILAÇÃO" value={grdForm.obra} onChange={e => setGrdForm({ ...grdForm, obra: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Data</label>
                <Input type="date" value={grdForm.data} onChange={e => setGrdForm({ ...grdForm, data: e.target.value })} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Cliente</label>
                <Input placeholder="Ex: CARAMURU" value={grdForm.cliente} onChange={e => setGrdForm({ ...grdForm, cliente: e.target.value })} />
              </div>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground">Itens na GRD{grdOrigemXml && notaGrdXml ? ` — NF ${notaGrdXml.nf}` : ""}</div>
              <div className="max-h-40 overflow-y-auto divide-y divide-border">
                {grdOrigemXml
                  ? itensGrdXml.map((item, idx) => (
                      <div key={idx} className="px-3 py-1.5 text-xs flex justify-between items-center">
                        <span className="font-medium">{item.tipo} {item.bitola} — {item.aco}</span>
                        <span className="text-muted-foreground">{item.quantidade}PÇ × {(item.comprimento || 0).toLocaleString("pt-BR")}mm</span>
                      </div>
                    ))
                  : (materiais || []).filter(m => selecionados.has(m.id)).map(m => (
                      <div key={m.id} className="px-3 py-1.5 text-xs flex justify-between items-center">
                        <span className="font-medium">{m.tipo} {m.bitola} — {m.aco}</span>
                        <span className="text-muted-foreground">{m.quantidade}PÇ × {(m.comprimento || 0).toLocaleString("pt-BR")}mm</span>
                      </div>
                    ))}
              </div>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 text-[10px] font-bold uppercase text-muted-foreground flex items-center justify-between">
                <span>Certificados (opcional)</span>
                <label className="cursor-pointer text-blue-700 hover:text-blue-900 font-semibold normal-case flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Anexar PDF
                  <input
                    type="file"
                    accept="application/pdf"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const novos = Array.from(e.target.files || []);
                      setCertificadosAnexados(prev => [...prev, ...novos]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              {certificadosAnexados.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">
                  Nenhum certificado anexado ainda — a GRD será salva sem certificado, e você pode voltar aqui depois.
                </div>
              ) : (
                <div className="max-h-32 overflow-y-auto divide-y divide-border">
                  {certificadosAnexados.map((file, idx) => (
                    <div key={idx} className="px-3 py-1.5 text-xs flex justify-between items-center gap-2">
                      <span className="truncate flex items-center gap-1.5"><FileText className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> {file.name}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-muted-foreground">{(file.size / 1024).toFixed(0)} KB</span>
                        <button type="button" onClick={() => setCertificadosAnexados(prev => prev.filter((_, i) => i !== idx))} className="text-muted-foreground hover:text-destructive">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpenGrdModal(false); setGrdOrigemXml(false); setCertificadosAnexados([]); }}>Cancelar</Button>
            <Button onClick={handleGerarGrd} disabled={gerarGrdMutation.isPending} className="bg-blue-600 hover:bg-blue-700 gap-2">
              <Download className="w-4 h-4" /> {gerarGrdMutation.isPending ? "Gerando..." : "Gerar e Baixar GRD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL EMBARGO: MATERIAL DUPLICADO (MESMA CORRIDA) ───────────────── */}
      <Dialog open={!!duplicadosEncontrados} onOpenChange={(open) => { if (!open) cancelarPorDuplicidade(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="w-5 h-5" /> Possível cadastro duplicado
            </DialogTitle>
            <DialogDescription>
              Já existe material ativo no estoque com o mesmo tipo, bitola, aço e corrida:
            </DialogDescription>
          </DialogHeader>
          <ul className="text-sm space-y-1 max-h-40 overflow-y-auto rounded-md border bg-muted/20 p-3">
            {duplicadosEncontrados?.map((desc, idx) => (
              <li key={idx} className="flex items-start gap-2">
                <span className="text-amber-600">•</span> {desc}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={cancelarPorDuplicidade}>Cancelar e revisar</Button>
            <Button onClick={confirmarApesarDaDuplicidade} className="bg-amber-600 hover:bg-amber-700">Continuar mesmo assim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL EMBARGO: NF JÁ IMPORTADA ANTES ────────────────────────────── */}
      <Dialog open={!!nfDuplicadaInfo} onOpenChange={(open) => { if (!open) cancelarImportacaoDuplicada(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="w-5 h-5" /> Essa nota já foi importada antes
            </DialogTitle>
            <DialogDescription>
              {nfDuplicadaInfo && (
                <>
                  A NF <strong>{nfDuplicadaInfo.nota.nf}</strong>{nfDuplicadaInfo.nota.fornecedor ? ` (${nfDuplicadaInfo.nota.fornecedor})` : ""} já gerou <strong>{nfDuplicadaInfo.totalItens}</strong> {nfDuplicadaInfo.totalItens === 1 ? "material" : "materiais"} no
                  sistema em <strong>{format(new Date(nfDuplicadaInfo.dataImportacao), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</strong>.
                  Importar de novo pode duplicar o estoque. Confirme se realmente é isso que você quer fazer.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelarImportacaoDuplicada}>Cancelar importação</Button>
            <Button onClick={confirmarImportacaoMesmoAssim} className="bg-amber-600 hover:bg-amber-700">Continuar mesmo assim</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL RELATÓRIOS SALVOS (ver materiais, baixar, editar, excluir) ── */}
      <RelatoriosRecebimentoSalvos
        open={openRelatoriosSalvos}
        onOpenChange={setOpenRelatoriosSalvos}
        podeAdministrar={podeAdministrarRelatorios}
        locais={locaisAtivos}
      />

      {/* ─── MODAL CONFIGURAÇÃO DO RELATÓRIO DE RECEBIMENTO ─────────────────── */}
      <Dialog open={openRelatorioModal} onOpenChange={(open) => { if (open) setOpenRelatorioModal(true); else if (!gerandoRelatorio) fecharConfiguracaoRelatorio(); }}>
        <DialogContent className="w-[94vw] max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <div className="h-1.5 bg-[#d6a21b]" />
          <DialogHeader className="px-6 pt-5 pb-4 border-b bg-[#f8f6f1]/70">
            <DialogTitle className="flex items-center gap-3 text-[#1a2332]">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1a2332] text-[#d6a21b]">
                <FileDown className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-lg">Configurar relatório de recebimento</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">Complete as referências e as conferências de cada carga antes de gerar o documento. O relatório fica salvo no sistema, com um número de identificação próprio, para consulta futura.</span>
              </span>
            </DialogTitle>
            <DialogDescription className="sr-only">Dados de rastreabilidade do relatório de recebimento.</DialogDescription>
          </DialogHeader>

          {relatorioDados && (
            <div className="space-y-5 p-6">
              <div className="grid grid-cols-3 gap-3 rounded-xl border border-border/80 bg-[#fbfcfd] p-4 text-center text-xs">
                <div><div className="text-lg font-bold text-[#1a2332]">{relatorioDados.cargas.length}</div><div className="text-muted-foreground">{relatorioDados.cargas.length === 1 ? "carga (nota fiscal)" : "cargas (notas fiscais)"}</div></div>
                <div><div className="text-lg font-bold text-[#1a2332]">{relatorioDados.cargas.reduce((soma, carga) => soma + carga.itens.length, 0)}</div><div className="text-muted-foreground">itens selecionados</div></div>
                <div><div className="text-lg font-bold text-[#1a2332]">{formatKg(pesoDosItens(relatorioDados.cargas.flatMap(carga => carga.itens)))} kg</div><div className="text-muted-foreground">peso dos materiais</div></div>
              </div>
              <RelatorioRecebimentoForm
                dados={relatorioDados}
                onChange={setRelatorioDados}
                locais={locaisAtivos}
                fotosNovas={fotosNovasRelatorio}
                onFotosNovasChange={setFotosNovasRelatorio}
              />
            </div>
          )}

          <DialogFooter className="border-t bg-muted/20 px-6 py-4">
            <Button variant="outline" disabled={gerandoRelatorio} onClick={fecharConfiguracaoRelatorio}>Cancelar</Button>
            <Button onClick={gerarRelatorioConfigurado} disabled={gerandoRelatorio} className="gap-2 bg-[#1a2332] text-white hover:bg-[#253249]">
              <Download className="h-4 w-4" /> {gerandoRelatorio ? "Salvando..." : "Salvar e Baixar PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── MODAL XML ───────────────────────────────────────────────────────── */}
      <Dialog open={openXml} onOpenChange={(v) => { if (!v) fecharImportacaoXml(); else setOpenXml(true); }}>
        <DialogContent className="!w-[98vw] !max-w-[1800px] h-[96vh] p-0 overflow-hidden flex flex-col">
          <DialogHeader className="px-6 py-4 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileCode className="w-5 h-5 text-blue-600" /> Importar Notas Fiscais (XML)
            </DialogTitle>
          </DialogHeader>
          {mostrarPosSalvamento ? (
            <div className="flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 p-8">
                <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="w-9 h-9 text-green-600" />
                </div>
                <div className="text-center space-y-1">
                  <h3 className="text-lg font-bold">Materiais importados com sucesso!</h3>
                  <p className="text-sm text-muted-foreground">
                    {(() => {
                      const totalItens = notasSalvasXml.reduce((s, nota) => s + nota.itens.length, 0);
                      return `${totalItens} ${totalItens === 1 ? "item cadastrado" : "itens cadastrados"}${notasSalvasXml.length > 1 ? ` em ${notasSalvasXml.length} notas` : ""}`;
                    })()}. Se precisar, gere os documentos abaixo — é opcional.
                  </p>
                </div>

                {/* GRD — uma por nota */}
                <div className="w-full overflow-hidden rounded-xl border">
                  <div className="bg-muted/50 px-4 py-2 text-[10px] font-bold uppercase text-muted-foreground">
                    GRD — {notasSalvasXml.length > 1 ? "uma por nota fiscal" : "nota fiscal"}
                  </div>
                  <div className="divide-y">
                    {notasSalvasXml.map((nota) => (
                      <div key={nota.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold">NF {nota.nf}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {nota.fornecedor} · {nota.itens.length} {nota.itens.length === 1 ? "item" : "itens"} · {formatKg(pesoItensXml(nota.itens), 3)} kg
                          </div>
                        </div>
                        {nota.grdGerada && (
                          <span className="flex items-center gap-1 text-xs font-medium text-green-700">
                            <CheckCircle2 className="w-3.5 h-3.5" /> GRD gerada
                          </span>
                        )}
                        <Button
                          size="sm"
                          variant={nota.grdGerada ? "outline" : "default"}
                          onClick={() => handleAbrirGrdDeXml(nota.id)}
                          className={`gap-2 ${nota.grdGerada ? "" : "bg-blue-600 hover:bg-blue-700"}`}
                        >
                          <FileText className="w-4 h-4" /> {nota.grdGerada ? "Gerar de novo" : "Gerar GRD"}
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Relatório de Recebimento — um só para a carga inteira */}
                <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/40 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Relatório de Recebimento</div>
                    <div className="text-xs text-muted-foreground">
                      {notasSalvasXml.length > 1
                        ? `Um único relatório com as ${notasSalvasXml.length} notas — cada nota entra como uma carga.`
                        : "Um relatório com os materiais desta nota."}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => abrirConfiguracaoRelatorio(true)}
                    variant="outline"
                    className="gap-2 border-emerald-300 bg-white text-emerald-700 hover:bg-emerald-50"
                  >
                    <FileDown className="w-4 h-4" /> Gerar Relatório
                  </Button>
                </div>

                <Button variant="ghost" onClick={fecharImportacaoXml}>Fechar</Button>
              </div>
            </div>
          ) : !notasXml.length ? (
            <div className="p-12 border-2 border-dashed rounded-lg flex flex-col items-center gap-4 bg-muted/20 m-6">
              <FileCode className="w-12 h-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                {processandoXml ? "Lendo os arquivos..." : "Selecione um ou mais arquivos XML de NF-e — cada nota fica no seu próprio bloco."}
              </p>
              <Input type="file" accept=".xml" multiple disabled={processandoXml} onChange={handleXmlUpload} className="max-w-xs" />
            </div>
          ) : (
            <>
              {/* Resumo da carga + atalhos para cada nota */}
              <div className="shrink-0 border-b bg-muted/30 px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <div className="text-sm whitespace-nowrap">
                  <strong>{notasXml.length}</strong> {notasXml.length === 1 ? "nota" : "notas"} ·{" "}
                  <strong>{notasXml.reduce((s, nota) => s + nota.itens.length, 0)}</strong> itens ·{" "}
                  <strong>{formatKg(notasXml.reduce((s, nota) => s + pesoItensXml(nota.itens), 0), 3)}</strong> kg
                </div>
                {notasXml.length > 1 && (
                  <div className="flex flex-1 flex-wrap gap-1.5">
                    {notasXml.map((nota, indice) => (
                      <button
                        key={nota.id}
                        type="button"
                        title={nota.local ? nota.fornecedor : "Falta o local de descarga"}
                        onClick={() => {
                          setNotasRecolhidasXml(prev => { const s = new Set(prev); s.delete(nota.id); return s; });
                          setTimeout(() => document.getElementById(`nota-xml-${nota.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
                        }}
                        className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] font-medium hover:border-blue-400 hover:text-blue-700"
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${nota.local ? "bg-green-500" : "bg-amber-500"}`} />
                        {String(indice + 1).padStart(2, "0")} · NF {nota.nf}
                      </button>
                    ))}
                  </div>
                )}
                <label className={`ml-auto flex items-center gap-1.5 rounded-md border border-blue-300 bg-background px-3 py-1.5 text-xs font-semibold text-blue-700 ${processandoXml ? "opacity-60" : "cursor-pointer hover:bg-blue-50"}`}>
                  <Plus className="w-3.5 h-3.5" /> {processandoXml ? "Lendo..." : "Adicionar notas"}
                  <input type="file" accept=".xml" multiple disabled={processandoXml} className="hidden" onChange={handleXmlUpload} />
                </label>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto bg-muted/10 p-6">
                {locaisAtivos?.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum local cadastrado ainda. Cadastre em "Locais" no menu.</p>
                )}
                {notasXml.map((nota, indice) => {
                  const recolhida = notasRecolhidasXml.has(nota.id);
                  const pesoAtual = pesoItensXml(nota.itens);
                  const diferenca = pesoAtual - nota.pesoOriginal;
                  // Tolerância pequena pra arredondamento (0.05 kg) não disparar alerta à toa.
                  const bate = Math.abs(diferenca) < 0.05;
                  return (
                    <section key={nota.id} id={`nota-xml-${nota.id}`} className="overflow-hidden rounded-xl border bg-background shadow-sm">
                      <header className="flex flex-wrap items-center gap-3 border-b bg-blue-50 px-4 py-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600 text-xs font-bold text-white">
                          {String(indice + 1).padStart(2, "0")}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-blue-900">NF {nota.nf}</div>
                          <div className="truncate text-xs text-blue-900/70">{nota.fornecedor}</div>
                        </div>
                        {!nota.local && (
                          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                            <AlertCircle className="w-3 h-3" /> Falta o local de descarga
                          </span>
                        )}
                        <span className="text-xs text-blue-900/70 whitespace-nowrap">
                          {nota.itens.length} {nota.itens.length === 1 ? "item" : "itens"} · {formatKg(pesoAtual, 3)} kg
                        </span>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title={recolhida ? "Expandir nota" : "Recolher nota"} onClick={() => alternarNotaRecolhidaXml(nota.id)}>
                          <ChevronDown className={`w-4 h-4 transition-transform ${recolhida ? "-rotate-90" : ""}`} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" title="Remover esta nota" onClick={() => removerNotaXml(nota.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </header>
                      {/* Recolher só esconde — os itens continuam montados pra não perder o cálculo já aplicado. */}
                      <div className={recolhida ? "hidden" : "space-y-4 p-4"}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-blue-50 rounded-lg text-sm">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-blue-700 whitespace-nowrap">Nº PEDIDO:</span>
                            <Input className="h-7 text-xs bg-white" placeholder="Opcional" value={nota.pedido} onChange={e => atualizarNotaXml(nota.id, { pedido: e.target.value })} />
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-blue-700 whitespace-nowrap">LOCAL DE DESCARGA: <span className="text-destructive">*</span></span>
                            <select
                              className="h-7 flex-1 min-w-0 text-xs rounded-md border border-input bg-white px-2 outline-none focus:border-[#d6a21b] focus:ring-2 focus:ring-[#d6a21b]/20"
                              value={nota.local}
                              onChange={e => atualizarNotaXml(nota.id, { local: e.target.value })}
                            >
                              <option value="">Selecione...</option>
                              {locaisAtivos?.map((l) => (
                                <option key={l.id} value={l.nome}>{l.nome}</option>
                              ))}
                            </select>
                            {notasXml.length > 1 && nota.local && notasXml.some(n => n.local !== nota.local) && (
                              <button
                                type="button"
                                className="whitespace-nowrap text-[11px] font-semibold text-blue-700 underline-offset-2 hover:underline"
                                onClick={() => setNotasXml(prev => prev.map(n => ({ ...n, local: nota.local })))}
                              >
                                Usar em todas
                              </button>
                            )}
                          </div>
                        </div>
                        <div className={`grid grid-cols-3 gap-4 p-4 rounded-lg text-sm border ${bate ? "bg-green-50 border-green-200" : "bg-yellow-50 border-yellow-300"}`}>
                          <div>
                            <div className="text-xs text-muted-foreground uppercase">Peso Total da Nota</div>
                            <div className="font-bold text-base">{nota.pesoOriginal.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground uppercase">Peso a Ser Cadastrado</div>
                            <div className="font-bold text-base">{pesoAtual.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg</div>
                          </div>
                          <div>
                            <div className="text-xs text-muted-foreground uppercase">Diferença</div>
                            <div className={`font-bold text-base flex items-center gap-1 ${bate ? "text-green-700" : "text-yellow-700"}`}>
                              {bate ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                              {diferenca >= 0 ? "+" : ""}{diferenca.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} kg
                            </div>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border rounded-lg">
                            <thead className="bg-muted">
                              <tr>
                                <th className="p-2">Categoria / Material</th><th className="p-2">Qtd / Dimensões</th>
                                <th className="p-2">Peso NF</th><th className="p-2">Cert / Corrida</th>
                                <th className="p-2">Obra</th><th className="p-2">Obra de Compra</th><th className="p-2"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {nota.itens.map((item, idx) => (
                                <XmlItemRow key={idx} item={item} idx={idx} obras={obras}
                                  onChange={(updated) => { const ni = [...nota.itens]; ni[idx] = updated; atualizarItensNotaXml(nota.id, ni); }}
                                  onRemove={() => atualizarItensNotaXml(nota.id, nota.itens.filter((_, i) => i !== idx))} />
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </section>
                  );
                })}
              </div>

              <div className="shrink-0 border-t bg-background px-6 py-3 flex justify-end gap-2">
                <Button variant="outline" onClick={limparImportacaoXml}>Limpar</Button>
                <Button onClick={confirmarImportacaoXml} disabled={createMaterial.isPending || processandoXml} className="bg-blue-600 hover:bg-blue-700">
                  {createMaterial.isPending
                    ? "Salvando..."
                    : `Confirmar Importação (${notasXml.reduce((s, nota) => s + nota.itens.length, 0)}${notasXml.length > 1 ? ` itens em ${notasXml.length} notas` : ""})`}
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* ─── MODAL SEPARAR ───────────────────────────────────────────────────── */}
      <Dialog open={openSeparar} onOpenChange={setOpenSeparar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Separar Material para Obra</DialogTitle>
            <DialogDescription>Selecione o destino para o material.</DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-2">
            <label className="text-sm font-medium">Destino (Obra)</label>
            <select className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
              value={sepObraId || ""} onChange={e => setSepObraId(e.target.value ? parseInt(e.target.value) : undefined)}>
              <option value="">LIVRE / VOLTAR PRO ESTOQUE</option>
              {obras?.map(o => <option key={o.id} value={o.id}>{o.nome}</option>)}
            </select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenSeparar(false)}>Cancelar</Button>
            <Button onClick={confirmarSeparacao}>Confirmar Separação</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StockDashboardLayout>
  );
}
// ── Sinalização de material separado em requisição de produção ─────────────
// Fica visível até o ADM aprovar (baixa) ou a requisição ser rejeitada/cancelada.
function BadgeReservaProducao({ reserva }: { reserva?: { pecas: number; requisicaoId: number; numeros: string[]; aguardandoAdm: boolean } }) {
  if (!reserva) return null;

  return (
    <a
      href={`/solicitacoes?aba=producao&req=${reserva.requisicaoId}`}
      onClick={(e) => e.stopPropagation()}
      title={`${reserva.pecas} peça(s) separada(s) na(s) requisição(ões) ${reserva.numeros.join(", ")} — ${reserva.aguardandoAdm ? "aguardando aprovação do ADM" : "separação em andamento"}`}
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase ${reserva.aguardandoAdm ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400" : "bg-indigo-100 text-indigo-700"}`}
    >
      <QrCode className="w-2.5 h-2.5" />
      {reserva.aguardandoAdm ? "Aguardando ADM" : "Em separação"} · {reserva.pecas} pç · Req. {reserva.numeros.join(", ")}
    </a>
  );
}
