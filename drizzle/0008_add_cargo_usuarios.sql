-- Migration 0008: Adiciona campo cargo na tabela users
ALTER TABLE users ADD COLUMN cargo VARCHAR(100) NULL DEFAULT NULL;
