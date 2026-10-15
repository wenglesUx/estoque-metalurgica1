-- Migration: 0006_inventario_tables
-- Tabelas de inventário físico (contagem periódica)

CREATE TABLE `inventarios` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `numero` varchar(50) NOT NULL UNIQUE,
  `descricao` varchar(200),
  `data_abertura` timestamp NOT NULL DEFAULT (now()),
  `data_fechamento` timestamp DEFAULT NULL,
  `usuario_abertura` varchar(100) NOT NULL,
  `usuario_fechamento` varchar(100) DEFAULT NULL,
  `status` enum('aberto','em_contagem','fechado','processado') NOT NULL DEFAULT 'aberto',
  `observacoes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE (now())
);

CREATE TABLE `itens_inventario` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `inventario_id` int NOT NULL,
  `material_id` int NOT NULL,
  `quantidade_sistema` decimal(12,2) NOT NULL,
  `quantidade_contada` decimal(12,2) DEFAULT NULL,
  `divergencia` decimal(12,2) DEFAULT NULL,
  `percentual_divergencia` decimal(5,2) DEFAULT NULL,
  `status` enum('pendente','contado','ajustado') NOT NULL DEFAULT 'pendente',
  `observacoes` text,
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE (now()),
  CONSTRAINT `fk_item_inv_inventario` FOREIGN KEY (`inventario_id`) REFERENCES `inventarios`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_inv_material` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE CASCADE
);

CREATE TABLE `ajustes_inventario` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `inventario_id` int NOT NULL,
  `item_inventario_id` int NOT NULL,
  `material_id` int NOT NULL,
  `tipo` enum('entrada','saida') NOT NULL,
  `quantidade` decimal(12,2) NOT NULL,
  `motivo` varchar(200) NOT NULL DEFAULT 'Ajuste por inventário físico',
  `status` enum('pendente','aplicado','cancelado') NOT NULL DEFAULT 'pendente',
  `createdAt` timestamp NOT NULL DEFAULT (now()),
  `updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE (now()),
  CONSTRAINT `fk_aj_inv_inventario` FOREIGN KEY (`inventario_id`) REFERENCES `inventarios`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aj_inv_item` FOREIGN KEY (`item_inventario_id`) REFERENCES `itens_inventario`(`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aj_inv_material` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE CASCADE
);
