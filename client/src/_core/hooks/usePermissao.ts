/**
 * usePermissao
 * Hook para verificar permissões no frontend.
 * Admins têm todas as permissões automaticamente.
 * 
 * Uso:
 *   const { pode } = usePermissao();
 *   if (pode("materiais:criar")) { ... }
 * 
 *   // Ou múltiplas:
 *   const podeCriar = useTemPermissao("materiais:criar");
 */
import { useAuth } from "./useAuth";
import type { Permissao } from "@shared/permissoes";

export function usePermissao() {
  const { user, isAdmin } = useAuth();

  const pode = (permissao: Permissao): boolean => {
    if (!user) return false;
    if (isAdmin) return true;
    return (user as any).permissoes?.includes(permissao) ?? false;
  };

  const podeAlgum = (...permissoes: Permissao[]): boolean =>
    permissoes.some((p) => pode(p));

  const podeTodos = (...permissoes: Permissao[]): boolean =>
    permissoes.every((p) => pode(p));

  return { pode, podeAlgum, podeTodos };
}

/** Shorthand para verificar uma permissão específica */
export function useTemPermissao(permissao: Permissao): boolean {
  const { pode } = usePermissao();
  return pode(permissao);
}
