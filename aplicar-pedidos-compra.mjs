import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS pedidos_compra (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero_pedido VARCHAR(50) NOT NULL,
    processo_numero VARCHAR(50) NULL,
    obra_nome VARCHAR(300) NULL,
    fornecedor_nome VARCHAR(300) NULL,
    fornecedor_cnpj VARCHAR(30) NULL,
    data_emissao VARCHAR(20) NULL,
    data_entrega_prevista VARCHAR(20) NULL,
    cond_pagamento VARCHAR(100) NULL,
    cotacao VARCHAR(200) NULL,
    valor_total_pedido DECIMAL(12,2) NULL,
    status ENUM('pendente','parcial','recebido','cancelado') NOT NULL DEFAULT 'pendente',
    usuario_nome VARCHAR(100) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    updatedAt TIMESTAMP NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS itens_pedido_compra (
    id INT AUTO_INCREMENT PRIMARY KEY,
    pedido_compra_id INT NOT NULL,
    codigo VARCHAR(50) NULL,
    descricao_original TEXT NULL,
    categoria VARCHAR(20) NULL DEFAULT 'PERFIL',
    tipo VARCHAR(50) NULL,
    bitola VARCHAR(50) NULL,
    aco VARCHAR(50) NULL,
    comprimento INT NULL,
    quantidade_pecas INT NULL,
    unidade VARCHAR(20) NULL,
    peso_total DECIMAL(12,3) NULL,
    valor_unitario DECIMAL(10,2) NULL,
    valor_total_item DECIMAL(12,2) NULL,
    recebido BOOLEAN NOT NULL DEFAULT false,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT fk_itens_pedido_compra_pedido FOREIGN KEY (pedido_compra_id) REFERENCES pedidos_compra(id)
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando tabelas novas...");

  for (const sql of comandosTabelas) {
    try {
      await connection.query(sql);
      console.log("OK:", sql.split("\n")[0].trim());
    } catch (err) {
      console.error("Falhou:", err.code || "", "-", err.message);
    }
  }

  console.log("Concluido.");
  await connection.end();
}

rodar().catch((err) => {
  console.error("Falhou:", err.code || "", "-", err.message);
});
