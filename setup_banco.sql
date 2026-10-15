-- SCRIPT ORIGINAL DE CRIAÇÃO (SNAKE_CASE) - SISTEMA DE ESTOQUE
-- Use este script apenas se precisar recriar o banco do zero.
-- O código agora é 100% compatível com esta estrutura.

CREATE DATABASE IF NOT EXISTS `estoque_metalurgica`;
USE `estoque_metalurgica`;

-- 1. Criar tabela de usuários (Core)
CREATE TABLE IF NOT EXISTS `users` (
    `id` int AUTO_INCREMENT NOT NULL,
    `openId` varchar(64) NOT NULL,
    `name` text,
    `email` varchar(320),
    `loginMethod` varchar(64),
    `role` enum('operator','admin') NOT NULL DEFAULT 'operator',
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `lastSignedIn` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE (`openId`)
);

-- 2. Criar tabela de especificações de materiais (Banco de Dados Técnico)
CREATE TABLE IF NOT EXISTS `especificacoes_materiais` (
    `id` int AUTO_INCREMENT NOT NULL,
    `tipo` varchar(100) NOT NULL,
    `bitola` varchar(100) NOT NULL,
    `aco` varchar(50) NOT NULL,
    `peso_por_metro` decimal(10,3) NOT NULL,
    `unidade` varchar(20) NOT NULL DEFAULT 'mm',
    `ativo` boolean NOT NULL DEFAULT true,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`)
);

-- 3. Criar tabela de obras
CREATE TABLE IF NOT EXISTS `obras` (
    `id` int AUTO_INCREMENT NOT NULL,
    `nome` varchar(200) NOT NULL,
    `cliente` varchar(200),
    `codigo` varchar(50),
    `status` enum('ativa','concluida','pausada') NOT NULL DEFAULT 'ativa',
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    UNIQUE (`codigo`)
);

-- 4. Criar tabela de materiais (Itens em estoque)
CREATE TABLE IF NOT EXISTS `materiais` (
    `id` int AUTO_INCREMENT NOT NULL,
    `especificacao_id` int,
    `tipo` varchar(100) NOT NULL,
    `bitola` varchar(100) NOT NULL,
    `quantidade` int NOT NULL DEFAULT 1,
    `comprimento` int NOT NULL,
    `peso_total` decimal(12,3) NOT NULL,
    `aco` varchar(50) NOT NULL,
    `obra_id` int,
    `obra_nome` varchar(200),
    `local` varchar(200),
    `ativo` boolean NOT NULL DEFAULT true,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`especificacao_id`) REFERENCES `especificacoes_materiais`(`id`),
    FOREIGN KEY (`obra_id`) REFERENCES `obras`(`id`)
);

-- 5. Criar tabela de lotes
CREATE TABLE IF NOT EXISTS `lotes` (
    `id` int AUTO_INCREMENT NOT NULL,
    `material_id` int NOT NULL,
    `corrida_nota` varchar(100),
    `fornecedor` varchar(200),
    `data_entrada` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `observacoes` text,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`)
);

-- 6. Criar tabela de estoque (saldo atual de materiais)
CREATE TABLE IF NOT EXISTS `estoque` (
    `id` int AUTO_INCREMENT NOT NULL,
    `material_id` int NOT NULL,
    `lote_id` int,
    `obra_id` int,
    `comprimento_barra` int NOT NULL,
    `quantidade` int NOT NULL DEFAULT 0,
    `localizacao_patio` varchar(100),
    `saldo_atual` decimal(12,2) NOT NULL DEFAULT '0',
    `ativo` boolean NOT NULL DEFAULT true,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`),
    FOREIGN KEY (`lote_id`) REFERENCES `lotes`(`id`),
    FOREIGN KEY (`obra_id`) REFERENCES `obras`(`id`)
);

-- 7. Criar tabela de movimentações (LOG IMUTÁVEL)
CREATE TABLE IF NOT EXISTS `movimentacoes` (
    `id` int AUTO_INCREMENT NOT NULL,
    `estoque_id` int NOT NULL,
    `tipo` enum('entrada','saida','retorno_sobra','ajuste') NOT NULL,
    `quantidade` decimal(12,2) NOT NULL,
    `comprimento` decimal(10,2),
    `saldo_anterior` decimal(12,2) NOT NULL,
    `saldo_posterior` decimal(12,2) NOT NULL,
    `referencia_type` varchar(50),
    `referencia_id` int,
    `usuario_id` int NOT NULL,
    `observacao` text,
    `data_hora` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`estoque_id`) REFERENCES `estoque`(`id`),
    FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`)
);

-- 8. Tabelas de Plano de Corte
CREATE TABLE IF NOT EXISTS `planos_corte` (
    `id` int AUTO_INCREMENT NOT NULL,
    `obra_id` int NOT NULL,
    `titulo` varchar(200) NOT NULL,
    `data_emissao` timestamp,
    `operador` varchar(100),
    `arquivo_pdf` varchar(500),
    `status` enum('rascunho','processando','concluido','erro') NOT NULL DEFAULT 'rascunho',
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`obra_id`) REFERENCES `obras`(`id`)
);

CREATE TABLE IF NOT EXISTS `itens_plano` (
    `id` int AUTO_INCREMENT NOT NULL,
    `plano_id` int NOT NULL,
    `estoque_id` int,
    `qtd_barras_usadas` int,
    `comp_consumido` int,
    `comp_sobra` int,
    `pecas_corte` int,
    `sobra_retorna_estoque` boolean DEFAULT false,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`plano_id`) REFERENCES `planos_corte`(`id`),
    FOREIGN KEY (`estoque_id`) REFERENCES `estoque`(`id`)
);

CREATE TABLE IF NOT EXISTS `sobras` (
    `id` int AUTO_INCREMENT NOT NULL,
    `item_plano_id` int,
    `estoque_id` int NOT NULL,
    `comprimento` int NOT NULL,
    `quantidade` int NOT NULL DEFAULT 1,
    `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (`id`),
    FOREIGN KEY (`item_plano_id`) REFERENCES `itens_plano`(`id`),
    FOREIGN KEY (`estoque_id`) REFERENCES `estoque`(`id`)
);
