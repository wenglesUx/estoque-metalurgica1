CREATE TABLE `especificacoes_materiais` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tipo` varchar(100) NOT NULL,
	`bitola` varchar(100) NOT NULL,
	`aco` varchar(50) NOT NULL,
	`peso_por_metro` decimal(10,3) NOT NULL,
	`unidade` varchar(20) NOT NULL DEFAULT 'mm',
	`ativo` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `especificacoes_materiais_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `materiais` MODIFY COLUMN `bitola` varchar(100) NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `especificacao_id` int;--> statement-breakpoint
ALTER TABLE `materiais` ADD `quantidade` int DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `comprimento` int NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `peso_total` decimal(12,3) NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `aco` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `materiais` ADD `obra_id` int;--> statement-breakpoint
ALTER TABLE `materiais` ADD `obra_nome` varchar(200);--> statement-breakpoint
ALTER TABLE `materiais` ADD `local` varchar(200);--> statement-breakpoint
ALTER TABLE `materiais` ADD CONSTRAINT `materiais_especificacao_id_especificacoes_materiais_id_fk` FOREIGN KEY (`especificacao_id`) REFERENCES `especificacoes_materiais`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `materiais` ADD CONSTRAINT `materiais_obra_id_obras_id_fk` FOREIGN KEY (`obra_id`) REFERENCES `obras`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `materiais` DROP COLUMN `comprimento_padrao`;--> statement-breakpoint
ALTER TABLE `materiais` DROP COLUMN `peso_linear`;--> statement-breakpoint
ALTER TABLE `materiais` DROP COLUMN `unidade`;