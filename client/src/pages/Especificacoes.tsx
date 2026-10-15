import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Plus, Search, Edit2, Trash2,
  FileSpreadsheet, ChevronLeft, ChevronRight, Eye, SlidersHorizontal, X, ListChecks
} from "lucide-react";
import * as XLSX from "xlsx";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";

// ─── Tipos ─────────────────────────────────────────────────────────────────────
interface EspecForm {
  tipo: string;
  bitola: string;
  aco: string;
  pesoPorMetro: string;
  categoria: string;
  estoqueMinimo: string;
  valorUnitario: string;
}
const emptyForm = (): EspecForm => ({ tipo: "", bitola: "", aco: "", pesoPorMetro: "", categoria: "PERFIL", estoqueMinimo: "", valorUnitario: "" });

// ─── Popup detalhes mobile ──────────────────────────────────────────────────────
function EspecDetailDialog({ esp, open, onOpenChange, onEdit, onDelete }: {
  esp: any;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onEdit: (e: any) => void;
  onDelete: (e: any) => void;
}) {
  if (!esp) return null;

  const unidade = esp.categoria === "CHAPA" ? "kg/m²" : "kg/m";
  const rows = [
    { label: "Categoria",   value: esp.categoria || "PERFIL" },
    { label: "Tipo",        value: esp.tipo },
    { label: "Bitola",      value: esp.bitola },
    { label: "Aço",         value: esp.aco },
    { label: "Peso base",   value: `${esp.pesoPorMetro} ${unidade}` },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm mx-4">
        <DialogHeader>
          <DialogTitle className="text-base">{esp.tipo} {esp.bitola}</DialogTitle>
          <DialogDescription className="text-xs">{esp.aco} · {esp.categoria || "PERFIL"}</DialogDescription>
        </DialogHeader>
        <div className="divide-y divide-border rounded-md border overflow-hidden">
          {rows.map(r => (
            <div key={r.label} className="grid grid-cols-[100px_1fr] text-sm">
              <span className="px-3 py-2 bg-muted/40 text-muted-foreground text-xs font-medium">{r.label}</span>
              <span className="px-3 py-2 font-medium break-words">{r.value}</span>
            </div>
          ))}
        </div>
        <DialogFooter className="flex gap-2 pt-2">
          <PermissionGate permission="especificacoes:editar"><Button variant="outline" size="sm" className="flex-1" onClick={() => { onOpenChange(false); onEdit(esp); }}><Edit2 className="w-3.5 h-3.5 mr-1.5" /> Editar</Button></PermissionGate>
          <PermissionGate permission="especificacoes:editar"><Button variant="destructive" size="sm" className="flex-1" onClick={() => { onOpenChange(false); onDelete(esp); }}><Trash2 className="w-3.5 h-3.5 mr-1.5" /> Excluir</Button></PermissionGate>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Componente principal ───────────────────────────────────────────────────────
export default function Especificacoes() {
  const utils = trpc.useContext();
  const [page, setPage]     = useState(1);
  const [search, setSearch] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroTipo, setFiltroTipo]           = useState("");
  const [filtroAco, setFiltroAco]             = useState("");
  const [filtrosAbertos, setFiltrosAbertos]   = useState(false);

  const [showForm, setShowForm]   = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData]   = useState<EspecForm>(emptyForm());

  const [deleteId, setDeleteId]       = useState<number | null>(null);
  const [deleteLabel, setDeleteLabel] = useState("");

  // Mobile: popup detalhes
  const [detalheItem, setDetalheItem] = useState<any>(null);
  const [openDetalhe, setOpenDetalhe] = useState(false);

  const { data, isLoading, refetch } = trpc.especificacoes.list.useQuery(
    { page, pageSize: 50, search, categoria: filtroCategoria || undefined, tipo: filtroTipo || undefined, aco: filtroAco || undefined },
    { keepPreviousData: true }
  );

  const especificacoes = data?.data || [];
  const totalPages     = data?.totalPages || 1;
  const totalItems     = data?.total || 0;

  // Lista completa (não paginada) só pra alimentar as sugestões de Tipo/Aço —
  // evita que o dropdown mostre só os valores da página atual da tabela.
  const { data: todasEspecificacoes } = trpc.especificacoes.listar.useQuery();
  const tiposConhecidos = useMemo(() => {
    return Array.from(new Set(
      (todasEspecificacoes || [])
        .filter(e => (e.categoria || "PERFIL") === (formData.categoria || "PERFIL"))
        .map(e => e.tipo)
    )).sort();
  }, [todasEspecificacoes, formData.categoria]);
  const acosConhecidos = useMemo(() => {
    return Array.from(new Set((todasEspecificacoes || []).map(e => e.aco))).sort();
  }, [todasEspecificacoes]);
  const todosTiposFiltro = useMemo(() => {
    return Array.from(new Set((todasEspecificacoes || []).map(e => e.tipo))).sort();
  }, [todasEspecificacoes]);

  const temFiltroAtivo = !!(filtroCategoria || filtroTipo || filtroAco);
  const limparFiltros = () => { setFiltroCategoria(""); setFiltroTipo(""); setFiltroAco(""); setPage(1); };

  const inicio = (page - 1) * 50 + 1;
  const fim    = Math.min(page * 50, totalItems);

  const createMutation = trpc.especificacoes.create.useMutation();
  const updateMutation = trpc.especificacoes.update.useMutation();
  const atualizarLotePorTipoMutation = trpc.especificacoes.atualizarValorPorTipo.useMutation();

  const [openLote, setOpenLote] = useState(false);
  // Chave do grupo = "categoria|tipo" — evita colidir tipos com o mesmo código
  // que existem em categorias diferentes (ex: "CH" existe tanto em PERFIL
  // quanto em CHAPA, com pesos/preços que não têm relação entre si).
  const [valoresPorTipo, setValoresPorTipo] = useState<Record<string, string>>({});
  const [salvandoLote, setSalvandoLote] = useState(false);
  const deleteMutation = trpc.especificacoes.delete.useMutation();

  // Agrupa as especificações por tipo+categoria pra atribuição em lote —
  // preenchendo um valor por kg aqui, ele é aplicado a TODAS as especificações
  // daquele tipo de uma vez (ex: todo tipo "TB" ganha o mesmo valor), em vez de
  // precisar preencher item por item — inviável pra tipos com milhares de
  // bitolas/aços cadastrados.
  const gruposPorTipo = useMemo(() => {
    const mapa = new Map<string, { chave: string; categoria: string; tipo: string; qtd: number; comValor: number }>();
    for (const esp of todasEspecificacoes || []) {
      const categoria = esp.categoria || "PERFIL";
      const chave = `${categoria}|${esp.tipo}`;
      if (!mapa.has(chave)) mapa.set(chave, { chave, categoria, tipo: esp.tipo, qtd: 0, comValor: 0 });
      const g = mapa.get(chave)!;
      g.qtd++;
      if (esp.valorUnitario !== null && esp.valorUnitario !== undefined) g.comValor++;
    }
    return Array.from(mapa.values()).sort((a, b) =>
      a.categoria === b.categoria ? a.tipo.localeCompare(b.tipo) : a.categoria.localeCompare(b.categoria)
    );
  }, [todasEspecificacoes]);

  const totalAfetadoPorLote = useMemo(() => {
    return gruposPorTipo
      .filter(g => {
        const v = valoresPorTipo[g.chave];
        return v !== undefined && v !== "" && !isNaN(parseFloat(v.replace(",", ".")));
      })
      .reduce((soma, g) => soma + g.qtd, 0);
  }, [gruposPorTipo, valoresPorTipo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      tipo:         formData.tipo.trim().toUpperCase(),
      bitola:       formData.bitola.trim().toUpperCase(),
      aco:          formData.aco.trim().toUpperCase(),
      pesoPorMetro: formData.pesoPorMetro.replace(",", "."),
      categoria:    formData.categoria,
      unidade:      "mm",
      estoqueMinimo: formData.estoqueMinimo ? formData.estoqueMinimo.replace(",", ".") : "0",
      valorUnitario: formData.valorUnitario ? formData.valorUnitario.replace(",", ".") : undefined,
    };
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...payload });
        toast.success("Especificação atualizada!");
      } else {
        await createMutation.mutateAsync(payload);
        toast.success("Especificação cadastrada!");
      }
      setFormData(emptyForm()); setShowForm(false); setEditingId(null); refetch();
    } catch { toast.error("Erro ao salvar especificação"); }
  };

  const openEdit = (esp: any) => {
    setEditingId(esp.id);
    setFormData({
      tipo: esp.tipo, bitola: esp.bitola, aco: esp.aco, pesoPorMetro: String(esp.pesoPorMetro), categoria: esp.categoria || "PERFIL",
      estoqueMinimo: esp.estoqueMinimo !== undefined && esp.estoqueMinimo !== null ? String(esp.estoqueMinimo) : "",
      valorUnitario: esp.valorUnitario !== undefined && esp.valorUnitario !== null ? String(esp.valorUnitario) : "",
    });
    setShowForm(true);
  };

  const openDelete = (esp: any) => {
    setDeleteId(esp.id);
    setDeleteLabel(`${esp.tipo} ${esp.bitola} — ${esp.aco}`);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteMutation.mutateAsync({ id: deleteId });
      toast.success("Especificação removida.");
      setDeleteId(null); refetch();
    } catch { toast.error("Erro ao remover especificação."); }
  };

  // ── Importação Excel ───────────────────────────────────────────────────────
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so same file can be re-selected

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const wb   = XLSX.read(evt.target?.result, { type: "binary" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws) as any[];

        toast.promise(
          utils.client.especificacoes.importarExcel.mutate({ dados: json }),
          {
            loading: "Importando base técnica...",
            success: (res) => {
              refetch();
              return `${res.total} especificações importadas!`;
            },
            error: "Erro na importação",
          }
        );
      } catch {
        toast.error("Erro ao ler arquivo Excel.");
      }
    };
    reader.readAsBinaryString(file);
  };

  // Badge de categoria
  const CategoriaBadge = ({ cat }: { cat: string }) => (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cat === "CHAPA" ? "bg-blue-100 text-blue-700" : "bg-orange-100 text-orange-700"}`}>
      {cat || "PERFIL"}
    </span>
  );

  return (
    <StockDashboardLayout>
      <div className="space-y-8">

        {/* Cabeçalho */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold">Especificações Técnicas</h2>
            <p className="text-muted-foreground mt-1">Base de dados de pesos por metro ({totalItems} itens).</p>
          </div>
          <div className="flex gap-2">
            <label className="cursor-pointer">
              <Input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleImport} />
              <PermissionGate permission="especificacoes:editar">
                <Button variant="outline" className="gap-2" asChild>
                  <span><FileSpreadsheet className="w-4 h-4" /> Importar Excel</span>
                </Button>
              </PermissionGate>
            </label>
            <PermissionGate permission="especificacoes:editar">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  setValoresPorTipo({});
                  setOpenLote(true);
                }}
              >
                <ListChecks className="w-4 h-4" /> Atribuir Valores por Tipo
              </Button>
            </PermissionGate>
            <PermissionGate permission="especificacoes:editar">
              <Button onClick={() => { setEditingId(null); setFormData(emptyForm()); setShowForm(true); }} className="gap-2 bg-accent hover:bg-accent/90">
                <Plus className="w-4 h-4" /> Nova Especificação
              </Button>
            </PermissionGate>
          </div>
        </div>

        {/* Busca */}
        <Card className="p-4 border border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por Tipo, Bitola ou Aço..."
                className="pl-10"
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
              />
            </div>
            <Button
              variant={filtrosAbertos ? "default" : "outline"}
              size="sm"
              className="gap-1.5 shrink-0"
              onClick={() => setFiltrosAbertos(v => !v)}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">Filtros</span>
              {temFiltroAtivo && <span className="w-2 h-2 rounded-full bg-accent inline-block" />}
            </Button>
            {temFiltroAtivo && (
              <Button variant="ghost" size="sm" onClick={limparFiltros} className="gap-1 text-muted-foreground shrink-0">
                <X className="w-3.5 h-3.5" /><span className="hidden sm:inline">Limpar</span>
              </Button>
            )}
          </div>

          {filtrosAbertos && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 mt-3 bg-background rounded-lg border border-border">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Categoria</label>
                <select
                  className="h-8 w-full text-xs rounded-md border border-input bg-background px-2"
                  value={filtroCategoria}
                  onChange={e => { setFiltroCategoria(e.target.value); setPage(1); }}
                >
                  <option value="">Todas</option>
                  <option value="PERFIL">Perfil</option>
                  <option value="CHAPA">Chapa</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Tipo</label>
                <select
                  className="h-8 w-full text-xs rounded-md border border-input bg-background px-2"
                  value={filtroTipo}
                  onChange={e => { setFiltroTipo(e.target.value); setPage(1); }}
                >
                  <option value="">Todos</option>
                  {todosTiposFiltro.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground font-medium">Aço</label>
                <select
                  className="h-8 w-full text-xs rounded-md border border-input bg-background px-2"
                  value={filtroAco}
                  onChange={e => { setFiltroAco(e.target.value); setPage(1); }}
                >
                  <option value="">Todos</option>
                  {acosConhecidos.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
            </div>
          )}
        </Card>

        {/* Tabela */}
        <Card className="overflow-hidden border border-border">

          {/* ── DESKTOP ─────────────────────────────────────────────────────── */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-bold">
                <tr>
                  <th className="px-4 py-3">Categoria</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Bitola (mm)</th>
                  <th className="px-4 py-3">Aço</th>
                  <th className="px-4 py-3">Peso Base</th>
                  <th className="px-4 py-3">Estoque Mín.</th>
                  <th className="px-4 py-3">Valor (R$/kg)</th>
                  <th className="px-4 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Carregando base técnica...</td></tr>
                ) : especificacoes.map(esp => (
                  <tr key={esp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3"><CategoriaBadge cat={esp.categoria} /></td>
                    <td className="px-4 py-3 font-medium">{esp.tipo}</td>
                    <td className="px-4 py-3">{esp.bitola}</td>
                    <td className="px-4 py-3">{esp.aco}</td>
                    <td className="px-4 py-3 font-mono">
                      {esp.pesoPorMetro}
                      <span className="text-[10px] text-muted-foreground ml-1">{esp.categoria === "CHAPA" ? "kg/m²" : "kg/m"}</span>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {esp.estoqueMinimo && parseFloat(String(esp.estoqueMinimo)) > 0
                        ? <>{esp.estoqueMinimo}<span className="text-[10px] text-muted-foreground ml-1">kg</span></>
                        : <span className="text-muted-foreground text-xs">não monitorado</span>}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {esp.valorUnitario
                        ? `R$ ${parseFloat(String(esp.valorUnitario)).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                        : <span className="text-muted-foreground text-xs">não definido</span>}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      <PermissionGate permission="especificacoes:editar"><Button variant="ghost" size="icon" title="Editar" onClick={() => openEdit(esp)}><Edit2 className="w-4 h-4" /></Button></PermissionGate>
                      <PermissionGate permission="especificacoes:editar"><Button variant="ghost" size="icon" className="text-destructive" title="Remover" onClick={() => openDelete(esp)}><Trash2 className="w-4 h-4" /></Button></PermissionGate>
                    </td>
                  </tr>
                ))}
                {especificacoes.length === 0 && !isLoading && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">Nenhuma especificação encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── MOBILE ──────────────────────────────────────────────────────── */}
          <div className="md:hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-muted/50 text-muted-foreground uppercase text-[10px] font-bold">
                <tr>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Bitola</th>
                  <th className="px-3 py-2 text-right">Peso</th>
                  <th className="px-3 py-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {isLoading ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Carregando...</td></tr>
                ) : especificacoes.map(esp => (
                  <tr key={esp.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-xs leading-tight">{esp.tipo}</div>
                      <div className="mt-0.5"><CategoriaBadge cat={esp.categoria} /></div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-xs font-medium">{esp.bitola}</div>
                      <div className="text-[10px] text-muted-foreground">{esp.aco}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="font-mono text-xs font-bold">{esp.pesoPorMetro}</span>
                      <div className="text-[9px] text-muted-foreground">{esp.categoria === "CHAPA" ? "kg/m²" : "kg/m"}</div>
                    </td>
                    <td className="px-2 py-2.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7"
                        onClick={() => { setDetalheItem(esp); setOpenDetalhe(true); }}>
                        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {especificacoes.length === 0 && !isLoading && (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">Nenhuma especificação encontrada.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 bg-muted/20 border-t border-border">
              <span className="text-xs text-muted-foreground">
                {totalPages > 1 ? <>Exibindo <strong>{inicio}–{fim}</strong> de <strong>{totalItems}</strong></> : <>{totalItems} item(s)</>}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(1)} disabled={page === 1} title="Primeira">
                  <ChevronLeft className="w-3 h-3" /><ChevronLeft className="w-3 h-3 -ml-2" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="w-3 h-3" />
                </Button>
                <span className="px-3 py-1 text-xs font-medium bg-background border rounded-md">{page} / {totalPages}</span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="w-3 h-3" />
                </Button>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => setPage(totalPages)} disabled={page === totalPages} title="Última">
                  <ChevronRight className="w-3 h-3" /><ChevronRight className="w-3 h-3 -ml-2" />
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* ── POPUP DETALHES (mobile) ────────────────────────────────────────── */}
      <EspecDetailDialog
        esp={detalheItem}
        open={openDetalhe}
        onOpenChange={setOpenDetalhe}
        onEdit={openEdit}
        onDelete={openDelete}
      />

      {/* ── MODAL CRIAR / EDITAR ──────────────────────────────────────────── */}
      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) setEditingId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Especificação" : "Nova Especificação Técnica"}</DialogTitle>
            <DialogDescription>
              {editingId ? "Altere os dados do perfil selecionado." : "Cadastre o peso por metro para um novo perfil de material."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Categoria</label>
              <select className="w-full h-10 px-3 rounded-md border border-input bg-background"
                value={formData.categoria} onChange={e => setFormData({ ...formData, categoria: e.target.value })}>
                <option value="PERFIL">PERFIL LINEAR (kg/m)</option>
                <option value="CHAPA">CHAPA / PLACA (kg/m²)</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Tipo</label>
                <Input list="especs-lista-tipos" placeholder="Ex: W, WT, HP" value={formData.tipo}
                  onChange={e => setFormData({ ...formData, tipo: e.target.value.toUpperCase() })} required />
                <datalist id="especs-lista-tipos">
                  {tiposConhecidos.map(t => <option key={t} value={t} />)}
                </datalist>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Bitola</label>
                <Input placeholder="Ex: 150X13, 310X93" value={formData.bitola}
                  onChange={e => setFormData({ ...formData, bitola: e.target.value.toUpperCase() })} required />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Aço</label>
                <Input list="especs-lista-acos" placeholder="Ex: A36, A572-GR 50" value={formData.aco}
                  onChange={e => setFormData({ ...formData, aco: e.target.value.toUpperCase() })} required />
                <datalist id="especs-lista-acos">
                  {acosConhecidos.map(a => <option key={a} value={a} />)}
                </datalist>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {formData.categoria === "CHAPA" ? "Peso por m² (kg/m²)" : "Peso por Metro (kg/m)"}
                </label>
                <Input placeholder={formData.categoria === "CHAPA" ? "Ex: 78.5" : "Ex: 13.0"}
                  value={formData.pesoPorMetro}
                  onChange={e => setFormData({ ...formData, pesoPorMetro: e.target.value })} required />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Estoque Mínimo (kg)</label>
                <Input type="number" step="0.01" min="0" placeholder="Ex: 500 (deixe vazio para não alertar)"
                  value={formData.estoqueMinimo}
                  onChange={e => setFormData({ ...formData, estoqueMinimo: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  Peso total mínimo desse material em todo o estoque antes de virar alerta crítico no Dashboard. Deixe vazio ou 0 para não monitorar.
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Valor Unitário (R$/kg)</label>
                <Input type="number" step="0.01" min="0" placeholder="Ex: 6,87"
                  value={formData.valorUnitario}
                  onChange={e => setFormData({ ...formData, valorUnitario: e.target.value })} />
                <p className="text-xs text-muted-foreground">
                  Preço por quilo desse material — usado pra estimar o valor em R$ do que é consumido nas baixas. Deixe vazio se não souber ainda.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" type="button" onClick={() => { setShowForm(false); setEditingId(null); }}>Cancelar</Button>
              <Button type="submit" className="bg-accent hover:bg-accent/90">{editingId ? "Salvar Alterações" : "Cadastrar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── MODAL: ATRIBUIR VALOR POR TIPO ───────────────────────────────────── */}
      <Dialog open={openLote} onOpenChange={setOpenLote}>
        <DialogContent className="w-[92vw] max-w-2xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-accent" /> Atribuir Valores por Tipo
            </DialogTitle>
            <DialogDescription>
              Defina um valor por kg (R$/kg) para cada tipo de material — o valor é aplicado de uma vez a
              todas as especificações daquele tipo, sem precisar ir bitola por bitola. Um tipo específico
              pode ser corrigido depois editando a especificação individualmente.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            <div className="border rounded-lg overflow-hidden">
              <div className="grid grid-cols-[80px_1fr_90px_120px] gap-2 px-3 py-2 bg-muted/50 text-[10px] font-bold uppercase text-muted-foreground">
                <span>Categ.</span>
                <span>Tipo</span>
                <span>Itens</span>
                <span>Valor (R$/kg)</span>
              </div>
              <div className="divide-y divide-border max-h-[50vh] overflow-y-auto">
                {gruposPorTipo.map((g) => (
                  <div key={g.chave} className="grid grid-cols-[80px_1fr_90px_120px] gap-2 px-3 py-1.5 items-center hover:bg-muted/30">
                    <CategoriaBadge cat={g.categoria} />
                    <span className="text-xs font-semibold truncate">{g.tipo}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {g.qtd} {g.qtd === 1 ? "item" : "itens"}
                      {g.comValor > 0 && <span className="block">{g.comValor} com valor</span>}
                    </span>
                    <Input
                      type="number" step="0.01" min="0"
                      placeholder="—"
                      className="h-7 text-xs"
                      value={valoresPorTipo[g.chave] ?? ""}
                      onChange={e => setValoresPorTipo(prev => ({ ...prev, [g.chave]: e.target.value }))}
                    />
                  </div>
                ))}
                {gruposPorTipo.length === 0 && (
                  <div className="px-3 py-6 text-center text-sm text-muted-foreground">Nenhuma especificação cadastrada ainda.</div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row items-center gap-2">
            {totalAfetadoPorLote > 0 && (
              <p className="text-xs text-muted-foreground sm:mr-auto">
                Isso vai atualizar <strong className="text-foreground">{totalAfetadoPorLote}</strong> especificações.
              </p>
            )}
            <Button variant="outline" onClick={() => setOpenLote(false)}>Cancelar</Button>
            <Button
              disabled={salvandoLote}
              className="gap-2 bg-accent hover:bg-accent/90"
              onClick={async () => {
                const grupos = gruposPorTipo
                  .map(g => ({ g, v: valoresPorTipo[g.chave] }))
                  .filter(({ v }) => v !== undefined && v !== "" && !isNaN(parseFloat(v.replace(",", "."))))
                  .map(({ g, v }) => ({ tipo: g.tipo, categoria: g.categoria, valorUnitario: v.replace(",", ".") }));
                if (grupos.length === 0) { toast.error("Preencha ao menos um valor antes de salvar."); return; }
                setSalvandoLote(true);
                try {
                  const resultado = await atualizarLotePorTipoMutation.mutateAsync({ grupos });
                  toast.success(`${resultado.atualizados} especificação(ões) atualizada(s) em ${grupos.length} tipo(s).`);
                  setOpenLote(false);
                  setValoresPorTipo({});
                  refetch();
                  utils.especificacoes.listar.invalidate();
                } catch {
                  toast.error("Erro ao salvar os valores por tipo.");
                } finally {
                  setSalvandoLote(false);
                }
              }}
            >
              <ListChecks className="w-4 h-4" /> {salvandoLote ? "Salvando..." : "Salvar Todos"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── MODAL CONFIRMAR EXCLUSÃO ──────────────────────────────────────── */}
      <Dialog open={!!deleteId} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar Exclusão</DialogTitle>
            <DialogDescription>
              Tem certeza que deseja remover <strong>{deleteLabel}</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? "Removendo..." : "Confirmar Exclusão"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StockDashboardLayout>
  );
}