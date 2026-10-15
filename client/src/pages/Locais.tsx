import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Plus, Edit2, Ban, CheckCircle2, MapPin, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader,
  DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";

export default function Locais() {
  const { data: locais, isLoading, refetch } = trpc.locais.listar.useQuery();
  const createLocal = trpc.locais.criar.useMutation();
  const updateLocal = trpc.locais.atualizar.useMutation();
  const deleteLocal = trpc.locais.deletar.useMutation();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nome, setNome] = useState("");
  const [searchText, setSearchText] = useState("");

  const filteredLocais = useMemo(() => {
    if (!locais) return [];
    const text = searchText.toLowerCase();
    return locais.filter((l) => l.nome.toLowerCase().includes(text));
  }, [locais, searchText]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome.trim()) return;
    try {
      if (editingId) {
        await updateLocal.mutateAsync({ id: editingId, nome: nome.trim() });
        toast.success("Local atualizado com sucesso!");
      } else {
        await createLocal.mutateAsync({ nome: nome.trim() });
        toast.success("Local criado com sucesso!");
      }
      setNome("");
      setEditingId(null);
      setShowForm(false);
      refetch();
    } catch (error: any) {
      toast.error(error?.message || (editingId ? "Erro ao atualizar local" : "Erro ao criar local"));
    }
  };

  const handleEdit = (local: { id: number; nome: string }) => {
    setEditingId(local.id);
    setNome(local.nome);
    setShowForm(true);
  };

  const handleToggleAtivo = async (local: { id: number; ativo: boolean }) => {
    try {
      if (local.ativo) {
        await deleteLocal.mutateAsync({ id: local.id });
        toast.success("Local desativado. Ele não aparecerá mais no seletor de cadastro.");
      } else {
        await updateLocal.mutateAsync({ id: local.id, ativo: true });
        toast.success("Local reativado!");
      }
      refetch();
    } catch (error) {
      toast.error("Erro ao alterar status do local");
    }
  };

  return (
    <StockDashboardLayout>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <MapPin className="w-6 h-6" /> Locais de Estoque
            </h1>
            <p className="text-sm text-muted-foreground">
              Lista de locais predefinidos usados no seletor do cadastro de materiais.
            </p>
          </div>
          <PermissionGate permission="locais:criar">
            <Button onClick={() => { setEditingId(null); setNome(""); setShowForm(true); }}>
              <Plus className="w-4 h-4 mr-2" /> Novo Local
            </Button>
          </PermissionGate>
        </div>

        <div className="relative max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar local..."
            className="pl-9"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>

        <Card className="divide-y">
          {isLoading && <div className="p-6 text-center text-muted-foreground">Carregando...</div>}
          {!isLoading && filteredLocais.length === 0 && (
            <div className="p-6 text-center text-muted-foreground">
              Nenhum local cadastrado ainda. Clique em "Novo Local" para começar.
            </div>
          )}
          {filteredLocais.map((local) => (
            <div key={local.id} className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <MapPin className={`w-4 h-4 ${local.ativo ? "text-primary" : "text-muted-foreground"}`} />
                <span className={`font-medium ${!local.ativo ? "text-muted-foreground line-through" : ""}`}>
                  {local.nome}
                </span>
                {!local.ativo && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Inativo</span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <PermissionGate permission="locais:editar">
                  <Button variant="ghost" size="icon" onClick={() => handleEdit(local)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </PermissionGate>
                <PermissionGate permission={local.ativo ? "locais:remover" : "locais:editar"}>
                  <Button variant="ghost" size="icon" onClick={() => handleToggleAtivo(local)}>
                    {local.ativo ? <Ban className="w-4 h-4 text-destructive" /> : <CheckCircle2 className="w-4 h-4 text-green-600" />}
                  </Button>
                </PermissionGate>
              </div>
            </div>
          ))}
        </Card>
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar Local" : "Novo Local"}</DialogTitle>
            <DialogDescription>
              Esse nome vai aparecer no seletor de localização do cadastro de materiais.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Nome do Local</label>
              <Input
                placeholder="Ex: Galpão A, Pátio Externo, Rua 03"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button type="submit">{editingId ? "Salvar" : "Criar"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </StockDashboardLayout>
  );
}
