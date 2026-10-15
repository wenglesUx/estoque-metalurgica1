import React, { Fragment, useState, useMemo, useRef, useEffect } from "react";
import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import {
  Plus, Edit2, Trash2, CheckCircle2, AlertCircle, Lock,
  ClipboardList, Check, Clock, ChevronDown, ChevronUp, Save,
  BarChart3, Search, X, ChevronRight, MapPin, Loader2,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useFiltroMaterial } from "@/hooks/useFiltroMaterial";
import { useIsMobile } from "@/hooks/useMobile";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface InventarioForm {
  numero: string;
  descricao: string;
  observacoes: string;
}

const emptyForm = (): InventarioForm => ({ numero: "", descricao: "", observacoes: "" });

// ─── Badge de status ──────────────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    aberto:      { cls: "bg-blue-50 text-blue-700 border border-blue-200",      icon: <Clock className="w-3 h-3" />,        label: "ABERTO" },
    em_contagem: { cls: "bg-yellow-50 text-yellow-700 border border-yellow-200", icon: <AlertCircle className="w-3 h-3" />, label: "EM CONTAGEM" },
    fechado:     { cls: "bg-orange-50 text-orange-700 border border-orange-200", icon: <Lock className="w-3 h-3" />,         label: "FECHADO" },
    processado:  { cls: "bg-green-50 text-green-700 border border-green-200",   icon: <CheckCircle2 className="w-3 h-3" />, label: "PROCESSADO" },
  };
  const cfg = map[status] ?? { cls: "bg-gray-100 text-gray-600 border border-gray-200", icon: null, label: status.toUpperCase() };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${cfg.cls}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

// ─── Componente: Card de item para mobile ─────────────────────────────────────
function ItemCardMobile({ item, contagem, onChange, onFocus, onBlur, statusSalvamento, motivoDivergencia, onChangeMotivo }: {
  item: any;
  contagem: string;
  onChange: (val: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  statusSalvamento?: "salvando" | "salvo" | "erro";
  motivoDivergencia?: string;
  onChangeMotivo?: (motivo: string) => void;
}) {
  const contadoVal = parseFloat(String(contagem));
  const sistemaVal = parseFloat(String(item.quantidadeSistema));
  const divergencia = !isNaN(contadoVal) ? Math.round(contadoVal - sistemaVal) : null;
  const temDivergencia = divergencia !== null && divergencia !== 0;
  const temContagem = contagem !== "";

  return (
    <div className="border rounded-lg p-3 bg-card hover:bg-muted/50 transition-colors">
      {/* Cabeçalho do card */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-foreground truncate">
            {item.material?.tipo} {item.material?.bitola}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {item.material?.aco} · {item.material?.comprimento}mm
          </div>
          {item.material?.obraNome && (
            <div className="text-xs text-muted-foreground mt-1 font-medium">
              📍 {item.material.obraNome}
            </div>
          )}
        </div>
        
        {/* Indicador de status */}
        <div className="flex flex-col items-end gap-1 shrink-0">
          {temContagem && (
            <CheckCircle2 className={`w-5 h-5 ${temDivergencia ? "text-yellow-500" : "text-green-500"}`} />
          )}
          {temDivergencia && (
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
              divergencia! > 0 ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
            }`}>
              {divergencia! > 0 ? "+" : ""}{divergencia}
            </span>
          )}
        </div>
      </div>

      {/* Informações do sistema */}
      <div className="bg-muted/40 rounded px-2 py-1.5 mb-2 text-xs">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Saldo Sistema:</span>
          <span className="font-mono font-semibold">{parseFloat(String(item.quantidadeSistema)).toFixed(0)} un</span>
        </div>
        {item.material?.local && (
          <div className="flex justify-between mt-1">
            <span className="text-muted-foreground">Local:</span>
            <span className="font-mono text-right">{item.material.local}</span>
          </div>
        )}
      </div>

      {/* Input de contagem */}
      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          Contagem Física (un)
          {statusSalvamento === "salvando" && (
            <span className="inline-flex items-center gap-1 text-muted-foreground normal-case font-normal">
              <Loader2 className="w-3 h-3 animate-spin" /> salvando...
            </span>
          )}
          {statusSalvamento === "salvo" && (
            <span className="inline-flex items-center gap-1 text-green-600 normal-case font-normal">
              <CheckCircle2 className="w-3 h-3" /> salvo
            </span>
          )}
          {statusSalvamento === "erro" && (
            <span className="inline-flex items-center gap-1 text-destructive normal-case font-normal">
              <AlertCircle className="w-3 h-3" /> erro ao salvar
            </span>
          )}
        </label>
        <Input
          type="number"
          min="0"
          step="1"
          placeholder="Digite a quantidade"
          value={contagem}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          onBlur={onBlur}
          className={`h-10 text-base font-mono text-right ${
            temContagem ? (temDivergencia ? "border-yellow-400 bg-yellow-50/30" : "border-green-400 bg-green-50/30") : ""
          }`}
        />
      </div>

      {/* Motivo da divergência — só quando faltou material */}
      {divergencia !== null && divergencia < 0 && (
        <div className="mt-2 p-2 rounded-md bg-red-50/60 border border-red-200">
          <label className="text-[10px] font-bold uppercase text-red-700 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3" /> Motivo (faltou {Math.abs(divergencia)} un.)
          </label>
          <textarea
            className="w-full mt-1 min-h-[44px] px-2 py-1.5 rounded-md border border-red-200 bg-white text-xs resize-y"
            placeholder="O que aconteceu com esse material?"
            defaultValue={motivoDivergencia || ""}
            onChange={(e) => onChangeMotivo?.(e.target.value)}
          />
        </div>
      )}

      {/* Divergência em destaque */}
      {divergencia !== null && (
        <div className={`mt-2 p-2 rounded text-xs font-medium text-center ${
          divergencia === 0
            ? "bg-green-50 text-green-700"
            : divergencia > 0
            ? "bg-green-100 text-green-800"
            : "bg-red-100 text-red-800"
        }`}>
          {divergencia === 0
            ? "✓ Sem divergência"
            : divergencia > 0
            ? `+${divergencia} un (Excesso)`
            : `${divergencia} un (Falta)`}
        </div>
      )}
    </div>
  );
}

// ─── Material fora do cadastro ────────────────────────────────────────────────

const STATUS_FORA_CADASTRO: Record<string, { cls: string; label: string }> = {
  pendente:  { cls: "bg-yellow-50 text-yellow-700 border border-yellow-200", label: "EM ANÁLISE" },
  aprovado:  { cls: "bg-green-50 text-green-700 border border-green-200",    label: "APROVADO" },
  reprovado: { cls: "bg-red-50 text-red-700 border border-red-200",          label: "REPROVADO" },
};

function StatusForaCadastro({ status }: { status: string }) {
  const cfg = STATUS_FORA_CADASTRO[status] ?? { cls: "bg-gray-100 text-gray-600 border border-gray-200", label: status.toUpperCase() };
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.cls}`}>{cfg.label}</span>;
}

function descricaoMaterialPendente(m: any) {
  const dimensao = m.categoria === "CHAPA" ? `${m.largura ?? "?"} x ${m.comprimento} mm` : `${m.comprimento} mm`;
  return { titulo: `${m.tipo} ${m.bitola}`, detalhe: `${m.aco} · ${dimensao} · ${m.quantidade} un.` };
}

const formForaCadastroVazio = () => ({
  categoria: "PERFIL" as "PERFIL" | "CHAPA",
  tipo: "", bitola: "", aco: "",
  quantidade: "", comprimento: "", largura: "",
  local: "", obraId: "",
  fornecedor: "", nf: "", numeroCertificado: "", corrida: "",
  origem: "",
});

function ModalMaterialForaCadastro({ inventarioId, onClose, onSalvo }: {
  inventarioId: number;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const [form, setForm] = useState(formForaCadastroVazio());
  const [mostrarRastreabilidade, setMostrarRastreabilidade] = useState(false);
  const { data: locaisAtivos } = trpc.locais.listarAtivos.useQuery();
  const { data: obras } = trpc.obras.list.useQuery(undefined, { retry: false });
  const { data: especificacoes } = trpc.especificacoes.listar.useQuery(undefined, { retry: false });
  const cadastrar = trpc.inventarios.cadastrarMaterialForaCadastro.useMutation();

  const tiposConhecidos = useMemo(() => Array.from(new Set((especificacoes ?? []).map((e: any) => e.tipo))).sort(), [especificacoes]);
  const acosConhecidos = useMemo(() => Array.from(new Set((especificacoes ?? []).map((e: any) => e.aco))).sort(), [especificacoes]);

  const set = (campo: keyof ReturnType<typeof formForaCadastroVazio>, valor: string) =>
    setForm((f) => ({ ...f, [campo]: valor }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await cadastrar.mutateAsync({
        inventarioId,
        categoria: form.categoria,
        tipo: form.tipo,
        bitola: form.bitola,
        aco: form.aco,
        quantidade: parseInt(form.quantidade) || 0,
        comprimento: Math.round(parseFloat(form.comprimento) || 0),
        largura: form.categoria === "CHAPA" ? Math.round(parseFloat(form.largura) || 0) : undefined,
        local: form.local || undefined,
        obraId: form.obraId ? parseInt(form.obraId) : undefined,
        fornecedor: form.fornecedor || undefined,
        nf: form.nf || undefined,
        numeroCertificado: form.numeroCertificado || undefined,
        corrida: form.corrida || undefined,
        origem: form.origem,
      });
      toast.success("Material registrado — fica em análise até ser aprovado.");
      onSalvo();
      onClose();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar material.");
    }
  };

  const campo = "h-10 px-3 rounded-md border border-input bg-background text-sm w-full";
  const rotulo = "text-xs font-medium text-muted-foreground uppercase";

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Material fora do cadastro</DialogTitle>
          <DialogDescription>
            Material encontrado na contagem que não está no sistema. Ele fica <strong>em análise</strong> e só
            entra na lista de materiais depois de aprovado.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className={rotulo}>Categoria</label>
              <select className={campo} value={form.categoria} onChange={(e) => set("categoria", e.target.value)}>
                <option value="PERFIL">PERFIL LINEAR</option>
                <option value="CHAPA">CHAPA / PLACA</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className={rotulo}>Tipo *</label>
              <Input list="fora-cadastro-tipos" placeholder="Ex: W, HP" value={form.tipo} onChange={(e) => set("tipo", e.target.value.toUpperCase())} required />
              <datalist id="fora-cadastro-tipos">{tiposConhecidos.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div className="space-y-1">
              <label className={rotulo}>Bitola *{form.categoria === "CHAPA" ? " (esp. mm)" : ""}</label>
              <Input placeholder={form.categoria === "CHAPA" ? "Ex: 6.35" : "Ex: 150X13"} value={form.bitola} onChange={(e) => set("bitola", e.target.value.toUpperCase())} required />
            </div>
            <div className="space-y-1">
              <label className={rotulo}>Aço *</label>
              <Input list="fora-cadastro-acos" placeholder="Ex: A36" value={form.aco} onChange={(e) => set("aco", e.target.value.toUpperCase())} required />
              <datalist id="fora-cadastro-acos">{acosConhecidos.map((a) => <option key={a} value={a} />)}</datalist>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <label className={rotulo}>Qtd (barras) *</label>
              <Input type="number" min={1} step={1} value={form.quantidade} onChange={(e) => set("quantidade", e.target.value)} required />
            </div>
            <div className="space-y-1">
              <label className={rotulo}>Comprimento (mm) *</label>
              <Input type="number" min={1} step={1} value={form.comprimento} onChange={(e) => set("comprimento", e.target.value)} required />
            </div>
            {form.categoria === "CHAPA" && (
              <div className="space-y-1">
                <label className={rotulo}>Largura (mm) *</label>
                <Input type="number" min={1} step={1} value={form.largura} onChange={(e) => set("largura", e.target.value)} required />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={rotulo}>Local</label>
              <select className={campo} value={form.local} onChange={(e) => set("local", e.target.value)}>
                <option value="">Selecione um local...</option>
                {locaisAtivos?.map((l) => <option key={l.id} value={l.nome}>{l.nome}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className={rotulo}>Obra / Destino</label>
              <select className={campo} value={form.obraId} onChange={(e) => set("obraId", e.target.value)}>
                <option value="">LIVRE</option>
                {obras?.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <label className={rotulo}>Onde foi encontrado / possível origem *</label>
            <textarea
              className="w-full min-h-[70px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
              placeholder="Ex: encontrado no fundo do pátio B, sem etiqueta; parece sobra da obra X; material antigo de antes do sistema..."
              value={form.origem}
              onChange={(e) => set("origem", e.target.value)}
              required
              minLength={3}
            />
            <p className="text-[11px] text-muted-foreground">É isso que quem for analisar vai usar pra decidir se aprova ou não.</p>
          </div>

          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setMostrarRastreabilidade((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-bold uppercase text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${mostrarRastreabilidade ? "rotate-180" : ""}`} />
              Rastreabilidade
              <span className="font-normal normal-case text-muted-foreground/70">(se tiver alguma identificação)</span>
            </button>
            {mostrarRastreabilidade && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <div className="space-y-1"><label className={rotulo}>Fornecedor</label><Input value={form.fornecedor} onChange={(e) => set("fornecedor", e.target.value)} /></div>
                <div className="space-y-1"><label className={rotulo}>NF</label><Input value={form.nf} onChange={(e) => set("nf", e.target.value)} /></div>
                <div className="space-y-1"><label className={rotulo}>Nº Certificado</label><Input value={form.numeroCertificado} onChange={(e) => set("numeroCertificado", e.target.value)} /></div>
                <div className="space-y-1"><label className={rotulo}>Corrida</label><Input value={form.corrida} onChange={(e) => set("corrida", e.target.value)} /></div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={cadastrar.isPending} className="gap-2">
              <Plus className="w-4 h-4" />
              {cadastrar.isPending ? "Registrando..." : "Registrar para análise"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Análise (aprovar/reprovar) — fica numa aba própria da página de inventário.
function AnaliseMateriaisForaCadastro() {
  const [verHistorico, setVerHistorico] = useState(false);
  const [analisando, setAnalisando] = useState<{ item: any; acao: "aprovar" | "reprovar" } | null>(null);
  const [parecer, setParecer] = useState("");
  const utils = trpc.useUtils();
  const { data: lista, isLoading } = trpc.inventarios.listarMateriaisForaCadastro.useQuery(
    verHistorico ? undefined : { status: "pendente" }
  );
  const aprovar = trpc.inventarios.aprovarMaterialForaCadastro.useMutation();
  const reprovar = trpc.inventarios.reprovarMaterialForaCadastro.useMutation();

  const fecharAnalise = () => { setAnalisando(null); setParecer(""); };

  const confirmarAnalise = async () => {
    if (!analisando) return;
    try {
      if (analisando.acao === "aprovar") {
        await aprovar.mutateAsync({ id: analisando.item.id, parecer: parecer || undefined });
        toast.success("Aprovado — o material entrou na lista de materiais.");
      } else {
        await reprovar.mutateAsync({ id: analisando.item.id, parecer });
        toast.success("Reprovado — o material não entra na lista de materiais.");
      }
      fecharAnalise();
      utils.inventarios.listarMateriaisForaCadastro.invalidate();
      utils.materiais.list.invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar a análise.");
    }
  };

  const enviando = aprovar.isPending || reprovar.isPending;

  return (
    <div className="space-y-3">
      <Card className="p-4 border border-border bg-muted/30 flex flex-col md:flex-row md:items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Materiais encontrados nas contagens que estavam fora do cadastro. Analise a origem: <strong>aprovar</strong> coloca o
          material na lista de materiais; <strong>reprovar</strong> descarta o cadastro.
        </p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground whitespace-nowrap cursor-pointer">
          <input type="checkbox" checked={verHistorico} onChange={(e) => setVerHistorico(e.target.checked)} />
          Mostrar já analisados
        </label>
      </Card>

      {isLoading ? (
        <div className="p-8 text-center text-muted-foreground">Carregando...</div>
      ) : !lista || lista.length === 0 ? (
        <div className="p-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p>{verHistorico ? "Nenhum material fora do cadastro registrado." : "Nada aguardando análise."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {lista.map((m: any) => {
            const { titulo, detalhe } = descricaoMaterialPendente(m);
            return (
              <Card key={m.id} className="p-4 border border-border">
                <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                      {titulo} <StatusForaCadastro status={m.status} />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {detalhe}
                      {m.local && ` · Local: ${m.local}`}
                      {` · ${m.obraNome || "LIVRE"}`}
                    </div>
                    {(m.fornecedor || m.nf || m.numeroCertificado || m.corrida) && (
                      <div className="text-xs text-muted-foreground">
                        {[m.fornecedor && `Fornecedor: ${m.fornecedor}`, m.nf && `NF: ${m.nf}`, m.numeroCertificado && `Cert.: ${m.numeroCertificado}`, m.corrida && `Corrida: ${m.corrida}`].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    <div className="text-sm mt-2 p-2 rounded-md bg-muted/50">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground block">Origem informada</span>
                      {m.origem}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      Inventário #{m.inventarioNumero ?? m.inventarioId} · registrado por {m.cadastradoPor} em{" "}
                      {format(new Date(m.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </div>
                    {m.status !== "pendente" && (
                      <div className="text-[11px] text-muted-foreground">
                        {m.status === "aprovado" ? "Aprovado" : "Reprovado"} por {m.analisadoPor}
                        {m.analisadoEm && ` em ${format(new Date(m.analisadoEm), "dd/MM/yyyy HH:mm", { locale: ptBR })}`}
                        {m.parecer && ` — ${m.parecer}`}
                      </div>
                    )}
                  </div>
                  {m.status === "pendente" && (
                    <PermissionGate permission="inventario:processar">
                      <div className="flex gap-2 shrink-0">
                        <Button size="sm" className="gap-1.5 bg-green-600 hover:bg-green-700" onClick={() => setAnalisando({ item: m, acao: "aprovar" })}>
                          <Check className="w-3.5 h-3.5" /> Aprovar
                        </Button>
                        <Button size="sm" variant="outline" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={() => setAnalisando({ item: m, acao: "reprovar" })}>
                          <X className="w-3.5 h-3.5" /> Reprovar
                        </Button>
                      </div>
                    </PermissionGate>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {analisando && (
        <Dialog open onOpenChange={fecharAnalise}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{analisando.acao === "aprovar" ? "Aprovar material" : "Reprovar material"}</DialogTitle>
              <DialogDescription>
                {descricaoMaterialPendente(analisando.item).titulo} — {descricaoMaterialPendente(analisando.item).detalhe}.{" "}
                {analisando.acao === "aprovar"
                  ? "O material será criado na lista de materiais, com a origem registrada nas observações."
                  : "O material não entra na lista de materiais."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">
                {analisando.acao === "aprovar" ? "Parecer da análise (opcional)" : "Motivo da reprovação *"}
              </label>
              <textarea
                className="w-full min-h-[80px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y"
                placeholder={analisando.acao === "aprovar" ? "Ex: confirmado como sobra da obra X, NF localizada..." : "Ex: material já está cadastrado com outro código, sucata..."}
                value={parecer}
                onChange={(e) => setParecer(e.target.value)}
              />
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={fecharAnalise}>Cancelar</Button>
              <Button
                onClick={confirmarAnalise}
                disabled={enviando || (analisando.acao === "reprovar" && parecer.trim().length < 3)}
                className={analisando.acao === "aprovar" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}
              >
                {enviando ? "Salvando..." : analisando.acao === "aprovar" ? "Aprovar" : "Reprovar"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

// ─── Modal de contagem ────────────────────────────────────────────────────────
function ModalContagem({
  inventarioId,
  onClose,
  onSalvo,
}: {
  inventarioId: number;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const { data: itens, isLoading } = trpc.inventarios.listarItens.useQuery({ inventarioId });
  const { data: locaisAtivos } = trpc.locais.listarAtivos.useQuery();
  const salvarMutation = trpc.inventarios.salvarContagem.useMutation();
  const fecharMutation = trpc.inventarios.fechar.useMutation();
  const isMobile = useIsMobile();

  const [mostrarFormForaCadastro, setMostrarFormForaCadastro] = useState(false);
  const [listaForaCadastroAberta, setListaForaCadastroAberta] = useState(false);
  const { data: foraCadastro, refetch: refetchForaCadastro } =
    trpc.inventarios.listarMateriaisForaCadastro.useQuery({ inventarioId });
  const cancelarForaCadastro = trpc.inventarios.cancelarMaterialForaCadastro.useMutation();

  const handleCancelarForaCadastro = async (id: number) => {
    if (!confirm("Remover este cadastro? Ele ainda não foi analisado.")) return;
    try {
      await cancelarForaCadastro.mutateAsync({ id });
      toast.success("Cadastro removido.");
      refetchForaCadastro();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao remover cadastro.");
    }
  };

  // Contagens locais: itemId → valor string do input
  const [contagens, setContagens] = useState<Record<number, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [expandedItemId, setExpandedItemId] = useState<number | null>(null);

  // Salvamento automático: cada campo é salvo sozinho pouco depois de parar de
  // digitar (e imediatamente ao sair do campo) — evita perder a contagem se a
  // página recarregar ou a conexão cair antes de clicar em "Salvar" no final.
  const [statusPorItem, setStatusPorItem] = useState<Record<number, "salvando" | "salvo" | "erro">>({});
  const [motivosDivergencia, setMotivosDivergencia] = useState<Record<number, string>>({});
  const debounceTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    // Limpa os timers pendentes se o modal fechar/desmontar no meio do caminho.
    return () => {
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  const salvarItemIndividual = async (itemId: number, valor: string, observacoes?: string) => {
    if (valor === "") return;
    setStatusPorItem((prev) => ({ ...prev, [itemId]: "salvando" }));
    try {
      await salvarMutation.mutateAsync({
        inventarioId,
        itens: [{ itemId, quantidadeContada: parseFloat(valor) || 0, observacoes: observacoes || undefined }],
      });
      setStatusPorItem((prev) => ({ ...prev, [itemId]: "salvo" }));
    } catch {
      setStatusPorItem((prev) => ({ ...prev, [itemId]: "erro" }));
      toast.error("Não foi possível salvar essa contagem — verifique a conexão.");
    }
  };

  const agendarSalvamento = (itemId: number, valor: string, motivoOriginal?: string) => {
    if (debounceTimers.current[itemId]) clearTimeout(debounceTimers.current[itemId]);
    debounceTimers.current[itemId] = setTimeout(() => {
      salvarItemIndividual(itemId, valor, motivosDivergencia[itemId] ?? motivoOriginal);
    }, 700);
  };

  // Salva na hora, sem esperar o debounce — usado ao sair do campo (blur).
  const salvarAoSairDoCampo = (itemId: number, motivoOriginal?: string) => {
    if (debounceTimers.current[itemId]) clearTimeout(debounceTimers.current[itemId]);
    const valor = contagens[itemId];
    if (valor !== undefined) salvarItemIndividual(itemId, valor, motivosDivergencia[itemId] ?? motivoOriginal);
  };

  // Só o motivo mudou (contagem já estava preenchida) — reenvia com o valor atual da contagem.
  const salvarMotivoDivergencia = (itemId: number, motivo: string) => {
    setMotivosDivergencia(prev => ({ ...prev, [itemId]: motivo }));
    if (debounceTimers.current[itemId]) clearTimeout(debounceTimers.current[itemId]);
    debounceTimers.current[itemId] = setTimeout(() => {
      const valor = contagens[itemId];
      if (valor !== undefined && valor !== "") salvarItemIndividual(itemId, valor, motivo);
    }, 700);
  };

  // Adapta itens para o formato que useFiltroMaterial espera
  const itensAdaptados = useMemo(() =>
    (itens || []).map(it => ({
      ...it,
      tipo:              it.material?.tipo        ?? "",
      bitola:            it.material?.bitola       ?? "",
      aco:               it.material?.aco          ?? "",
      local:             it.material?.local        ?? "",
      obraNome:          it.material?.obraNome     ?? "",
      comprimento:       it.material?.comprimento  ?? "",
      fornecedor:        (it.material as any)?.fornecedor ?? "",
      numero_certificado:(it.material as any)?.numero_certificado ?? "",
      corrida:           (it.material as any)?.corrida ?? "",
      nf:                (it.material as any)?.nf  ?? "",
    })),
    [itens]
  );

  const { filtro, setFiltro, resetFiltro, filtrados: itensFiltrados, temFiltroAtivo } =
    useFiltroMaterial(itensAdaptados);

  const handleChange = (itemId: number, val: string, motivoOriginal?: string) => {
    setContagens((prev) => ({ ...prev, [itemId]: val }));
    agendarSalvamento(itemId, val, motivoOriginal);
  };

  const handleSalvar = async () => {
    if (!itens) return;
    setSalvando(true);
    try {
      const payload = itens
        .filter((it) => contagens[it.id] !== undefined && contagens[it.id] !== "")
        .map((it) => ({
          itemId: it.id,
          quantidadeContada: parseFloat(contagens[it.id] ?? "0") || 0,
        }));

      if (payload.length === 0) {
        toast.warning("Preencha ao menos uma contagem antes de salvar.");
        setSalvando(false);
        return;
      }

      await salvarMutation.mutateAsync({ inventarioId, itens: payload });
      toast.success(`${payload.length} item(ns) salvos!`);
      onSalvo();
    } catch {
      toast.error("Erro ao salvar contagem.");
    } finally {
      setSalvando(false);
    }
  };

  const handleFecharInventario = async () => {
    if (!confirm("Fechar o inventário impede novas contagens. Continuar?")) return;
    try {
      await fecharMutation.mutateAsync({ id: inventarioId });
      toast.success("Inventário fechado! Agora processe os ajustes.");
      onSalvo();
      onClose();
    } catch {
      toast.error("Erro ao fechar inventário.");
    }
  };

  const contadosCount = itensFiltrados?.filter((it) =>
    it.quantidadeContada !== null || contagens[it.id] !== undefined
  ).length ?? 0;

  const totalItens = itensFiltrados?.length ?? 0;
  const totalGeral = itens?.length ?? 0;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className={`${isMobile ? "max-w-full h-[100dvh] rounded-none" : "max-w-4xl max-h-[90vh]"} flex flex-col`}>
        {/* Header */}
        <DialogHeader className={isMobile ? "pb-2" : ""}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <ClipboardList className="w-5 h-5 shrink-0" />
              <div className="min-w-0">
                <DialogTitle className="text-base md:text-lg">Contagem de Materiais</DialogTitle>
                {totalItens > 0 && (
                  <DialogDescription className="text-xs md:text-sm">
                    {contadosCount}/{totalItens} itens preenchidos
                    {temFiltroAtivo && ` (${totalGeral} total)`}
                  </DialogDescription>
                )}
              </div>
            </div>
            {isMobile && (
              <Button variant="ghost" size="icon" onClick={onClose} className="shrink-0">
                <X className="w-5 h-5" />
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Barra de filtro */}
        <div className={`border-b pb-2 ${isMobile ? "px-3" : ""}`}>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={isMobile ? "Filtrar..." : "Filtrar por tipo, bitola, aço, local, NF, certificado..."}
                value={filtro.texto}
                onChange={e => setFiltro({ texto: e.target.value })}
                className={`pl-9 ${isMobile ? "h-9 text-sm" : "h-8 text-sm"}`}
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded border transition-colors shrink-0 ${
                    filtro.local ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-muted"
                  }`}
                  title="Filtrar por local"
                >
                  <MapPin className="w-3.5 h-3.5" />
                  {!isMobile && (filtro.local || "Local")}
                  <ChevronDown className="w-3 h-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Filtrar por local</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(!locaisAtivos || locaisAtivos.length === 0) && (
                  <div className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhum local cadastrado ainda.
                  </div>
                )}
                {locaisAtivos?.map((l) => (
                  <DropdownMenuItem
                    key={l.id}
                    onClick={() => setFiltro({ local: l.nome })}
                    className={filtro.local === l.nome ? "bg-muted font-medium" : ""}
                  >
                    <MapPin className="w-3.5 h-3.5 mr-2" />
                    {l.nome}
                  </DropdownMenuItem>
                ))}
                {filtro.local && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setFiltro({ local: "" })}>
                      <X className="w-3.5 h-3.5 mr-2" />
                      Limpar filtro de local
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {temFiltroAtivo && (
              <button
                onClick={resetFiltro}
                className="flex items-center gap-1 text-xs px-2 py-1.5 rounded border border-border hover:bg-muted transition-colors shrink-0"
                title="Limpar filtro"
              >
                <X className="w-3.5 h-3.5" />
                {!isMobile && "Limpar"}
              </button>
            )}
          </div>
          {temFiltroAtivo && (
            <div className="text-xs text-muted-foreground mt-1.5 px-1">
              Mostrando {itensFiltrados.length} de {totalGeral} item(ns)
            </div>
          )}

          {/* Material encontrado que não está no cadastro */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <PermissionGate permission="inventario:contar">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setMostrarFormForaCadastro(true)}
                className="gap-1.5 h-8 text-xs border-dashed"
              >
                <Plus className="w-3.5 h-3.5" /> Material fora do cadastro
              </Button>
            </PermissionGate>
            {foraCadastro && foraCadastro.length > 0 && (
              <button
                type="button"
                onClick={() => setListaForaCadastroAberta((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {listaForaCadastroAberta ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                {foraCadastro.length} registrado(s) neste inventário
                {foraCadastro.some((m: any) => m.status === "pendente") &&
                  ` · ${foraCadastro.filter((m: any) => m.status === "pendente").length} em análise`}
              </button>
            )}
          </div>
          {listaForaCadastroAberta && foraCadastro && foraCadastro.length > 0 && (
            <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
              {foraCadastro.map((m: any) => {
                const { titulo, detalhe } = descricaoMaterialPendente(m);
                return (
                  <div key={m.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md border border-dashed bg-muted/30 text-xs">
                    <div className="min-w-0">
                      <div className="font-medium flex items-center gap-2 flex-wrap">{titulo} <StatusForaCadastro status={m.status} /></div>
                      <div className="text-muted-foreground truncate">{detalhe}{m.local && ` · ${m.local}`}</div>
                    </div>
                    {m.status === "pendente" && (
                      <PermissionGate permission="inventario:contar">
                        <button
                          type="button"
                          onClick={() => handleCancelarForaCadastro(m.id)}
                          className="p-1 rounded hover:bg-red-50 text-red-600 shrink-0"
                          title="Remover (cadastrou errado)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </PermissionGate>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Conteúdo principal */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando materiais...</div>
          ) : !itens || itens.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Nenhum material encontrado no snapshot.
            </div>
          ) : itensFiltrados.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              Nenhum material corresponde aos filtros.
            </div>
          ) : isMobile ? (
            // ─── Visualização Mobile: Cards ────────────────────────────────────
            <div className="space-y-2 p-3">
              {itensFiltrados.map((item) => {
                const contagem = contagens[item.id] ?? (item.quantidadeContada ?? "");
                return (
                  <ItemCardMobile
                    key={item.id}
                    item={item}
                    contagem={String(contagem)}
                    onChange={(val) => handleChange(item.id, val, item.observacoes || undefined)}
                    onFocus={() => setExpandedItemId(item.id)}
                    onBlur={() => salvarAoSairDoCampo(item.id, item.observacoes || undefined)}
                    statusSalvamento={statusPorItem[item.id]}
                    motivoDivergencia={motivosDivergencia[item.id] ?? item.observacoes ?? ""}
                    onChangeMotivo={(motivo) => salvarMotivoDivergencia(item.id, motivo)}
                  />
                );
              })}
            </div>
          ) : (
            // ─── Visualização Desktop: Tabela ──────────────────────────────────
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur-sm">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase">Material</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground text-xs uppercase">Local</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs uppercase">Saldo Sistema (un)</th>
                  <th className="px-3 py-2 text-center font-medium text-muted-foreground text-xs uppercase w-40">Contagem Física (un)</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground text-xs uppercase">Divergência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {itensFiltrados.map((item) => {
                  const valorInput = contagens[item.id] ?? (item.quantidadeContada ?? "");
                  const contadoVal = parseFloat(String(valorInput));
                  const sistemaVal = parseFloat(String(item.quantidadeSistema));
                  const divergencia = !isNaN(contadoVal) ? Math.round(contadoVal - sistemaVal) : null;

                  return (
                    <Fragment key={item.id}>
                    <tr className="hover:bg-muted/30 transition-colors">
                      <td className="px-3 py-2">
                        <div className="font-medium">
                          {item.material?.tipo} {item.material?.bitola}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {item.material?.aco} · {item.material?.comprimento} mm
                          {item.material?.obraNome && ` · ${item.material.obraNome}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                        {item.material?.local || "—"}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {parseFloat(String(item.quantidadeSistema)).toFixed(0)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="relative">
                          <Input
                            type="number"
                            min="0"
                            step="1"
                            placeholder="0"
                            value={String(valorInput)}
                            onChange={(e) => handleChange(item.id, e.target.value, item.observacoes || undefined)}
                            onBlur={() => salvarAoSairDoCampo(item.id, item.observacoes || undefined)}
                            className={`text-right h-8 font-mono text-sm pr-6 ${
                              String(valorInput) !== "" ? "border-green-400 bg-green-50/30" : ""
                            }`}
                          />
                          {statusPorItem[item.id] === "salvando" && (
                            <Loader2 className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                          )}
                          {statusPorItem[item.id] === "salvo" && (
                            <CheckCircle2 className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-green-600" />
                          )}
                          {statusPorItem[item.id] === "erro" && (
                            <AlertCircle className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-destructive" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium">
                        {divergencia !== null ? (
                          <span className={
                            divergencia === 0
                              ? "text-muted-foreground"
                              : divergencia > 0
                              ? "text-green-600"
                              : "text-red-600"
                          }>
                            {divergencia > 0 ? "+" : ""}{divergencia} un
                          </span>
                        ) : "—"}
                      </td>
                    </tr>
                    {divergencia !== null && divergencia < 0 && (
                      <tr className="bg-red-50/40">
                        <td colSpan={5} className="px-3 py-2">
                          <label className="text-[10px] font-bold uppercase text-red-700 flex items-center gap-1.5">
                            <AlertCircle className="w-3 h-3" /> Motivo da divergência (faltou {Math.abs(divergencia)} un.) — evidencia o que aconteceu, pro relatório de divergência
                          </label>
                          <textarea
                            className="w-full mt-1.5 min-h-[50px] px-3 py-2 rounded-md border border-red-200 bg-white text-sm resize-y"
                            placeholder="Ex: sobra usada em obra sem baixa formal, extravio, erro de contagem anterior..."
                            defaultValue={item.observacoes || ""}
                            onChange={(e) => salvarMotivoDivergencia(item.id, e.target.value)}
                          />
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className={`flex ${isMobile ? "flex-col gap-2" : "flex-col sm:flex-row gap-2"} border-t pt-3`}>
          <Button 
            variant="outline" 
            onClick={onClose} 
            className={`${isMobile ? "w-full" : "sm:mr-auto"}`}
          >
            {isMobile ? "Fechar" : "Cancelar"}
          </Button>
          <Button
            variant="outline"
            onClick={handleSalvar}
            disabled={salvando}
            title="Cada contagem já é salva sozinha ao digitar — use este botão só como uma sincronização extra de segurança"
            className={`gap-2 ${isMobile ? "w-full" : ""}`}
          >
            <Save className="w-4 h-4" />
            {salvando ? "Sincronizando..." : "Sincronizar Tudo"}
          </Button>
          <PermissionGate permission="inventario:processar">
            <Button
              onClick={handleFecharInventario}
              className={`gap-2 bg-orange-600 hover:bg-orange-700 ${isMobile ? "w-full" : ""}`}
              disabled={fecharMutation.isPending}
            >
              <Lock className="w-4 h-4" />
              {isMobile ? "Fechar Inv." : "Fechar Inventário"}
            </Button>
          </PermissionGate>
        </DialogFooter>
      </DialogContent>
      {mostrarFormForaCadastro && (
        <ModalMaterialForaCadastro
          inventarioId={inventarioId}
          onClose={() => setMostrarFormForaCadastro(false)}
          onSalvo={() => { refetchForaCadastro(); setListaForaCadastroAberta(true); }}
        />
      )}
    </Dialog>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export function Inventario() {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState<InventarioForm>(emptyForm());
  const [filtro, setFiltro] = useState("");
  const [abas, setAbas] = useState("abertos");
  const [contandoId, setContandoId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<number, boolean>>({});

  const { data: inventarios, refetch, isLoading } = trpc.inventarios.listar.useQuery();
  const { data: foraCadastroPendentes } = trpc.inventarios.listarMateriaisForaCadastro.useQuery({ status: "pendente" });
  const totalParaAnalise = foraCadastroPendentes?.length ?? 0;

  const createMutation   = trpc.inventarios.criar.useMutation();
  const updateMutation   = trpc.inventarios.atualizar.useMutation();
  const deleteMutation   = trpc.inventarios.deletar.useMutation();
  const abrirMutation    = trpc.inventarios.abrir.useMutation();
  const processarMutation = trpc.inventarios.processarAjustes.useMutation();

  const filteredInventarios = useMemo(() => {
    if (!inventarios) return [];
    let lista = [...inventarios];
    if (abas === "abertos")  lista = lista.filter((i) => i.status === "aberto" || i.status === "em_contagem");
    if (abas === "fechados") lista = lista.filter((i) => i.status === "fechado" || i.status === "processado");
    if (filtro.trim()) {
      const t = filtro.toLowerCase();
      lista = lista.filter((i) => i.numero.toLowerCase().includes(t) || i.descricao?.toLowerCase().includes(t));
    }
    return lista;
  }, [inventarios, filtro, abas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateMutation.mutateAsync({ id: editingId, ...formData });
        toast.success("Inventário atualizado!");
      } else {
        await createMutation.mutateAsync(formData);
        toast.success("Inventário criado!");
      }
      setShowForm(false);
      setEditingId(null);
      setFormData(emptyForm());
      refetch();
    } catch {
      toast.error("Erro ao salvar inventário.");
    }
  };

  const handleAbrir = async (id: number) => {
    try {
      const res = await abrirMutation.mutateAsync({ id }) as any;
      toast.success(`Snapshot gerado para ${res?.totalMateriais ?? "todos os"} materiais. Iniciando contagem...`);
      refetch();
      setContandoId(id);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao abrir inventário.");
    }
  };

  const handleProcessar = async (id: number) => {
    if (!confirm("Isso aplicará ajustes automáticos no estoque para todas as divergências. Continuar?")) return;
    try {
      const res = await processarMutation.mutateAsync({ id }) as any;
      toast.success(
        `Processado! ${res?.totalDivergencias ?? 0} divergência(s), ${res?.totalAjustes ?? 0} ajuste(s) aplicado(s).`
      );
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao processar ajustes.");
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Excluir este inventário? Esta ação não pode ser desfeita.")) return;
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success("Inventário excluído.");
      refetch();
    } catch {
      toast.error("Erro ao excluir inventário.");
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Inventário Físico</h2>
            <p className="text-muted-foreground mt-1">
              Contagem periódica e reconciliação do estoque físico com o sistema.
            </p>
          </div>
          <PermissionGate permission="inventario:criar">
            <Button
              onClick={() => { setShowForm(true); setEditingId(null); setFormData(emptyForm()); }}
              className="gap-2 self-start md:self-auto"
            >
              <Plus className="w-4 h-4" /> Novo Inventário
            </Button>
          </PermissionGate>
        </div>

        {/* Formulário de criação/edição */}
        {showForm && (
          <Card className="p-6 border border-border">
            <h3 className="text-lg font-semibold mb-4">
              {editingId ? "Editar Inventário" : "Novo Inventário"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">Número *</label>
                  <Input
                    placeholder="Ex: INV-2025-001"
                    value={formData.numero}
                    onChange={(e) => setFormData({ ...formData, numero: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground uppercase">Descrição</label>
                  <Input
                    placeholder="Ex: Inventário mensal — Maio 2025"
                    value={formData.descricao}
                    onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Observações</label>
                <Input
                  placeholder="Observações gerais sobre este inventário..."
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingId ? "Salvar Alterações" : "Criar Inventário"}
                </Button>
                <Button type="button" variant="outline" onClick={() => { setShowForm(false); setEditingId(null); }}>
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Abas e filtro */}
        <Tabs value={abas} onValueChange={setAbas}>
          <TabsList>
            <TabsTrigger value="abertos">Em Aberto</TabsTrigger>
            <TabsTrigger value="fechados">Fechados</TabsTrigger>
            <TabsTrigger value="todos">Todos</TabsTrigger>
            <TabsTrigger value="analise" className="gap-1.5">
              Para análise
              {totalParaAnalise > 0 && (
                <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-yellow-500 text-white text-[10px] font-bold">
                  {totalParaAnalise}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="analise" className="mt-4">
            <AnaliseMateriaisForaCadastro />
          </TabsContent>

          <TabsContent value={abas === "analise" ? "__nenhuma" : abas} className="space-y-4 mt-4">
            <Card className="p-4 border border-border bg-muted/30">
              <div className="flex items-center gap-4">
                <Input
                  placeholder="Buscar por número ou descrição..."
                  value={filtro}
                  onChange={(e) => setFiltro(e.target.value)}
                  className="flex-1"
                />
                <span className="text-sm text-muted-foreground whitespace-nowrap">
                  {filteredInventarios.length} inventário(s)
                </span>
              </div>
            </Card>

            {isLoading ? (
              <div className="p-8 text-center text-muted-foreground">Carregando...</div>
            ) : filteredInventarios.length === 0 ? (
              <div className="p-12 text-center border-2 border-dashed rounded-xl text-muted-foreground">
                <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-40" />
                <p>Nenhum inventário encontrado.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {filteredInventarios.map((inv) => (
                  <Card key={inv.id} className="overflow-hidden border border-border">
                    {/* Cabeçalho do card */}
                    <div
                      className="p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-muted/30 transition-colors"
                      onClick={() => setExpandedIds((p) => ({ ...p, [inv.id]: !p[inv.id] }))}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <BarChart3 className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm flex items-center gap-2 flex-wrap">
                            #{inv.numero}
                            <StatusBadge status={inv.status} />
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
                            {inv.descricao && <span>{inv.descricao}</span>}
                            <span>
                              Aberto em {format(new Date(inv.dataAbertura), "dd/MM/yyyy", { locale: ptBR })}
                            </span>
                            {inv.dataFechamento && (
                              <span>
                                Fechado em {format(new Date(inv.dataFechamento), "dd/MM/yyyy", { locale: ptBR })}
                              </span>
                            )}
                            <span>Por: {inv.usuarioAbertura}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {expandedIds[inv.id]
                          ? <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                      </div>
                    </div>

                    {/* Ações expandidas */}
                    {expandedIds[inv.id] && (
                      <div className="border-t border-border p-4 bg-muted/20 flex flex-wrap gap-2">
                        {/* Aberto: iniciar contagem */}
                        {inv.status === "aberto" && (
                          <PermissionGate permission="inventario:contar">
                            <Button size="sm" onClick={() => handleAbrir(inv.id)} disabled={abrirMutation.isPending} className="gap-1.5">
                              <ClipboardList className="w-3.5 h-3.5" />
                              Iniciar Contagem
                            </Button>
                          </PermissionGate>
                        )}

                        {/* Em contagem: continuar */}
                        {inv.status === "em_contagem" && (
                          <PermissionGate permission="inventario:contar">
                            <Button size="sm" onClick={() => setContandoId(inv.id)} className="gap-1.5 bg-yellow-600 hover:bg-yellow-700">
                              <ClipboardList className="w-3.5 h-3.5" />
                              Continuar Contagem
                            </Button>
                          </PermissionGate>
                        )}

                        {/* Fechado: processar ajustes */}
                        {inv.status === "fechado" && (
                          <PermissionGate permission="inventario:processar">
                            <Button size="sm" onClick={() => handleProcessar(inv.id)} disabled={processarMutation.isPending} className="gap-1.5 bg-orange-600 hover:bg-orange-700">
                              <Check className="w-3.5 h-3.5" />
                              Processar Ajustes
                            </Button>
                          </PermissionGate>
                        )}

                        {/* Editar (apenas aberto) */}
                        {inv.status === "aberto" && (
                          <PermissionGate permission="inventario:criar">
                            <Button size="sm" variant="outline" onClick={() => { setEditingId(inv.id); setFormData({ numero: inv.numero, descricao: inv.descricao || "", observacoes: inv.observacoes || "" }); setShowForm(true); }} className="gap-1.5">
                              <Edit2 className="w-3.5 h-3.5" />
                              Editar
                            </Button>
                          </PermissionGate>
                        )}

                        {/* Excluir (apenas aberto) */}
                        {inv.status === "aberto" && (
                          <PermissionGate permission="inventario:criar">
                            <Button size="sm" variant="outline" onClick={() => handleDelete(inv.id)} className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50">
                              <Trash2 className="w-3.5 h-3.5" />
                              Excluir
                            </Button>
                          </PermissionGate>
                        )}

                        {/* Processado: só visualização */}
                        {inv.status === "processado" && (
                          <span className="flex items-center gap-1.5 text-sm text-green-600">
                            <CheckCircle2 className="w-4 h-4" />
                            Ajustes aplicados ao estoque
                          </span>
                        )}

                        {/* Observações */}
                        {inv.observacoes && (
                          <p className="w-full text-xs text-muted-foreground mt-1 pt-2 border-t border-border">
                            {inv.observacoes}
                          </p>
                        )}
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal de contagem */}
      {contandoId !== null && (
        <ModalContagem
          inventarioId={contandoId}
          onClose={() => setContandoId(null)}
          onSalvo={() => { refetch(); }}
        />
      )}
    </StockDashboardLayout>
  );
}

export default Inventario;
