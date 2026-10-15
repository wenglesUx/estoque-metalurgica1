-- Script para adicionar rastreio de etiquetas à tabela materiais
ALTER TABLE materiais ADD COLUMN etiqueta_impressa TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE materiais ADD COLUMN data_impressao_etiqueta TIMESTAMP NULL DEFAULT NULL;
