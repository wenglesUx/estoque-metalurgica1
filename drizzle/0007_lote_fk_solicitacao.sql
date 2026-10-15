-- Migration 0007: Adiciona lote_id e comprimento_especifico em itens_solicitacao
ALTER TABLE `itens_solicitacao`
  ADD COLUMN `lote_id` int(11) DEFAULT NULL,
  ADD COLUMN `comprimento_especifico` int(11) DEFAULT NULL,
  ADD CONSTRAINT `itens_solicitacao_lote_id_fk`
    FOREIGN KEY (`lote_id`) REFERENCES `lotes` (`id`) ON DELETE SET NULL;
