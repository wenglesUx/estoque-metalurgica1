-- Correção segura para produção: movimentacoes.estoque_id armazena o ID do material no código atual.
-- O erro ocorre quando ainda existe uma FK antiga para estoque(id), por exemplo:
-- movimentacoes_estoque_id_estoque_id_fk.
-- Execute este script no banco MySQL/TiDB usado pela aplicação no Railway.

SET @old_fk_name := (
  SELECT CONSTRAINT_NAME
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'movimentacoes'
    AND COLUMN_NAME = 'estoque_id'
    AND REFERENCED_TABLE_NAME = 'estoque'
  LIMIT 1
);

SET @drop_old_fk_sql := IF(
  @old_fk_name IS NULL,
  'SELECT ''FK antiga movimentacoes -> estoque inexistente; nada a remover.'' AS status',
  CONCAT('ALTER TABLE `movimentacoes` DROP FOREIGN KEY `', @old_fk_name, '`')
);

PREPARE drop_old_fk_stmt FROM @drop_old_fk_sql;
EXECUTE drop_old_fk_stmt;
DEALLOCATE PREPARE drop_old_fk_stmt;

-- Validação pós-correção: deve retornar zero linhas.
-- Se retornar linhas, existem movimentações apontando para materiais inexistentes.
SELECT m.id, m.estoque_id
FROM movimentacoes m
LEFT JOIN materiais mat ON mat.id = m.estoque_id
WHERE mat.id IS NULL
LIMIT 20;

-- Opcional, SOMENTE depois de confirmar que a validação acima retorna zero linhas:
-- ALTER TABLE `movimentacoes`
--   ADD CONSTRAINT `movimentacoes_estoque_id_materiais_id_fk`
--   FOREIGN KEY (`estoque_id`) REFERENCES `materiais`(`id`)
--   ON DELETE NO ACTION ON UPDATE NO ACTION;
