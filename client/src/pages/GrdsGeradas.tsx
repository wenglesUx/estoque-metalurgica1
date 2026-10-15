import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { PermissionGate } from "@/components/PermissionGate";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { FileText, Download, Search, Paperclip, Calendar, User, ChevronDown, ChevronUp, Loader2, Trash2, Pencil, Check, X } from "lucide-react";
import { useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

// ─── Materiais de uma GRD (carregado sob demanda ao expandir a linha) ────────
function MateriaisDaGrd({ id }: { id: number }) {
  const { data: grd, isLoading } = trpc.grd.obter.useQuery({ id });
  const materiais = grd?.dados?.materiais ?? [];

  if (isLoading) {
    return (
      <div className="px-4 py-3 flex items-center gap-2 text-xs text-muted-foreground bg-muted/20">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carregando materiais...
      </div>
    );
  }

  if (materiais.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground bg-muted/20">
        Nenhum material registrado nesta GRD.
      </div>
    );
  }

  return (
    <div className="bg-muted/20 px-4 py-3">
      <table className="w-full text-xs">
        <thead className="text-muted-foreground uppercase font-bold">
          <tr>
            <th className="text-left pb-1.5 pr-2">Material</th>
            <th className="text-left pb-1.5 pr-2">Aço</th>
            <th className="text-left pb-1.5 pr-2">Comprimento</th>
            <th className="text-left pb-1.5 pr-2">Qtd</th>
            <th className="text-left pb-1.5 pr-2">Certificado</th>
            <th className="text-left pb-1.5">NF</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {materiais.map((m: any, idx: number) => (
            <tr key={idx}>
              <td className="py-1.5 pr-2 font-medium">
                {m.tipo} {m.bitola}{m.largura ? ` X ${m.largura}` : ""}
              </td>
              <td className="py-1.5 pr-2">{m.aco || "-"}</td>
              <td className="py-1.5 pr-2">{m.comprimento ? `${m.comprimento}mm` : "-"}</td>
              <td className="py-1.5 pr-2">{m.quantidade} {m.unidade || "PÇ"}</td>
              <td className="py-1.5 pr-2">{m.certificado || "-"}</td>
              <td className="py-1.5">{m.nf || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function GrdsGeradas() {
  const { data: grds, isLoading } = trpc.grd.listar.useQuery();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const [busca, setBusca] = useState("");
  const [baixandoId, setBaixandoId] = useState<number | null>(null);
  const [expandidoId, setExpandidoId] = useState<number | null>(null);
  const [editandoNumeroId, setEditandoNumeroId] = useState<number | null>(null);
  const [numeroEditado, setNumeroEditado] = useState("");
  const deletarMutation = trpc.grd.deletar.useMutation();
  const editarNumeroMutation = trpc.grd.editarNumero.useMutation();

  const filtrados = useMemo(() => {
    if (!grds) return [];
    const termo = busca.trim().toLowerCase();
    if (!termo) return grds;
    return grds.filter((g: any) =>
      g.numero?.toLowerCase().includes(termo) ||
      g.obra?.toLowerCase().includes(termo) ||
      g.cliente?.toLowerCase().includes(termo)
    );
  }, [grds, busca]);

  const handleBaixarZip = async (id: number) => {
    setBaixandoId(id);
    try {
      const resultado = await utils.client.grd.baixarZip.query({ id });
      const bytes = Uint8Array.from(atob(resultado.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = resultado.fileName; link.click();
      URL.revokeObjectURL(url);
      toast.success("Download iniciado — GRD + certificados no mesmo ZIP.");
    } catch {
      toast.error("Erro ao baixar a GRD.");
    } finally {
      setBaixandoId(null);
    }
  };

  const handleExcluir = async (g: any) => {
    if (!confirm(`Excluir a GRD ${g.numero} (${g.obra}) permanentemente? Os certificados anexados também serão removidos. Essa ação não pode ser desfeita.`)) return;
    try {
      await deletarMutation.mutateAsync({ id: g.id });
      toast.success(`GRD ${g.numero} excluída.`);
      utils.grd.listar.invalidate();
      utils.grd.proximoNumero.invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao excluir a GRD.");
    }
  };

  const iniciarEdicaoNumero = (g: any) => {
    setEditandoNumeroId(g.id);
    setNumeroEditado(g.numero);
  };

  const cancelarEdicaoNumero = () => {
    setEditandoNumeroId(null);
    setNumeroEditado("");
  };

  const salvarNumeroEditado = async (id: number) => {
    if (!numeroEditado.trim()) { toast.error("Informe um número."); return; }
    try {
      await editarNumeroMutation.mutateAsync({ id, numero: numeroEditado.trim() });
      toast.success("Número da GRD atualizado.");
      cancelarEdicaoNumero();
      utils.grd.listar.invalidate();
      utils.grd.proximoNumero.invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao atualizar o número.");
    }
  };

  return (
    <StockDashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">GRDs Geradas</h2>
            <p className="text-muted-foreground">
              Toda GRD gerada fica salva aqui, junto com os certificados anexados na hora —
              baixe de novo a qualquer momento, com os dois juntos no mesmo ZIP.
            </p>
          </div>
        </div>

        <Card className="p-4">
          <div className="relative max-w-sm mb-4">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por número, obra ou cliente..."
              className="pl-9"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>

          <div className="divide-y divide-border border rounded-lg overflow-hidden">
            {isLoading ? (
              <div className="p-6 text-center text-sm text-muted-foreground">Carregando...</div>
            ) : filtrados.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {busca ? "Nenhuma GRD encontrada com esse filtro." : "Nenhuma GRD gerada ainda."}
              </div>
            ) : (
              filtrados.map((g: any) => {
                const aberto = expandidoId === g.id;
                return (
                <div key={g.id}>
                  <div
                    onClick={() => setExpandidoId(aberto ? null : g.id)}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer"
                  >
                    <div className="min-w-0 flex items-start gap-2">
                      {aberto ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 mt-1" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {editandoNumeroId === g.id ? (
                            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                              <span className="font-bold text-base">GRD</span>
                              <Input
                                autoFocus
                                value={numeroEditado}
                                onChange={(e) => setNumeroEditado(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") salvarNumeroEditado(g.id); if (e.key === "Escape") cancelarEdicaoNumero(); }}
                                className="h-7 w-24 text-sm font-bold"
                              />
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-green-600 hover:text-green-700" disabled={editarNumeroMutation.isPending} onClick={() => salvarNumeroEditado(g.id)}>
                                <Check className="w-3.5 h-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground" onClick={cancelarEdicaoNumero}>
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          ) : (
                            <span className="font-bold text-base flex items-center gap-1 group">
                              GRD {g.numero}
                              <PermissionGate permission="grds:gerar">
                                <button
                                  type="button"
                                  title="Editar número"
                                  onClick={(e) => { e.stopPropagation(); iniciarEdicaoNumero(g); }}
                                  className="text-muted-foreground/50 hover:text-foreground transition-colors"
                                >
                                  <Pencil className="w-3 h-3" />
                                </button>
                              </PermissionGate>
                            </span>
                          )}
                          <span className="text-muted-foreground">—</span>
                          <span className="font-semibold text-base truncate">{g.obra}</span>
                          {g.totalCertificados > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
                              <Paperclip className="w-3 h-3" /> {g.totalCertificados} certificado{g.totalCertificados === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                          {g.cliente && <span>Cliente: {g.cliente}</span>}
                          <span>{g.totalItens} {g.totalItens === 1 ? "item" : "itens"}</span>
                          <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(new Date(g.createdAt), "dd/MM/yyyy HH:mm", { locale: ptBR })}</span>
                          <span className="flex items-center gap-1"><User className="w-3 h-3" /> {g.usuarioNome || "Sistema"}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={baixandoId === g.id}
                        onClick={(e) => { e.stopPropagation(); handleBaixarZip(g.id); }}
                        className="gap-2"
                      >
                        <Download className="w-3.5 h-3.5" /> {baixandoId === g.id ? "Gerando..." : "Baixar ZIP"}
                      </Button>
                      {user?.role === "owner" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deletarMutation.isPending}
                          onClick={(e) => { e.stopPropagation(); handleExcluir(g); }}
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          title="Excluir GRD (owner)"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {aberto && <MateriaisDaGrd id={g.id} />}
                </div>
                );
              })
            )}
          </div>

          {!isLoading && filtrados.length > 0 && (
            <div className="mt-4 text-xs text-muted-foreground flex items-center gap-2">
              <FileText className="w-3 h-3" />
              Total de {filtrados.length} GRDs encontradas.
            </div>
          )}
        </Card>
      </div>
    </StockDashboardLayout>
  );
}
