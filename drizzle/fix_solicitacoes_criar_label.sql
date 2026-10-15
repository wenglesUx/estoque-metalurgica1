-- =============================================================================
-- Corrige o rótulo de "solicitacoes:criar" — o nome sempre foi enganoso: essa
-- chave nunca protegeu a criação de uma solicitação (solicitacoes.criar usa só
-- operatorProcedure); na prática ela protege planoCorte.criar e
-- solicitacoes.deletar. Ver server/routers.ts e shared/permissoes.ts.
-- Execute uma única vez (mesmo padrão do migrate_permission_keys.sql).
-- =============================================================================

UPDATE permissoes
SET descricao = 'Criar plano de corte / excluir solicitação'
WHERE chave = 'solicitacoes:criar';
