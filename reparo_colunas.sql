-- SCRIPT DE REPARO DE COLUNAS - SISTEMA DE ESTOQUE
-- Execute este script para alinhar os nomes das colunas do banco com o código novo.

USE `estoque_metalurgica`;

-- Ajustar Tabela Materiais
ALTER TABLE `materiais` 
CHANGE COLUMN `especificacao_id` `especificacaoId` int,
CHANGE COLUMN `peso_total` `pesoTotal` decimal(12,3) NOT NULL,
CHANGE COLUMN `obra_id` `obraId` int,
CHANGE COLUMN `obra_nome` `obraNome` varchar(200);

-- Ajustar Tabela Estoque
ALTER TABLE `estoque`
CHANGE COLUMN `material_id` `materialId` int NOT NULL,
CHANGE COLUMN `lote_id` `loteId` int,
CHANGE COLUMN `obra_id` `obraId` int,
CHANGE COLUMN `comprimento_barra` `comprimentoBarra` int NOT NULL,
CHANGE COLUMN `localizacao_patio` `localizacaoPatio` varchar(100),
CHANGE COLUMN `saldo_atual` `saldoAtual` decimal(12,2) NOT NULL DEFAULT '0';

-- Ajustar Tabela Movimentacoes
ALTER TABLE `movimentacoes`
CHANGE COLUMN `estoque_id` `estoqueId` int NOT NULL,
CHANGE COLUMN `saldo_anterior` `saldoAnterior` decimal(12,2) NOT NULL,
CHANGE COLUMN `saldo_posterior` `saldoPosterior` decimal(12,2) NOT NULL,
CHANGE COLUMN `referencia_type` `referenciaType` varchar(50),
CHANGE COLUMN `referencia_id` `referenciaId` int,
CHANGE COLUMN `usuario_id` `usuarioId` int NOT NULL,
CHANGE COLUMN `data_hora` `dataHora` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Ajustar Tabela Obras
ALTER TABLE `obras`
CHANGE COLUMN `createdAt` `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
CHANGE COLUMN `updatedAt` `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP;

-- Ajustar Tabela Especificações
ALTER TABLE `especificacoes_materiais`
CHANGE COLUMN `peso_por_metro` `pesoPorMetro` decimal(10,3) NOT NULL;
