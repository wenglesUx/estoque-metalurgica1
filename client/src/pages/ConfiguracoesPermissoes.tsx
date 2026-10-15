import { StockDashboardLayout } from "@/components/StockDashboardLayout";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { trpc } from "@/lib/trpc";
import { ShieldCheck, Lock, TriangleAlert, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { toast } from "sonner";

// Colunas editáveis/exibidas na matriz — as 5 funções reais do sistema
// (mesma lista do seletor de nível em /usuarios). Viewer também é editável
// aqui como as demais: colunaTravada() só trava owner (sempre ligado) e admin
// nas chaves não-estritas (bypass automático do backend); viewer não tem
// bypass nenhum, então precisa do toggle igual supervisor/operator.
const COLUNAS: { role: "owner" | "admin" | "supervisor" | "operator" | "viewer"; label: string }[] = [
  { role: "owner", label: "Owner" },
  { role: "admin", label: "Admin" },
  { role: "supervisor", label: "Supervisor" },
  { role: "operator", label: "Operador" },
  { role: "viewer", label: "Visualizador" },
];

interface PermissaoCatalogo {
  id: number;
  chave: string;
  descricao: string;
  modulo: string;
  acao: string;
  aplicadaBackend: boolean;
  estrita: boolean;
}

function agruparPorModulo(catalogo: PermissaoCatalogo[]) {
  const grupos = new Map<string, PermissaoCatalogo[]>();
  for (const p of catalogo) {
    if (!grupos.has(p.modulo)) grupos.set(p.modulo, []);
    grupos.get(p.modulo)!.push(p);
  }
  return Array.from(grupos.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default function ConfiguracoesPermissoes() {
  const utils = trpc.useUtils();

  const catalogoQuery = trpc.permissoes.listarCatalogo.useQuery();
  const matrizQuery = trpc.permissoes.listarMatrizRoles.useQuery();

  const definirMutation = trpc.permissoes.definirRolePermissao.useMutation({
    onMutate: async ({ role, chave, habilitado }) => {
      await utils.permissoes.listarMatrizRoles.cancel();
      const anterior = utils.permissoes.listarMatrizRoles.getData();

      // Atualização otimista — a matriz reage na hora, sem esperar round-trip
      utils.permissoes.listarMatrizRoles.setData(undefined, (old) => {
        if (!old) return old;
        const atual = new Set(old[role] ?? []);
        if (habilitado) atual.add(chave);
        else atual.delete(chave);
        return { ...old, [role]: Array.from(atual) };
      });

      return { anterior };
    },
    onError: (err, _vars, context) => {
      if (context?.anterior) {
        utils.permissoes.listarMatrizRoles.setData(undefined, context.anterior);
      }
      toast.error(`Não foi possível salvar: ${err.message}`);
    },
    onSettled: () => {
      utils.permissoes.listarMatrizRoles.invalidate();
    },
  });

  const grupos = useMemo(
    () => agruparPorModulo((catalogoQuery.data as PermissaoCatalogo[]) ?? []),
    [catalogoQuery.data]
  );

  const matriz = matrizQuery.data ?? {};

  function temPermissao(role: string, chave: string): boolean {
    return (matriz[role] ?? []).includes(chave);
  }

  // Uma coluna só é "travada" (owner/admin sempre ligados, não clicável) quando
  // o backend dá bypass automático pra esse role naquela chave — permissaoProcedure
  // deixa owner+admin passarem sempre; permissaoEstritaProcedure só deixa owner.
  function colunaTravada(role: string, permissao: PermissaoCatalogo): boolean {
    if (role === "owner") return true;
    if (role === "admin") return !permissao.estrita;
    return false;
  }

  const carregando = catalogoQuery.isLoading || matrizQuery.isLoading;

  return (
    <StockDashboardLayout>
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="p-3 bg-indigo-100 dark:bg-indigo-950 rounded-lg">
            <ShieldCheck className="w-7 h-7 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-foreground">Permissões por Função</h2>
            <p className="text-muted-foreground mt-1">
              Liga e desliga o que cada função pode fazer no sistema.{" "}
              <strong className="text-foreground">O efeito é imediato</strong> — o usuário não
              precisa deslogar para sentir a mudança na próxima ação.
            </p>
          </div>
        </div>

        {carregando ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
            <Loader2 className="w-5 h-5 animate-spin" /> Carregando permissões...
          </div>
        ) : (
          <div className="space-y-6">
            {grupos.map(([modulo, permissoesDoModulo]) => (
              <Card key={modulo} className="overflow-hidden">
                <div className="px-5 py-3 bg-muted/50 border-b">
                  <h3 className="font-semibold text-foreground capitalize">{modulo}</h3>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-muted-foreground border-b">
                        <th className="px-5 py-2 font-medium">Permissão</th>
                        {COLUNAS.map((c) => (
                          <th key={c.role} className="px-3 py-2 font-medium text-center w-24">
                            {c.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {permissoesDoModulo.map((p) => (
                        <tr key={p.chave} className="border-b last:border-b-0 hover:bg-muted/30">
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-2">
                              <div>
                                <div className="font-medium text-foreground">{p.descricao}</div>
                                <div className="text-xs text-muted-foreground font-mono">{p.chave}</div>
                              </div>
                              {!p.aplicadaBackend && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="gap-1 text-amber-700 border-amber-300 bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:bg-amber-950/40"
                                    >
                                      <TriangleAlert className="w-3 h-3" />
                                      sem efeito ainda
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    Nenhum endpoint do backend checa esta chave ainda — o toggle
                                    fica salvo, mas não bloqueia nem libera nada na prática.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </td>
                          {COLUNAS.map((c) => {
                            const travada = colunaTravada(c.role, p);
                            const ligado = travada ? true : temPermissao(c.role, p.chave);
                            return (
                              <td key={c.role} className="px-3 py-3 text-center">
                                {travada ? (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="inline-flex items-center justify-center">
                                        <Lock className="w-4 h-4 text-muted-foreground" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      {c.role === "owner"
                                        ? "Owner sempre tem acesso — não editável."
                                        : "Admin tem bypass automático nesta chave — não editável."}
                                    </TooltipContent>
                                  </Tooltip>
                                ) : (
                                  <Switch
                                    checked={ligado}
                                    disabled={definirMutation.isPending}
                                    onCheckedChange={(checked) =>
                                      definirMutation.mutate({
                                        role: c.role,
                                        chave: p.chave,
                                        habilitado: checked,
                                      })
                                    }
                                  />
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </StockDashboardLayout>
  );
}
