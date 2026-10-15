import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Plus, Edit2, Trash2, CheckCircle, Clock, PauseCircle, Search, MapPin, Building2, MoreHorizontal, ArrowUpDown, Check } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

const statusIcons: Record<string, React.ReactNode> = {
  ativa: <CheckCircle className="w-4 h-4 text-green-600" />,
  concluida: <CheckCircle className="w-4 h-4 text-gray-600" />,
  pausada: <PauseCircle className="w-4 h-4 text-yellow-600" />,
};

const statusLabels: Record<string, string> = {
  ativa: "Ativa",
  concluida: "Concluída",
  pausada: "Pausada",
};

export default function Obras() {
  const { data: obras, isLoading, refetch } = trpc.obras.list.useQuery();
  const createObra = trpc.obras.create.useMutation();
  const updateObra = trpc.obras.update.useMutation();
  const deleteObra = trpc.obras.delete.useMutation();
  
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  type CriterioOrdenacao = "codigo" | "recentes" | "alfabetica" | "status";
  const [ordenacao, setOrdenacao] = useState<CriterioOrdenacao>("recentes");

  const LABEL_ORDENACAO: Record<CriterioOrdenacao, string> = {
    codigo: "Número da Obra",
    recentes: "Data de Criação (mais recentes)",
    alfabetica: "Ordem Alfabética (A-Z)",
    status: "Status",
  };

  const ORDEM_STATUS: Record<string, number> = { ativa: 0, pausada: 1, concluida: 2 };

  const [formData, setFormData] = useState({
    nome: "",
    cliente: "",
    codigo: "",
    localizacao: "",
    logoUrl: "",
    status: "ativa" as const,
  });

  // Filtro de pesquisa
  const filteredObras = useMemo(() => {
    if (!obras) return [];
    const text = searchText.toLowerCase();
    const resultado = obras.filter(o => 
      o.nome.toLowerCase().includes(text) ||
      (o.cliente || "").toLowerCase().includes(text) ||
      (o.codigo || "").toLowerCase().includes(text) ||
      (o.localizacao || "").toLowerCase().includes(text)
    );
    const ordenado = [...resultado];
    switch (ordenacao) {
      case "codigo":
        ordenado.sort((a, b) => (a.codigo || "").localeCompare(b.codigo || "", "pt-BR", { numeric: true }));
        break;
      case "alfabetica":
        ordenado.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
        break;
      case "status":
        ordenado.sort((a, b) => (ORDEM_STATUS[a.status] ?? 99) - (ORDEM_STATUS[b.status] ?? 99));
        break;
      case "recentes":
      default:
        ordenado.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
    }
    return ordenado;
  }, [obras, searchText, ordenacao]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingId) {
        await updateObra.mutateAsync({ id: editingId, ...formData });
        toast.success("Obra atualizada com sucesso!");
        setEditingId(null);
      } else {
        await createObra.mutateAsync(formData);
        toast.success("Obra criada com sucesso!");
      }
      setFormData({ nome: "", cliente: "", codigo: "", localizacao: "", logoUrl: "", status: "ativa" });
      setShowForm(false);
      refetch();
    } catch (error: any) {
      const msg = error?.message ?? "";
      // Mensagens de validação do servidor (ex.: código repetido) vão direto pro usuário;
      // erro cru de SQL fica só no genérico.
      const amigavel = msg && !msg.startsWith("Failed query") ? msg : null;
      toast.error(amigavel ?? (editingId ? "Erro ao atualizar obra" : "Erro ao criar obra"));
    }
  };

  const handleEdit = (obra: any) => {
    setEditingId(obra.id);
    setFormData({
      nome: obra.nome,
      cliente: obra.cliente || "",
      codigo: obra.codigo || "",
      localizacao: obra.localizacao || "",
      logoUrl: obra.logoUrl || "",
      status: obra.status,
    });
    setShowForm(true);
  };

  const handleDelete = async (id: number) => {
    if (confirm("Tem certeza que deseja deletar esta obra?")) {
      try {
        await deleteObra.mutateAsync({ id });
        toast.success("Obra deletada com sucesso!");
        refetch();
      } catch (error) {
        toast.error("Erro ao deletar obra");
      }
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Obras</h2>
            <p className="text-muted-foreground mt-1">Gerenciar projetos e construções</p>
          </div>
          <PermissionGate permission="obras:criar">
          <Button
            onClick={() => {
              setEditingId(null);
              setFormData({ nome: "", cliente: "", codigo: "", localizacao: "", logoUrl: "", status: "ativa" });
              setShowForm(!showForm);
            }}
            className="gap-2 bg-accent hover:bg-accent/90"
          >
            <Plus className="w-4 h-4" />
            Nova Obra
          </Button>
          </PermissionGate>
        </div>

        {/* Barra de Pesquisa + Ordenação */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Pesquisar por nome, cliente, código ou localização..."
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              className="pl-10"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" className="gap-2 shrink-0">
                <ArrowUpDown className="w-4 h-4" />
                {LABEL_ORDENACAO[ordenacao]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {(Object.keys(LABEL_ORDENACAO) as CriterioOrdenacao[]).map((chave) => (
                <DropdownMenuItem key={chave} onClick={() => setOrdenacao(chave)} className="justify-between">
                  {LABEL_ORDENACAO[chave]}
                  {ordenacao === chave && <Check className="w-4 h-4" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Formulário */}
        {showForm && (
          <Card className="p-6 border border-border">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="text-sm font-medium text-foreground">Nome da Obra *</label>
                <Input
                  placeholder="Ex: Prédio Comercial Centro"
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium text-foreground">Cliente</label>
                  <Input
                    placeholder="Ex: Construtora XYZ"
                    value={formData.cliente}
                    onChange={(e) => setFormData({ ...formData, cliente: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-foreground">Código</label>
                  <Input
                    placeholder="Ex: OBR-2024-001"
                    value={formData.codigo}
                    onChange={(e) => setFormData({ ...formData, codigo: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Localização</label>
                <Input
                  placeholder="Ex: Rua Principal, 123 - São Paulo, SP"
                  value={formData.localizacao}
                  onChange={(e) => setFormData({ ...formData, localizacao: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">URL da Logo</label>
                <Input
                  placeholder="Ex: https://exemplo.com/logo.png"
                  value={formData.logoUrl}
                  onChange={(e) => setFormData({ ...formData, logoUrl: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Status</label>
                <select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground"
                >
                  <option value="ativa">Ativa</option>
                  <option value="pausada">Pausada</option>
                  <option value="concluida">Concluída</option>
                </select>
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="bg-accent hover:bg-accent/90">
                  Salvar
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Lista de Obras */}
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Carregando obras...</div>
        ) : filteredObras && filteredObras.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredObras.map((obra) => (
              <Card key={obra.id} className="group flex min-h-[242px] flex-col overflow-hidden rounded-2xl border-border/70 bg-card p-0 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-lg">
                <div className="flex items-start justify-between gap-3 border-b border-border/60 bg-muted/20 px-4 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="rounded-md bg-background px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide text-muted-foreground ring-1 ring-border/70">
                        {obra.codigo || "SEM CÓDIGO"}
                      </span>
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                        obra.status === "ativa" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" :
                        obra.status === "pausada" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${obra.status === "ativa" ? "bg-emerald-500" : obra.status === "pausada" ? "bg-amber-500" : "bg-muted-foreground"}`} />
                        {statusLabels[obra.status]}
                      </span>
                    </div>
                    <h3 className="line-clamp-2 text-[15px] font-semibold leading-tight tracking-[-0.01em] text-foreground">{obra.nome}</h3>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{obra.cliente || "Cliente não informado"}</p>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground opacity-70 transition-opacity hover:bg-background hover:text-foreground group-hover:opacity-100" aria-label={`Ações de ${obra.nome}`} title="Ações da obra">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44 rounded-xl p-1.5">
                      <PermissionGate permission="obras:editar">
                        <DropdownMenuItem onClick={() => handleEdit(obra)} className="gap-2 rounded-lg"><Edit2 className="h-4 w-4 text-muted-foreground" /> Editar obra</DropdownMenuItem>
                      </PermissionGate>
                      <PermissionGate permission="obras:remover">
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleDelete(obra.id)} className="gap-2 rounded-lg text-red-700 focus:text-red-700"><Trash2 className="h-4 w-4" /> Deletar obra</DropdownMenuItem>
                      </PermissionGate>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="flex flex-1 flex-col gap-4 p-4">
                  {obra.logoUrl ? (
                    <div className="flex h-16 items-center justify-center rounded-xl border border-border/60 bg-background/80 px-4 transition-colors group-hover:border-accent/30">
                      <img src={obra.logoUrl} alt={`Logo ${obra.nome}`} className="max-h-11 max-w-[78%] object-contain" />
                    </div>
                  ) : (
                    <div className="flex h-16 items-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 px-3 text-muted-foreground">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent"><Building2 className="h-4 w-4" /></span>
                      <span className="text-[11px] font-medium uppercase tracking-[0.12em]">Projeto HCM</span>
                    </div>
                  )}

                  <div className="mt-auto space-y-3">
                    {obra.localizacao && (
                      <div className="flex items-start gap-2 text-xs text-muted-foreground">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                        <span className="line-clamp-2 leading-relaxed">{obra.localizacao}</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">{statusIcons[obra.status]} {statusLabels[obra.status]}</span>
                      <span className="font-medium text-muted-foreground/80">Ações no menu</span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="p-12 border border-border text-center">
            <Building2 className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">
              {searchText ? "Nenhuma obra encontrada com esse filtro" : "Nenhuma obra registrada ainda"}
            </p>
          </Card>
        )}
      </div>
    </StockDashboardLayout>
  );
}
