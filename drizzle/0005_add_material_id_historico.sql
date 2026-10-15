ALTER TABLE `historico_atividades` ADD COLUMN `material_id` INT NULL;
ALTER TABLE `historico_atividades` ADD CONSTRAINT `fk_material_id` FOREIGN KEY (`material_id`) REFERENCES `materiais`(`id`) ON DELETE SET NULL;
