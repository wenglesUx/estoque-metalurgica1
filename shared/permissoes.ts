/**
 * Catálogo central de permissões do sistema.
 * 
 * Convenção: ENTIDADE_ACAO
 * Admins têm todas as permissões implicitamente.
 * Operadores só têm as permissões explicitamente concedidas.
 * 
 * Para adicionar nova permissão: inserir aqui + usar hasPermissao() no backend
 * e usePermissao() no frontend.
 */

export const PERMISSOES = {
  // ── Materiais ────────────────────────────────────────────────────────────
  MATERIAIS_VER:       "materiais:ver",
  MATERIAIS_CRIAR:     "materiais:criar",
  MATERIAIS_EDITAR:    "materiais:editar",
  MATERIAIS_REMOVER:   "materiais:remover",
  MATERIAIS_IMPORTAR:  "materiais:importar",
  MATERIAIS_AJUSTAR:   "materiais:ajustar",   // ajuste manual de saldo
  // Página "Materiais a Chegar" (pedidos de compra em aberto) — chave própria,
  // separada de MATERIAIS_VER, pra poder ser ligada/desligada por role
  // independente do acesso à página principal de Materiais.
  MATERIAIS_A_CHEGAR_VER: "materiais_a_chegar:ver",

  // ── Obras ────────────────────────────────────────────────────────────────
  OBRAS_VER:           "obras:ver",
  OBRAS_CRIAR:         "obras:criar",
  OBRAS_EDITAR:        "obras:editar",
  OBRAS_REMOVER:       "obras:remover",

  // ── Solicitações de separação ─────────────────────────────────────────────
  SOLICITACOES_VER:       "solicitacoes:ver",
  // Apesar do nome, NÃO controla criar uma solicitação (isso é liberado a
  // qualquer operador, sem checagem granular) — protege excluir solicitações
  // e criar planos de corte. Ver server/routers.ts (solicitacoes.deletar,
  // planoCorte.criar).
  SOLICITACOES_CRIAR:     "solicitacoes:criar",
  SOLICITACOES_RESPONDER: "solicitacoes:responder",
  SOLICITACOES_CONCLUIR:  "solicitacoes:concluir",

  // ── Movimentações ─────────────────────────────────────────────────────────
  MOVIMENTACOES_VER:   "movimentacoes:ver",

  // ── Registros de saída ────────────────────────────────────────────────────
  SAIDAS_VER:          "saidas:ver",
  SAIDAS_CRIAR:        "saidas:criar",

  // ── Relatórios ────────────────────────────────────────────────────────────
  RELATORIOS_VER:      "relatorios:ver",
  RELATORIOS_EXPORTAR: "relatorios:exportar",

  // ── Inventário ────────────────────────────────────────────────────────────
  INVENTARIO_VER:         "inventario:ver",
  INVENTARIO_CRIAR:       "inventario:criar",
  INVENTARIO_CONTAR:      "inventario:contar",
  INVENTARIO_PROCESSAR:   "inventario:processar",

  // ── Especificações técnicas ────────────────────────────────────────────────
  ESPECIFICACOES_VER:     "especificacoes:ver",
  ESPECIFICACOES_EDITAR:  "especificacoes:editar",

  // ── Importação ────────────────────────────────────────────────────────────
  IMPORTACAO_VER:      "importacao:ver",
  IMPORTACAO_EXECUTAR: "importacao:executar",

  // ── GRDs geradas ──────────────────────────────────────────────────────────
  GRDS_VER:            "grds:ver",
  GRDS_GERAR:          "grds:gerar",

  // ── Registros de entrada ─────────────────────────────────────────────────
  REGISTROS_ENTRADA_VER: "registros_entrada:ver",

  // ── Locais ────────────────────────────────────────────────────────────────
  LOCAIS_VER:          "locais:ver",
  LOCAIS_CRIAR:        "locais:criar",
  LOCAIS_EDITAR:       "locais:editar",
  LOCAIS_REMOVER:      "locais:remover",

  // ── Usuários (gestão) ─────────────────────────────────────────────────────
  USUARIOS_VER:        "usuarios:ver",
  USUARIOS_CRIAR:      "usuarios:criar",
  USUARIOS_EDITAR:     "usuarios:editar",
  USUARIOS_REMOVER:    "usuarios:remover",
  USUARIOS_PERMISSOES: "usuarios:permissoes",  // gerenciar permissões de outros

  // ── Dashboard ─────────────────────────────────────────────────────────────
  DASHBOARD_VER:       "dashboard:ver",
} as const;

export type Permissao = typeof PERMISSOES[keyof typeof PERMISSOES];

/**
 * Grupos de permissões prontos para atribuição rápida por perfil.
 * Permite criar "templates" de perfis sem bloquear a granularidade.
 */
export const PERFIS: Record<string, Permissao[]> = {
  /** Acesso total — equivale a admin */
  GERENTE: Object.values(PERMISSOES) as Permissao[],

  /** Operador de almoxarifado — controle pleno do estoque */
  ALMOXARIFE: [
    PERMISSOES.DASHBOARD_VER,
    PERMISSOES.MATERIAIS_VER,
    PERMISSOES.MATERIAIS_CRIAR,
    PERMISSOES.MATERIAIS_EDITAR,
    PERMISSOES.MATERIAIS_AJUSTAR,
    PERMISSOES.MATERIAIS_IMPORTAR,
    PERMISSOES.MATERIAIS_A_CHEGAR_VER,
    PERMISSOES.OBRAS_VER,
    PERMISSOES.SOLICITACOES_VER,
    PERMISSOES.SOLICITACOES_RESPONDER,
    PERMISSOES.SOLICITACOES_CONCLUIR,
    PERMISSOES.MOVIMENTACOES_VER,
    PERMISSOES.SAIDAS_VER,
    PERMISSOES.SAIDAS_CRIAR,
    PERMISSOES.INVENTARIO_VER,
    PERMISSOES.INVENTARIO_CRIAR,
    PERMISSOES.INVENTARIO_CONTAR,
    PERMISSOES.INVENTARIO_PROCESSAR,
    PERMISSOES.RELATORIOS_VER,
    PERMISSOES.RELATORIOS_EXPORTAR,
    PERMISSOES.ESPECIFICACOES_VER,
    PERMISSOES.IMPORTACAO_VER,
    PERMISSOES.IMPORTACAO_EXECUTAR,
    PERMISSOES.GRDS_VER,
    PERMISSOES.GRDS_GERAR,
    PERMISSOES.REGISTROS_ENTRADA_VER,
    PERMISSOES.LOCAIS_VER,
  ],

  /** Solicitante — só pode criar e acompanhar pedidos de separação */
  SOLICITANTE: [
    PERMISSOES.DASHBOARD_VER,
    PERMISSOES.MATERIAIS_VER,
    PERMISSOES.MATERIAIS_A_CHEGAR_VER,
    PERMISSOES.OBRAS_VER,
    PERMISSOES.SOLICITACOES_VER,
    PERMISSOES.SOLICITACOES_CRIAR,
    PERMISSOES.MOVIMENTACOES_VER,
  ],

  /** Auditor / dono — só visualização, sem alterações */
  VISUALIZADOR: [
    PERMISSOES.DASHBOARD_VER,
    PERMISSOES.MATERIAIS_VER,
    PERMISSOES.MATERIAIS_A_CHEGAR_VER,
    PERMISSOES.OBRAS_VER,
    PERMISSOES.SOLICITACOES_VER,
    PERMISSOES.MOVIMENTACOES_VER,
    PERMISSOES.SAIDAS_VER,
    PERMISSOES.RELATORIOS_VER,
    PERMISSOES.RELATORIOS_EXPORTAR,
    PERMISSOES.INVENTARIO_VER,
    PERMISSOES.ESPECIFICACOES_VER,
    PERMISSOES.GRDS_VER,
    PERMISSOES.REGISTROS_ENTRADA_VER,
    PERMISSOES.LOCAIS_VER,
  ],
};

export const LISTA_PERMISSOES = Object.values(PERMISSOES) as Permissao[];
