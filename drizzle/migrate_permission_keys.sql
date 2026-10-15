-- =============================================================================
-- MIGRAÇÃO: Atualiza chaves de permissão do formato antigo para o novo padrão
-- Antigo: "entidade.acao"  →  Novo: "entidade:acao"
-- Execute uma única vez no banco de dados de produção/dev
-- =============================================================================

-- Materiais
UPDATE permissoes SET chave = 'materiais:ver'      WHERE chave = 'material.visualizar';
UPDATE permissoes SET chave = 'materiais:criar'    WHERE chave = 'material.criar';
UPDATE permissoes SET chave = 'materiais:editar'   WHERE chave = 'material.editar';
UPDATE permissoes SET chave = 'materiais:remover'  WHERE chave = 'material.deletar';
UPDATE permissoes SET chave = 'materiais:ajustar'  WHERE chave = 'material.baixa';

-- Obras
UPDATE permissoes SET chave = 'obras:ver'          WHERE chave = 'obra.visualizar';
UPDATE permissoes SET chave = 'obras:criar'        WHERE chave = 'obra.criar';
UPDATE permissoes SET chave = 'obras:editar'       WHERE chave = 'obra.editar';
UPDATE permissoes SET chave = 'obras:remover'      WHERE chave = 'obra.deletar';

-- Especificações
UPDATE permissoes SET chave = 'especificacoes:ver'    WHERE chave = 'especificacao.visualizar';
UPDATE permissoes SET chave = 'especificacoes:editar' WHERE chave IN ('especificacao.criar', 'especificacao.editar', 'especificacao.deletar');

-- Solicitações
UPDATE permissoes SET chave = 'solicitacoes:ver'      WHERE chave = 'solicitacao.visualizar';
UPDATE permissoes SET chave = 'solicitacoes:criar'    WHERE chave = 'solicitacao.criar';
UPDATE permissoes SET chave = 'solicitacoes:responder' WHERE chave = 'solicitacao.editar';
-- concluir não existia antes — será inserido pelo initializeDefaultPermissions

-- Inventário
UPDATE permissoes SET chave = 'inventario:ver'        WHERE chave = 'inventario.visualizar';
UPDATE permissoes SET chave = 'inventario:criar'      WHERE chave = 'inventario.criar';
UPDATE permissoes SET chave = 'inventario:contar'     WHERE chave = 'inventario.editar';
-- processar não existia antes — será inserido pelo initializeDefaultPermissions

-- Relatórios
UPDATE permissoes SET chave = 'relatorios:ver'        WHERE chave = 'relatorio.visualizar';

-- Usuários
UPDATE permissoes SET chave = 'usuarios:ver'          WHERE chave = 'usuario.visualizar';
UPDATE permissoes SET chave = 'usuarios:criar'        WHERE chave = 'usuario.criar';
UPDATE permissoes SET chave = 'usuarios:editar'       WHERE chave = 'usuario.editar';
UPDATE permissoes SET chave = 'usuarios:remover'      WHERE chave = 'usuario.deletar';

-- Remove entradas duplicadas que possam ter ficado (especificacoes:editar duplicada)
DELETE p1 FROM permissoes p1
INNER JOIN permissoes p2
ON p1.chave = p2.chave AND p1.id > p2.id;
