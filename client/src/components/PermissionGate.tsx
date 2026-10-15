import React from "react";
import { usePermissao } from "@/_core/hooks/usePermissao";
import type { Permissao } from "@shared/permissoes";

interface PermissionGateProps {
  children: React.ReactNode;
  permission?: Permissao;
  permissions?: Permissao[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
}

/**
 * Componente que renderiza seu conteúdo apenas se o usuário tiver a permissão necessária
 *
 * Exemplos:
 * <PermissionGate permission="materiais:criar">
 *   <Button>Novo Material</Button>
 * </PermissionGate>
 *
 * <PermissionGate permissions={["materiais:editar", "materiais:remover"]} requireAll={false}>
 *   <Button>Modificar</Button>
 * </PermissionGate>
 */
export function PermissionGate({
  children,
  permission,
  permissions,
  requireAll = true,
  fallback = null,
}: PermissionGateProps) {
  const { pode, podeAlgum, podeTodos } = usePermissao();

  let hasPermission = false;

  if (permission) {
    hasPermission = pode(permission);
  } else if (permissions && permissions.length > 0) {
    hasPermission = requireAll
      ? podeTodos(...permissions)
      : podeAlgum(...permissions);
  }

  if (!hasPermission) {
    return fallback;
  }

  return <>{children}</>;
}

/**
 * Componente para desabilitar um elemento se o usuário não tiver permissão
 * Útil para botões que devem ficar visíveis mas desabilitados
 */
export function PermissionDisable({
  children,
  permission,
  permissions,
  requireAll = true,
}: Omit<PermissionGateProps, "fallback">) {
  const { pode, podeAlgum, podeTodos } = usePermissao();

  let hasPermission = false;

  if (permission) {
    hasPermission = pode(permission);
  } else if (permissions && permissions.length > 0) {
    hasPermission = requireAll
      ? podeTodos(...permissions)
      : podeAlgum(...permissions);
  }

  if (!hasPermission) {
    return React.cloneElement(children as React.ReactElement<any>, {
      disabled: true,
      title: "Você não tem permissão para esta ação",
    });
  }

  return <>{children}</>;
}

