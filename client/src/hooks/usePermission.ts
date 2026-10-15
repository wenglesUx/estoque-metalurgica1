import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Hook para verificar se o usuário tem uma permissão específica
 * Exemplo: const canEdit = usePermission("material.editar");
 */
export function usePermission(permissionKey: string): boolean {
  const { data: permissions = [] } = trpc.auth.getPermissions.useQuery();
  
  return useMemo(() => {
    return permissions.includes(permissionKey);
  }, [permissions, permissionKey]);
}

/**
 * Hook para verificar se o usuário tem qualquer uma das permissões fornecidas
 * Exemplo: const canModify = useAnyPermission(["material.editar", "material.criar"]);
 */
export function useAnyPermission(permissionKeys: string[]): boolean {
  const { data: permissions = [] } = trpc.auth.getPermissions.useQuery();
  
  return useMemo(() => {
    return permissionKeys.some(key => permissions.includes(key));
  }, [permissions, permissionKeys]);
}

/**
 * Hook para verificar se o usuário tem todas as permissões fornecidas
 * Exemplo: const canManage = useAllPermissions(["material.editar", "material.deletar"]);
 */
export function useAllPermissions(permissionKeys: string[]): boolean {
  const { data: permissions = [] } = trpc.auth.getPermissions.useQuery();
  
  return useMemo(() => {
    return permissionKeys.every(key => permissions.includes(key));
  }, [permissions, permissionKeys]);
}

/**
 * Hook para obter todas as permissões do usuário
 */
export function usePermissions() {
  const { data: permissions = [] } = trpc.auth.getPermissions.useQuery();
  return permissions;
}
