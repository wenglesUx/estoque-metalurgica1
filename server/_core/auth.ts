import { createHash, randomBytes } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { users, permissoes, rolePermissoes, usuarioPermissoes } from "../../drizzle/schema";
import { getDb } from "../db";

// ─── Hashing com crypto nativo (sem dependência de bcrypt) ───────────────────
// Mesmo formato usado em db.ts: "salt:sha256hash"

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const check = createHash("sha256").update(salt + password).digest("hex");
  return check === hash;
}

// ─── Autenticação ────────────────────────────────────────────────────────────

export async function createLocalUser(data: {
  name: string;
  email: string;
  password: string;
  role?: "owner" | "admin" | "supervisor" | "operator" | "viewer";
}) {
  const db = await getDb();
  const passwordHash = hashPassword(data.password);
  const openId = `local_${Date.now()}_${randomBytes(6).toString("hex")}`;

  const result = await db.insert(users).values({
    openId,
    name: data.name,
    email: data.email,
    passwordHash,
    loginMethod: "local",
    role: data.role || "operator",
    ativo: true,
  });

  return result;
}

export async function authenticateUser(email: string, password: string) {
  const db = await getDb();

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);

  if (!rows || rows.length === 0) {
    throw new Error("E-mail ou senha incorretos.");
  }

  const user = rows[0];

  if (!user.passwordHash) {
    throw new Error("Este usuário não possui autenticação local configurada.");
  }

  if (!user.ativo) {
    throw new Error("Usuário inativo. Contate o administrador.");
  }

  const valid = verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new Error("E-mail ou senha incorretos.");
  }

  // Atualiza lastSignedIn sem bloquear o retorno
  db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id)).catch(() => {});

  return user;
}

// ─── Permissões ──────────────────────────────────────────────────────────────

export async function getUserPermissions(userId: number): Promise<string[]> {
  const db = await getDb();

  const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!userResult || userResult.length === 0) return [];

  const user = userResult[0];

  // Permissões do role
  const rolePerms = await db
    .select({ permissaoId: rolePermissoes.permissaoId })
    .from(rolePermissoes)
    .where(eq(rolePermissoes.role, user.role));

  // Overrides customizados por usuário
  const customPerms = await db
    .select()
    .from(usuarioPermissoes)
    .where(eq(usuarioPermissoes.usuarioId, userId));

  const permissionMap = new Map<number, boolean>();
  rolePerms.forEach(rp => permissionMap.set(rp.permissaoId, true));
  customPerms.forEach(up => permissionMap.set(up.permissaoId, up.permitido));

  const permIds = Array.from(permissionMap.entries())
    .filter(([, allowed]) => allowed)
    .map(([id]) => id);

  if (permIds.length === 0) return [];

  const permDetails = await db
    .select()
    .from(permissoes)
    .where(sql`${permissoes.id} IN (${sql.join(permIds.map(id => sql`${id}`), sql`, `)})`);

  return permDetails.map(p => p.chave);
}

export async function hasPermission(userId: number, key: string): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return perms.includes(key);
}

export async function hasAnyPermission(userId: number, keys: string[]): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return keys.some(k => perms.includes(k));
}

export async function hasAllPermissions(userId: number, keys: string[]): Promise<boolean> {
  const perms = await getUserPermissions(userId);
  return keys.every(k => perms.includes(k));
}

// ─── Inicialização de permissões padrão ──────────────────────────────────────

export async function initializeDefaultPermissions() {
  const db = await getDb();

  // Chaves no padrão "entidade:acao" — em sincronia com shared/permissoes.ts
  const defaultPermissions = [
    // Materiais
    { chave: "materiais:ver",       descricao: "Visualizar materiais",        modulo: "materiais",      acao: "ver" },
    { chave: "materiais:criar",     descricao: "Criar novo material",         modulo: "materiais",      acao: "criar" },
    { chave: "materiais:editar",    descricao: "Editar material",             modulo: "materiais",      acao: "editar" },
    { chave: "materiais:remover",   descricao: "Remover material",            modulo: "materiais",      acao: "remover" },
    { chave: "materiais:importar",  descricao: "Importar materiais",          modulo: "materiais",      acao: "importar" },
    { chave: "materiais:ajustar",   descricao: "Ajuste manual de saldo",      modulo: "materiais",      acao: "ajustar" },
    { chave: "materiais_a_chegar:ver", descricao: "Visualizar materiais a chegar", modulo: "materiais", acao: "ver_a_chegar" },
    // Obras
    { chave: "obras:ver",           descricao: "Visualizar obras",            modulo: "obras",          acao: "ver" },
    { chave: "obras:criar",         descricao: "Criar nova obra",             modulo: "obras",          acao: "criar" },
    { chave: "obras:editar",        descricao: "Editar obra",                 modulo: "obras",          acao: "editar" },
    { chave: "obras:remover",       descricao: "Remover obra",                modulo: "obras",          acao: "remover" },
    // Solicitações
    { chave: "solicitacoes:ver",       descricao: "Visualizar solicitações",  modulo: "solicitacoes",   acao: "ver" },
    // Nome histórico não bate com o que a chave realmente protege — ver nota em
    // shared/permissoes.ts e server/routers.ts (planoCorte.criar, solicitacoes.deletar).
    { chave: "solicitacoes:criar",     descricao: "Criar plano de corte / excluir solicitação", modulo: "solicitacoes", acao: "criar" },
    { chave: "solicitacoes:responder", descricao: "Responder solicitação",    modulo: "solicitacoes",   acao: "responder" },
    { chave: "solicitacoes:concluir",  descricao: "Concluir solicitação",     modulo: "solicitacoes",   acao: "concluir" },
    // Movimentações
    { chave: "movimentacoes:ver",   descricao: "Visualizar movimentações",    modulo: "movimentacoes",  acao: "ver" },
    // Saídas
    { chave: "saidas:ver",          descricao: "Visualizar saídas",           modulo: "saidas",         acao: "ver" },
    { chave: "saidas:criar",        descricao: "Criar registro de saída",     modulo: "saidas",         acao: "criar" },
    // Relatórios
    { chave: "relatorios:ver",      descricao: "Visualizar relatórios",       modulo: "relatorios",     acao: "ver" },
    { chave: "relatorios:exportar", descricao: "Exportar relatórios",         modulo: "relatorios",     acao: "exportar" },
    // Inventário
    { chave: "inventario:ver",        descricao: "Visualizar inventários",    modulo: "inventario",     acao: "ver" },
    { chave: "inventario:criar",      descricao: "Criar inventário",          modulo: "inventario",     acao: "criar" },
    { chave: "inventario:contar",     descricao: "Contar itens do inventário",modulo: "inventario",     acao: "contar" },
    { chave: "inventario:processar",  descricao: "Processar inventário",      modulo: "inventario",     acao: "processar" },
    // Especificações
    { chave: "especificacoes:ver",    descricao: "Visualizar especificações", modulo: "especificacoes", acao: "ver" },
    { chave: "especificacoes:editar", descricao: "Editar especificações",     modulo: "especificacoes", acao: "editar" },
    // Importação
    { chave: "importacao:ver",        descricao: "Visualizar importações",    modulo: "importacao",     acao: "ver" },
    { chave: "importacao:executar",   descricao: "Executar importação",       modulo: "importacao",     acao: "executar" },
    // GRDs geradas
    { chave: "grds:ver",              descricao: "Visualizar GRDs geradas",   modulo: "grds",           acao: "ver" },
    { chave: "grds:gerar",            descricao: "Gerar GRD",                 modulo: "grds",           acao: "gerar" },
    // Registros de entrada
    { chave: "registros_entrada:ver", descricao: "Visualizar registros de entrada", modulo: "registros_entrada", acao: "ver" },
    // Locais
    { chave: "locais:ver",            descricao: "Visualizar locais",         modulo: "locais",         acao: "ver" },
    { chave: "locais:criar",          descricao: "Criar local",               modulo: "locais",         acao: "criar" },
    { chave: "locais:editar",         descricao: "Editar local",              modulo: "locais",         acao: "editar" },
    { chave: "locais:remover",        descricao: "Remover local",             modulo: "locais",         acao: "remover" },
    // Usuários
    { chave: "usuarios:ver",          descricao: "Visualizar usuários",       modulo: "usuarios",       acao: "ver" },
    { chave: "usuarios:criar",        descricao: "Criar usuário",             modulo: "usuarios",       acao: "criar" },
    { chave: "usuarios:editar",       descricao: "Editar usuário",            modulo: "usuarios",       acao: "editar" },
    { chave: "usuarios:remover",      descricao: "Remover usuário",           modulo: "usuarios",       acao: "remover" },
    { chave: "usuarios:permissoes",   descricao: "Gerenciar permissões",      modulo: "usuarios",       acao: "permissoes" },
    // Dashboard
    { chave: "dashboard:ver",         descricao: "Visualizar dashboard",      modulo: "dashboard",      acao: "ver" },
  ];

  // Só concedemos os roles padrão para uma chave na hora em que ela é criada
  // pela primeira vez no catálogo (instalação nova, ou permissão nova
  // introduzida por uma atualização de código). Chaves que já existiam não
  // são tocadas de novo aqui — do contrário, toda reinicialização do
  // servidor (todo deploy/`railway up`) desfaria revogações que o owner fez
  // manualmente na matriz de roles (Configurações → Permissões), porque
  // definirRolePermissao() remove a linha de role_permissoes e este seed
  // reinseria só por ela estar "faltando".
  const chavesRecemCriadas = new Set<string>();

  for (const perm of defaultPermissions) {
    const existing = await db.select().from(permissoes).where(eq(permissoes.chave, perm.chave)).limit(1);
    if (existing.length === 0) {
      await db.insert(permissoes).values(perm);
      chavesRecemCriadas.add(perm.chave);
    }
  }

  // Mapa de permissões por role — chaves em sincronia com shared/permissoes.ts
  const rolePermissionMap: Record<string, string[]> = {
    owner: [
      "dashboard:ver",
      "materiais:ver","materiais:criar","materiais:editar","materiais:remover","materiais:importar","materiais:ajustar","materiais_a_chegar:ver",
      "obras:ver","obras:criar","obras:editar","obras:remover",
      "solicitacoes:ver","solicitacoes:criar","solicitacoes:responder","solicitacoes:concluir",
      "movimentacoes:ver",
      "saidas:ver","saidas:criar",
      "relatorios:ver","relatorios:exportar",
      "inventario:ver","inventario:criar","inventario:contar","inventario:processar",
      "especificacoes:ver","especificacoes:editar",
      "importacao:ver","importacao:executar",
      "grds:ver","grds:gerar",
      "registros_entrada:ver",
      "locais:ver","locais:criar","locais:editar","locais:remover",
      "usuarios:ver","usuarios:criar","usuarios:editar","usuarios:remover","usuarios:permissoes",
    ],
    admin: [
      "dashboard:ver",
      "materiais:ver","materiais:criar","materiais:editar","materiais:remover","materiais:importar","materiais:ajustar","materiais_a_chegar:ver",
      "obras:ver","obras:criar","obras:editar","obras:remover",
      "solicitacoes:ver","solicitacoes:criar","solicitacoes:responder","solicitacoes:concluir",
      "movimentacoes:ver",
      "saidas:ver","saidas:criar",
      "relatorios:ver","relatorios:exportar",
      "inventario:ver","inventario:criar","inventario:contar","inventario:processar",
      "especificacoes:ver","especificacoes:editar",
      "importacao:ver","importacao:executar",
      "grds:ver","grds:gerar",
      "registros_entrada:ver",
      "locais:ver","locais:criar","locais:editar","locais:remover",
      "usuarios:ver","usuarios:criar","usuarios:editar","usuarios:permissoes",
    ],
    supervisor: [
      "dashboard:ver",
      "materiais:ver","materiais:criar","materiais:editar","materiais:ajustar","materiais:importar","materiais_a_chegar:ver",
      "obras:ver","obras:criar","obras:editar",
      "solicitacoes:ver","solicitacoes:criar","solicitacoes:responder","solicitacoes:concluir",
      "movimentacoes:ver",
      "saidas:ver","saidas:criar",
      "relatorios:ver","relatorios:exportar",
      "inventario:ver","inventario:criar","inventario:contar","inventario:processar",
      "especificacoes:ver","especificacoes:editar",
      "importacao:ver",
      "grds:ver","grds:gerar",
      "registros_entrada:ver",
    ],
    operator: [
      "dashboard:ver",
      "materiais:ver","materiais:criar","materiais:editar","materiais:ajustar","materiais_a_chegar:ver",
      "obras:ver",
      "solicitacoes:ver","solicitacoes:criar","solicitacoes:responder","solicitacoes:concluir",
      "movimentacoes:ver",
      "saidas:ver","saidas:criar",
      "relatorios:ver","relatorios:exportar",
      "inventario:ver","inventario:criar","inventario:contar","inventario:processar",
      "especificacoes:ver",
      "importacao:ver",
      "grds:ver","grds:gerar",
      "registros_entrada:ver",
    ],
    viewer: [
      "dashboard:ver",
      "materiais:ver","materiais_a_chegar:ver",
      "obras:ver",
      "solicitacoes:ver",
      "movimentacoes:ver",
      "saidas:ver",
      "relatorios:ver","relatorios:exportar",
      "inventario:ver",
      "especificacoes:ver",
      "grds:ver",
      "registros_entrada:ver",
    ],
  };

  for (const [role, perms] of Object.entries(rolePermissionMap)) {
    for (const permKey of perms) {
      // Chave já existia antes deste boot → owner pode ter revogado essa
      // permissão do role de propósito. Não reconceder.
      if (!chavesRecemCriadas.has(permKey)) continue;

      const perm = await db.select().from(permissoes).where(eq(permissoes.chave, permKey)).limit(1);
      if (perm.length > 0) {
        const existing = await db
          .select()
          .from(rolePermissoes)
          .where(and(eq(rolePermissoes.role, role as any), eq(rolePermissoes.permissaoId, perm[0].id)))
          .limit(1);
        if (existing.length === 0) {
          await db.insert(rolePermissoes).values({ role: role as any, permissaoId: perm[0].id });
        }
      }
    }
  }
}
