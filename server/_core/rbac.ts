import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "./trpc";
import { getUserPermissions } from "./auth";
import type { TrpcContext } from "./context";

// Hierarquia de roles: quanto maior o número, mais permissões
const ROLE_HIERARCHY: Record<string, number> = {
  owner:      50,
  admin:      40,
  supervisor: 30,
  operator:   20,
  viewer:     10,
};

function hasMinRole(userRole: string | undefined | null, minRole: string): boolean {
  return (ROLE_HIERARCHY[userRole ?? ""] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}

/**
 * getUserPermissions() com cache por requisição (ctx.permissionsCache).
 * Uma mesma chamada tRPC pode passar por vários middlewares permissaoProcedure/
 * permissaoEstritaProcedure (ex: validação + sub-rotinas) — sem isso, cada um
 * dispararia sua própria consulta a role_permissoes + usuario_permissoes.
 */
function getCachedUserPermissions(ctx: TrpcContext, userId: number): Promise<string[]> {
  const cache = ctx.permissionsCache;
  let cached = cache.get(userId);
  if (!cached) {
    cached = getUserPermissions(userId);
    cache.set(userId, cached);
  }
  return cached;
}

/**
 * Chaves cujo endpoint correspondente ainda não existe ou não é checado em
 * lugar nenhum no backend — o toggle no painel de permissões (owner) não tem
 * efeito real sobre elas ainda. Usado só para exibir o aviso inline no painel;
 * não bloqueia o toggle (fica gravado em role_permissoes pra quando o endpoint
 * existir).
 */
export const CHAVES_SEM_COBERTURA_BACKEND: ReadonlySet<string> = new Set([
  "importacao:ver", // não existe endpoint de listagem/consulta de importações
]);

/**
 * Chaves protegidas por permissaoEstritaProcedure (não por permissaoProcedure).
 * Diferença que importa pro painel de permissões: em permissaoProcedure, admin
 * (e owner) sempre passam, então a coluna "Admin" da matriz não tem efeito real
 * e aparece travada. Em permissaoEstritaProcedure só owner tem bypass — admin
 * depende de fato da linha em role_permissoes, então aqui a coluna "Admin" deve
 * ficar editável.
 */
export const CHAVES_ESTRITAS: ReadonlySet<string> = new Set([
  "usuarios:remover",
]);

/**
 * Qualquer usuário autenticado, incluindo viewer (role >= viewer)
 * Use para endpoints de leitura que o visualizador deve acessar
 */
export const viewerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasMinRole(ctx.user?.role, "viewer")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a usuários autenticados",
    });
  }
  return next({ ctx });
});

/**
 * Qualquer usuário com role >= operator (operator, supervisor, admin, owner)
 */
export const operatorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasMinRole(ctx.user?.role, "operator")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a operadores",
    });
  }
  return next({ ctx });
});

/**
 * Apenas admin e owner
 */
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasMinRole(ctx.user?.role, "admin")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso restrito a administradores",
    });
  }
  return next({ ctx });
});

/**
 * Exclusivo para o proprietário do sistema (role === "owner").
 * Use para operações destrutivas e irreversíveis.
 */
export const ownerProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user?.role !== "owner") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Acesso exclusivo ao proprietário do sistema",
    });
  }
  return next({ ctx });
});

/**
 * Cria um middleware que exige uma permissão granular específica.
 * owner e admin passam automaticamente.
 *
 * Uso no router:
 *   listar: permissaoProcedure("materiais:ver").query(...)
 *   criar:  permissaoProcedure("materiais:criar").mutation(...)
 *
 * As chaves seguem o padrão definido em server/_core/auth.ts → initializeDefaultPermissions()
 * Ex: "materiais:criar", "obras:editar", "inventario:processar"
 */
export function permissaoProcedure(permissao: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    const role = ctx.user?.role ?? "";

    // Owner e admin têm acesso irrestrito
    if (hasMinRole(role, "admin")) {
      return next({ ctx });
    }

    const userId = ctx.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
    }

    // getUserPermissions junta: permissões do role + overrides individuais
    const perms = await getCachedUserPermissions(ctx, userId);
    if (!perms.includes(permissao)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permissão necessária: "${permissao}"`,
      });
    }

    return next({ ctx });
  });
}

/**
 * Permissão granular ESTRITA — diferente de permissaoProcedure, aqui só o
 * owner tem bypass automático. Admin precisa ter a chave concedida de
 * verdade (via role_permissoes ou override individual) para passar.
 *
 * Use para ações que devem poder ser negadas até para admin — ex.:
 * usuarios:remover, onde o seed padrão (server/_core/auth.ts) já não
 * concede a chave para admin de propósito.
 */
export function permissaoEstritaProcedure(permissao: string) {
  return protectedProcedure.use(async ({ ctx, next }) => {
    if (ctx.user?.role === "owner") {
      return next({ ctx });
    }

    const userId = ctx.user?.id;
    if (!userId) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Não autenticado" });
    }

    const perms = await getCachedUserPermissions(ctx, userId);
    if (!perms.includes(permissao)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Permissão necessária: "${permissao}"`,
      });
    }

    return next({ ctx });
  });
}