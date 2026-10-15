CREATE TABLE `estoque` (
	`id` int AUTO_INCREMENT NOT NULL,
	`material_id` int NOT NULL,
	`lote_id` int,
	`obra_id` int,
	`comprimento_barra` int NOT NULL,
	`quantidade` int NOT NULL DEFAULT 0,
	`localizacao_patio` varchar(100),
	`saldo_atual` decimal(12,2) NOT NULL DEFAULT '0',
	`ativo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `estoque_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `itens_plano` (
	`id` int AUTO_INCREMENT NOT NULL,
	`plano_id` int NOT NULL,
	`estoque_id` int,
	`qtd_barras_usadas` int,
	`comp_consumido` int,
	`comp_sobra` int,
	`pecas_corte` int,
	`sobra_retorna_estoque` boolean DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `itens_plano_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `lotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`material_id` int NOT NULL,
	`corrida_nota` varchar(100),
	`fornecedor` varchar(200),
	`data_entrada` timestamp NOT NULL DEFAULT (now()),
	`observacoes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `lotes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `materiais` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tipo` varchar(100) NOT NULL,
	`bitola` varchar(50) NOT NULL,
	`comprimento_padrao` int NOT NULL,
	`peso_linear` decimal(10,3) NOT NULL,
	`unidade` varchar(20) NOT NULL DEFAULT 'mm',
	`ativo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `materiais_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `movimentacoes` (
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
	`data_hora` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `movimentacoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `obras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(200) NOT NULL,
	`cliente` varchar(200),
	`codigo` varchar(50),
	`status` enum('ativa','concluida','pausada') NOT NULL DEFAULT 'ativa',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `obras_id` PRIMARY KEY(`id`),
	CONSTRAINT `obras_codigo_unique` UNIQUE(`codigo`)
);
--> statement-breakpoint
CREATE TABLE `planos_corte` (
	`id` int AUTO_INCREMENT NOT NULL,
	`obra_id` int NOT NULL,
	`titulo` varchar(200) NOT NULL,
	`data_emissao` timestamp,
	`operador` varchar(100),
	`arquivo_pdf` varchar(500),
	`status` enum('rascunho','processando','concluido','erro') NOT NULL DEFAULT 'rascunho',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `planos_corte_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `sobras` (
	`id` int AUTO_INCREMENT NOT NULL,
	`item_plano_id` int,
	`estoque_id` int NOT NULL,
	`comprimento` int NOT NULL,
	`quantidade` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sobras_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `estoque` ADD CONSTRAINT `estoque_material_id_materiais_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `estoque` ADD CONSTRAINT `estoque_lote_id_lotes_id_fk` FOREIGN KEY (`lote_id`) REFERENCES `lotes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `estoque` ADD CONSTRAINT `estoque_obra_id_obras_id_fk` FOREIGN KEY (`obra_id`) REFERENCES `obras`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_plano` ADD CONSTRAINT `itens_plano_plano_id_planos_corte_id_fk` FOREIGN KEY (`plano_id`) REFERENCES `planos_corte`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_plano` ADD CONSTRAINT `itens_plano_estoque_id_estoque_id_fk` FOREIGN KEY (`estoque_id`) REFERENCES `estoque`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `lotes` ADD CONSTRAINT `lotes_material_id_materiais_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `movimentacoes` ADD CONSTRAINT `movimentacoes_estoque_id_estoque_id_fk` FOREIGN KEY (`estoque_id`) REFERENCES `estoque`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `movimentacoes` ADD CONSTRAINT `movimentacoes_usuario_id_users_id_fk` FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `planos_corte` ADD CONSTRAINT `planos_corte_obra_id_obras_id_fk` FOREIGN KEY (`obra_id`) REFERENCES `obras`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sobras` ADD CONSTRAINT `sobras_item_plano_id_itens_plano_id_fk` FOREIGN KEY (`item_plano_id`) REFERENCES `itens_plano`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `sobras` ADD CONSTRAINT `sobras_estoque_id_estoque_id_fk` FOREIGN KEY (`estoque_id`) REFERENCES `estoque`(`id`) ON DELETE no action ON UPDATE no action;