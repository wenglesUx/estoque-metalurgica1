import { useState, useMemo } from "react";
import { PermissionGate } from "@/components/PermissionGate";
import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Plus, Edit2, UserX, Shield, Key, Check, X,
  User as UserIcon, Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { PERMISSOES, PERFIS, LISTA_PERMISSOES } from "@shared/permissoes";
import type { Permissao } from "@shared/permissoes";

// Agrupa as permissões por módulo para exibir de forma organizada
const GRUPOS_PERMISSOES: Record<string, { label: string; perms: Permissao[] }> = {
  dashboard:      { label: "Dashboard",         perms: [PERMISSOES.DASHBOARD_VER] },
  materiais:      { label: "Materiais",          perms: [PERMISSOES.MATERIAIS_VER, PERMISSOES.MATERIAIS_CRIAR, PERMISSOES.MATERIAIS_EDITAR, PERMISSOES.MATERIAIS_REMOVER, PERMISSOES.MATERIAIS_AJUSTAR, PERMISSOES.MATERIAIS_IMPORTAR, PERMISSOES.MATERIAIS_A_CHEGAR_VER] },
  obras:          { label: "Obras",              perms: [PERMISSOES.OBRAS_VER, PERMISSOES.OBRAS_CRIAR, PERMISSOES.OBRAS_EDITAR, PERMISSOES.OBRAS_REMOVER] },
  solicitacoes:   { label: "Solicitações",       perms: [PERMISSOES.SOLICITACOES_VER, PERMISSOES.SOLICITACOES_CRIAR, PERMISSOES.SOLICITACOES_RESPONDER, PERMISSOES.SOLICITACOES_CONCLUIR] },
  movimentacoes:  { label: "Movimentações",      perms: [PERMISSOES.MOVIMENTACOES_VER] },
  saidas:         { label: "Registros de Saída", perms: [PERMISSOES.SAIDAS_VER, PERMISSOES.SAIDAS_CRIAR] },
  relatorios:     { label: "Relatórios",         perms: [PERMISSOES.RELATORIOS_VER, PERMISSOES.RELATORIOS_EXPORTAR] },
  inventario:     { label: "Inventário",         perms: [PERMISSOES.INVENTARIO_VER, PERMISSOES.INVENTARIO_CRIAR, PERMISSOES.INVENTARIO_CONTAR, PERMISSOES.INVENTARIO_PROCESSAR] },
  especificacoes: { label: "Especificações",     perms: [PERMISSOES.ESPECIFICACOES_VER, PERMISSOES.ESPECIFICACOES_EDITAR] },
  importacao:     { label: "Importação",         perms: [PERMISSOES.IMPORTACAO_VER, PERMISSOES.IMPORTACAO_EXECUTAR] },
  usuarios:       { label: "Usuários",           perms: [PERMISSOES.USUARIOS_VER, PERMISSOES.USUARIOS_CRIAR, PERMISSOES.USUARIOS_EDITAR, PERMISSOES.USUARIOS_REMOVER, PERMISSOES.USUARIOS_PERMISSOES] },
};

// Label amigável para cada permissão
const LABEL_PERMISSAO: Record<string, string> = {
  "dashboard:ver":            "Visualizar dashboard",
  "materiais:ver":            "Visualizar materiais",
  "materiais:criar":          "Cadastrar materiais",
  "materiais:editar":         "Editar materiais",
  "materiais:remover":        "Remover materiais",
  "materiais:ajustar":        "Ajustar saldo",
  "materiais:importar":       "Importar Excel/NF-e",
  "materiais_a_chegar:ver":   "Visualizar materiais a chegar",
  "obras:ver":                "Visualizar obras",
  "obras:criar":              "Cadastrar obras",
  "obras:editar":             "Editar obras",
  "obras:remover":            "Remover obras",
  "solicitacoes:ver":         "Visualizar solicitações",
  // Apesar do nome, esta chave não controla a criação de solicitações (essa
  // ação é liberada a qualquer operador) — ela protege excluir solicitações
  // e criar planos de corte. Ver comentário em server/routers.ts.
  "solicitacoes:criar":       "Excluir solicitações e criar planos de corte",
  "solicitacoes:responder":   "Responder solicitações",
  "solicitacoes:concluir":    "Concluir separação",
  "movimentacoes:ver":        "Visualizar movimentações",
  "saidas:ver":               "Visualizar registros de saída",
  "saidas:criar":             "Registrar saída",
  "relatorios:ver":           "Visualizar relatórios",
  "relatorios:exportar":      "Exportar Excel",
  "inventario:ver":           "Visualizar inventário",
  "inventario:criar":         "Criar inventário",
  "inventario:contar":        "Realizar contagem",
  "inventario:processar":     "Processar ajustes",
  "especificacoes:ver":       "Visualizar especificações",
  "especificacoes:editar":    "Editar especificações",
  "importacao:ver":           "Visualizar importação",
  "importacao:executar":      "Executar importação",
  "usuarios:ver":             "Visualizar usuários",
  "usuarios:criar":           "Criar usuários",
  "usuarios:editar":          "Editar usuários",
  "usuarios:remover":         "Desativar usuários",
  "usuarios:permissoes":      "Gerenciar permissões",
};

// Badge de cargo — cobre os 5 roles reais (antes só distinguia admin/"Operador",
// então supervisor/operator/viewer/owner apareciam todos rotulados "Operador")
const ROLE_INFO: Record<string, { label: string; className: string; Icon: typeof Shield }> = {
  owner:      { label: "Owner",         className: "bg-amber-100 text-amber-800",   Icon: Shield },
  admin:      { label: "Admin",         className: "bg-purple-100 text-purple-800", Icon: Shield },
  supervisor: { label: "Supervisor",    className: "bg-indigo-100 text-indigo-800", Icon: UserIcon },
  operator:   { label: "Operador",      className: "bg-blue-100 text-blue-800",     Icon: UserIcon },
  viewer:     { label: "Visualizador",  className: "bg-slate-100 text-slate-700",   Icon: UserIcon },
};

// ─── Modal de permissões ──────────────────────────────────────────────────────
function ModalPermissoes({ usuario, onClose }: { usuario: any; onClose: () => void }) {
  const { data: permissoesAtuais, isLoading } = trpc.usuarios.getPermissoes.useQuery(
    { usuarioId: usuario.id },
    { enabled: !!usuario.id }
  );
  const definirMutation = trpc.usuarios.definirPermissoes.useMutation();
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [inicializado, setInicializado] = useState(false);

  if (!isLoading && !inicializado && permissoesAtuais) {
    setSelecionadas(new Set(permissoesAtuais));
    setInicializado(true);
  }

  const togglePerm = (p: string) => {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      next.has(p) ? next.delete(p) : next.add(p);
      return next;
    });
  };

  const aplicarPerfil = (perfil: keyof typeof PERFIS) => {
    setSelecionadas(new Set(PERFIS[perfil]));
  };

  const handleSalvar = async () => {
    try {
      await definirMutation.mutateAsync({
        usuarioId: usuario.id,
        permissoes: Array.from(selecionadas),
      });
      toast.success("Permissões salvas!");
      onClose();
    } catch {
      toast.error("Erro ao salvar permissões.");
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            Permissões de {usuario.name}
          </DialogTitle>
          <DialogDescription>
            {usuario.role === "admin"
              ? "Administradores têm todas as permissões automaticamente."
              : `${selecionadas.size} de ${LISTA_PERMISSOES.length} permissões ativas.`}
          </DialogDescription>
        </DialogHeader>

        {usuario.role === "admin" ? (
          <div className="p-4 bg-green-50 text-green-800 rounded-lg text-sm">
            Administradores têm acesso total ao sistema — não é necessário configurar permissões individualmente.
          </div>
        ) : (
          <>
            {/* Atalhos de perfil */}
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase">Aplicar perfil rapidamente</p>
              <div className="flex flex-wrap gap-2">
                {Object.keys(PERFIS).map((perfil) => (
                  <Button
                    key={perfil}
                    size="sm"
                    variant="outline"
                    onClick={() => aplicarPerfil(perfil as keyof typeof PERFIS)}
                    className="text-xs"
                  >
                    {perfil}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelecionadas(new Set())}
                  className="text-xs text-red-600 border-red-200 hover:bg-red-50"
                >
                  Remover todas
                </Button>
              </div>
            </div>

            {/* Grupos de permissões */}
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {isLoading ? (
                <div className="p-4 text-center text-muted-foreground text-sm">Carregando...</div>
              ) : (
                Object.entries(GRUPOS_PERMISSOES).map(([key, grupo]) => (
                  <div key={key}>
                    <p className="text-xs font-semibold text-muted-foreground uppercase mb-1.5">
                      {grupo.label}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {grupo.perms.map((perm) => {
                        const ativa = selecionadas.has(perm);
                        return (
                          <button
                            key={perm}
                            onClick={() => togglePerm(perm)}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                              ativa
                                ? "bg-accent/10 border-accent text-accent-foreground font-medium"
                                : "border-border hover:bg-muted/50 text-foreground"
                            }`}
                          >
                            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${ativa ? "bg-accent border-accent" : "border-border"}`}>
                              {ativa && <Check className="w-2.5 h-2.5 text-accent-foreground" />}
                            </span>
                            {LABEL_PERMISSAO[perm] ?? perm}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        <DialogFooter className="border-t pt-4">
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          {usuario.role !== "admin" && (
            <Button onClick={handleSalvar} disabled={definirMutation.isPending} className="gap-2">
              <Shield className="w-4 h-4" />
              {definirMutation.isPending ? "Salvando..." : "Salvar Permissões"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Modal criar/editar usuário ───────────────────────────────────────────────
function ModalUsuario({
  usuario,
  onClose,
  onSalvo,
}: {
  usuario?: any;
  onClose: () => void;
  onSalvo: () => void;
}) {
  const isEdicao = !!usuario;
  const [form, setForm] = useState({
    name: usuario?.name || "",
    email: usuario?.email || "",
    cargo: usuario?.cargo || "",
    role: usuario?.role || "operator",
    senha: "",
    ativo: usuario?.ativo ?? true,
  });

  const criarMutation = trpc.usuarios.criar.useMutation();
  const editarMutation = trpc.usuarios.editar.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (isEdicao) {
        await editarMutation.mutateAsync({
          id: usuario.id,
          name: form.name || undefined,
          email: form.email || undefined,
          cargo: form.cargo || undefined,
          role: form.role as any,
          ativo: form.ativo,
          novaSenha: form.senha || undefined,
        });
        toast.success("Usuário atualizado!");
      } else {
        await criarMutation.mutateAsync({
          name: form.name,
          email: form.email,
          senha: form.senha,
          role: form.role as any,
          cargo: form.cargo || undefined,
        });
        toast.success("Usuário criado! Já pode fazer login.");
      }
      onSalvo();
      onClose();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar usuário.");
    }
  };

  const isPending = criarMutation.isPending || editarMutation.isPending;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdicao ? "Editar Usuário" : "Novo Usuário"}</DialogTitle>
          <DialogDescription>
            {isEdicao ? "Altere os dados do usuário." : "Preencha os dados para criar um novo acesso."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">Nome *</label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Nome completo" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">E-mail *</label>
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@empresa.com" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">Cargo / Função</label>
            <Input value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Ex: Almoxarife, Engenheiro..." />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground uppercase">Nível</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
              >
                <option value="admin">Administrador</option>
                <option value="supervisor">Supervisor</option>
                <option value="operator">Operador</option>
                <option value="viewer">Visualizador</option>
              </select>
            </div>
            {isEdicao && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground uppercase">Status</label>
                <select
                  value={form.ativo ? "ativo" : "inativo"}
                  onChange={(e) => setForm({ ...form, ativo: e.target.value === "ativo" })}
                  className="w-full px-3 py-2 border border-border rounded-md bg-background text-foreground text-sm"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground uppercase">
              {isEdicao ? "Nova Senha (deixe vazio para manter)" : "Senha *"}
            </label>
            <Input
              type="password"
              value={form.senha}
              onChange={(e) => setForm({ ...form, senha: e.target.value })}
              placeholder="Mínimo 6 caracteres"
              minLength={isEdicao ? undefined : 6}
              required={!isEdicao ? true : undefined}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={isPending} className="gap-2">
              <UserIcon className="w-4 h-4" />
              {isPending ? "Salvando..." : isEdicao ? "Salvar" : "Criar Usuário"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function Usuarios() {
  const { data: usuarios, refetch, isLoading } = trpc.usuarios.listar.useQuery();
  const desativarMutation = trpc.usuarios.desativar.useMutation();

  const [filtro, setFiltro] = useState("");
  const [modalUsuario, setModalUsuario] = useState<"criar" | "editar" | null>(null);
  const [usuarioSelecionado, setUsuarioSelecionado] = useState<any | null>(null);
  const [modalPermissoes, setModalPermissoes] = useState(false);

  const usuariosFiltrados = useMemo(() => {
    if (!usuarios) return [];
    const t = filtro.toLowerCase();
    return usuarios.filter(
      (u) =>
        u.name?.toLowerCase().includes(t) ||
        u.email?.toLowerCase().includes(t) ||
        u.cargo?.toLowerCase().includes(t)
    );
  }, [usuarios, filtro]);

  const handleDesativar = async (u: any) => {
    if (!confirm(`Desativar "${u.name}"? O usuário não conseguirá mais fazer login.`)) return;
    try {
      await desativarMutation.mutateAsync({ id: u.id });
      toast.success(`${u.name} desativado.`);
      refetch();
    } catch {
      toast.error("Erro ao desativar usuário.");
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-foreground">Gestão de Usuários</h2>
            <p className="text-muted-foreground mt-1">
              Crie contas e defina o que cada pessoa pode fazer no sistema.
            </p>
          </div>
          <PermissionGate permission="usuarios:criar">
            <Button onClick={() => { setUsuarioSelecionado(null); setModalUsuario("criar"); }} className="gap-2 self-start md:self-auto">
              <Plus className="w-4 h-4" /> Novo Usuário
            </Button>
          </PermissionGate>
        </div>

        {/* Filtro */}
        <Card className="p-4 border border-border bg-muted/30">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, e-mail ou cargo..."
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
              className="pl-10"
            />
          </div>
        </Card>

        {/* Tabela de usuários */}
        <Card className="border border-border overflow-hidden">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Carregando...</div>
          ) : usuariosFiltrados.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <UserIcon className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>Nenhum usuário encontrado.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Usuário</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase">Nível</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase hidden md:table-cell">Cargo</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground text-xs uppercase hidden md:table-cell">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground text-xs uppercase">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {usuariosFiltrados.map((u) => (
                    <tr key={u.id} className={`hover:bg-muted/30 transition-colors ${!u.ativo ? "opacity-50" : ""}`}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{u.name || "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="px-4 py-3">
                        {(() => {
                          const info = ROLE_INFO[u.role] ?? ROLE_INFO.operator;
                          return (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${info.className}`}>
                              <info.Icon className="w-3 h-3" />
                              {info.label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">{u.cargo || "—"}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                          u.ativo ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"
                        }`}>
                          {u.ativo ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                          {u.ativo ? "Ativo" : "Inativo"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <PermissionGate permission="usuarios:permissoes">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Permissões"
                              onClick={() => { setUsuarioSelecionado(u); setModalPermissoes(true); }}
                              className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                            >
                              <Key className="w-4 h-4" />
                            </Button>
                          </PermissionGate>
                          <PermissionGate permission="usuarios:editar">
                            <Button
                              size="sm"
                              variant="ghost"
                              title="Editar"
                              onClick={() => { setUsuarioSelecionado(u); setModalUsuario("editar"); }}
                            >
                              <Edit2 className="w-4 h-4" />
                            </Button>
                          </PermissionGate>
                          {u.ativo && (
                            <PermissionGate permission="usuarios:remover">
                              <Button
                                size="sm"
                                variant="ghost"
                                title="Desativar"
                                onClick={() => handleDesativar(u)}
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                <UserX className="w-4 h-4" />
                              </Button>
                            </PermissionGate>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Modais */}
      {(modalUsuario === "criar" || modalUsuario === "editar") && (
        <ModalUsuario
          usuario={modalUsuario === "editar" ? usuarioSelecionado : undefined}
          onClose={() => { setModalUsuario(null); setUsuarioSelecionado(null); }}
          onSalvo={refetch}
        />
      )}
      {modalPermissoes && usuarioSelecionado && (
        <ModalPermissoes
          usuario={usuarioSelecionado}
          onClose={() => { setModalPermissoes(false); setUsuarioSelecionado(null); }}
        />
      )}
    </StockDashboardLayout>
  );
}
