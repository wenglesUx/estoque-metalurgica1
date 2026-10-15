import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandos = [
  `CREATE TABLE IF NOT EXISTS fornecedores_pedidos_email (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(200) NOT NULL,
    emails TEXT NOT NULL,
    ativo BOOLEAN NOT NULL DEFAULT true,
    createdAt TIMESTAMP NOT NULL DEFAULT (now())
  )`,
  `CREATE TABLE IF NOT EXISTS emails_pedido_processados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gmail_message_id VARCHAR(100) NOT NULL UNIQUE,
    remetente VARCHAR(300) NULL,
    assunto VARCHAR(500) NULL,
    resultado ENUM('fila_revisao','ignorado','erro') NOT NULL,
    detalhes TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now())
  )`,
  `CREATE TABLE IF NOT EXISTS pedidos_compra_fila_revisao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    gmail_message_id VARCHAR(100) NULL,
    remetente VARCHAR(300) NULL,
    nome_arquivo_original VARCHAR(255) NULL,
    dados_extraidos JSON NOT NULL,
    status ENUM('pendente_revisao','confirmado','rejeitado') NOT NULL DEFAULT 'pendente_revisao',
    createdAt TIMESTAMP NOT NULL DEFAULT (now())
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando tabelas de leitura automatica de pedidos...");

  for (const sql of comandos) {
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
