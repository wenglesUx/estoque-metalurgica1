CREATE TABLE `ajustes_inventario` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inventario_id` int NOT NULL,
	`item_inventario_id` int NOT NULL,
	`material_id` int NOT NULL,
	`tipo` enum('entrada','saida') NOT NULL,
	`quantidade` decimal(12,2) NOT NULL,
	`motivo` varchar(200) NOT NULL DEFAULT 'Ajuste por inventário físico',
	`status` enum('pendente','aplicado','cancelado') NOT NULL DEFAULT 'pendente',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ajustes_inventario_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `historico_atividades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`usuario_nome` varchar(100) NOT NULL DEFAULT 'Sistema',
	`acao` varchar(50) NOT NULL,
	`entidade` varchar(50) NOT NULL,
	`material_id` int,
	`detalhes` text NOT NULL,
	`data_hora` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `historico_atividades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `inventarios` (
	`id` int AUTO_INCREMENT NOT NULL,
	`numero` varchar(50) NOT NULL,
	`descricao` varchar(200),
	`data_abertura` timestamp NOT NULL DEFAULT (now()),
	`data_fechamento` timestamp DEFAULT null,
	`usuario_abertura` varchar(100) NOT NULL,
	`usuario_fechamento` varchar(100) DEFAULT null,
	`status` enum('aberto','em_contagem','fechado','processado') NOT NULL DEFAULT 'aberto',
	`observacoes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `inventarios_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventarios_numero_unique` UNIQUE(`numero`)
);
--> statement-breakpoint
CREATE TABLE `itens_inventario` (
	`id` int AUTO_INCREMENT NOT NULL,
	`inventario_id` int NOT NULL,
	`material_id` int NOT NULL,
	`quantidade_sistema` decimal(12,2) NOT NULL,
	`quantidade_contada` decimal(12,2) DEFAULT null,
	`divergencia` decimal(12,2) DEFAULT null,
	`percentual_divergencia` decimal(5,2) DEFAULT null,
	`status` enum('pendente','contado','ajustado') NOT NULL DEFAULT 'pendente',
	`observacoes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `itens_inventario_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `itens_solicitacao` (
	`id` int AUTO_INCREMENT NOT NULL,
	`solicitacao_id` int NOT NULL,
	`material_id` int NOT NULL,
	`quantidade_solicitada` int NOT NULL,
	`lote_id` int,
	`comprimento_especifico` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `itens_solicitacao_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `locais_estoque` (
	`id` int AUTO_INCREMENT NOT NULL,
	`nome` varchar(100) NOT NULL,
	`ativo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `locais_estoque_id` PRIMARY KEY(`id`),
	CONSTRAINT `locais_estoque_nome_unique` UNIQUE(`nome`)
);
--> statement-breakpoint
CREATE TABLE `permissoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`chave` varchar(100) NOT NULL,
	`descricao` varchar(200) NOT NULL,
	`modulo` varchar(50) NOT NULL,
	`acao` varchar(50) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `permissoes_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissoes_chave_unique` UNIQUE(`chave`)
);
--> statement-breakpoint
CREATE TABLE `registros_saida` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tipo` varchar(100) NOT NULL,
	`bitola` varchar(100) NOT NULL,
	`quantidade` int NOT NULL,
	`comprimento` int NOT NULL,
	`peso_total` decimal(12,3) NOT NULL,
	`aco` varchar(50) NOT NULL,
	`obra_nome` varchar(200),
	`local` varchar(200),
	`fornecedor` varchar(200),
	`nf` varchar(50),
	`numero_certificado` varchar(100),
	`corrida` varchar(100),
	`data_saida` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `registros_saida_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `role_permissoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`role` enum('owner','admin','supervisor','operator','viewer') NOT NULL,
	`permissao_id` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `role_permissoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `solicitacoes_separacao` (
	`id` int AUTO_INCREMENT NOT NULL,
	`usuario_solicitante` varchar(100) NOT NULL DEFAULT 'Sistema',
	`observacao_solicitante` text,
	`observacao_resposta` text,
	`obra_destino_id` int,
	`data_limite` timestamp DEFAULT null,
	`status` enum('pendente','em_separacao','concluido','cancelado') NOT NULL DEFAULT 'pendente',
	`data_solicitacao` timestamp NOT NULL DEFAULT (now()),
	`data_conclusao` timestamp DEFAULT null,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `solicitacoes_separacao_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usuario_permissoes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`usuario_id` int NOT NULL,
	`permissao_id` int NOT NULL,
	`permitido` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `usuario_permissoes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `movimentacoes` DROP FOREIGN KEY `movimentacoes_estoque_id_estoque_id_fk`;
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `role` enum('owner','admin','supervisor','operator','viewer') NOT NULL DEFAULT 'operator';--> statement-breakpoint
ALTER TABLE `especificacoes_materiais` ADD `categoria` varchar(20) DEFAULT 'PERFIL' NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `fornecedor` varchar(200);--> statement-breakpoint
ALTER TABLE `materiais` ADD `nf` varchar(50);--> statement-breakpoint
ALTER TABLE `materiais` ADD `numero_certificado` varchar(100);--> statement-breakpoint
ALTER TABLE `materiais` ADD `corrida` varchar(100);--> statement-breakpoint
ALTER TABLE `materiais` ADD `etiqueta_impressa` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `data_impressao_etiqueta` timestamp;--> statement-breakpoint
ALTER TABLE `materiais` ADD `status_solicitacao` varchar(50);--> statement-breakpoint
ALTER TABLE `materiais` ADD `categoria` varchar(20) DEFAULT 'PERFIL' NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `largura` int;--> statement-breakpoint
ALTER TABLE `materiais` ADD `estoque_minimo` decimal(10,2) DEFAULT '50.00' NOT NULL;--> statement-breakpoint
ALTER TABLE `obras` ADD `localizacao` varchar(500);--> statement-breakpoint
ALTER TABLE `obras` ADD `logo_url` varchar(500);--> statement-breakpoint
ALTER TABLE `users` ADD `password_hash` varchar(255);--> statement-breakpoint
ALTER TABLE `users` ADD `cargo` varchar(100);--> statement-breakpoint
ALTER TABLE `users` ADD `ativo` boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `ajustes_inventario` ADD CONSTRAINT `ajustes_inventario_inventario_id_inventarios_id_fk` FOREIGN KEY (`inventario_id`) REFERENCES `inventarios`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ajustes_inventario` ADD CONSTRAINT `ajustes_inventario_item_inventario_id_itens_inventario_id_fk` FOREIGN KEY (`item_inventario_id`) REFERENCES `itens_inventario`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ajustes_inventario` ADD CONSTRAINT `ajustes_inventario_material_id_materiais_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `historico_atividades` ADD CONSTRAINT `historico_atividades_material_id_materiais_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_inventario` ADD CONSTRAINT `itens_inventario_inventario_id_inventarios_id_fk` FOREIGN KEY (`inventario_id`) REFERENCES `inventarios`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_inventario` ADD CONSTRAINT `itens_inventario_material_id_materiais_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_solicitacao` ADD CONSTRAINT `itens_solicitacao_solicitacao_id_solicitacoes_separacao_id_fk` FOREIGN KEY (`solicitacao_id`) REFERENCES `solicitacoes_separacao`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_solicitacao` ADD CONSTRAINT `itens_solicitacao_material_id_materiais_id_fk` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `itens_solicitacao` ADD CONSTRAINT `itens_solicitacao_lote_id_lotes_id_fk` FOREIGN KEY (`lote_id`) REFERENCES `lotes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissoes` ADD CONSTRAINT `role_permissoes_permissao_id_permissoes_id_fk` FOREIGN KEY (`permissao_id`) REFERENCES `permissoes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `solicitacoes_separacao` ADD CONSTRAINT `solicitacoes_separacao_obra_destino_id_obras_id_fk` FOREIGN KEY (`obra_destino_id`) REFERENCES `obras`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `usuario_permissoes` ADD CONSTRAINT `usuario_permissoes_usuario_id_users_id_fk` FOREIGN KEY (`usuario_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `usuario_permissoes` ADD CONSTRAINT `usuario_permissoes_permissao_id_permissoes_id_fk` FOREIGN KEY (`permissao_id`) REFERENCES `permissoes`(`id`) ON DELETE no action ON UPDATE no action;