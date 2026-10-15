import mysql from "mysql2/promise";

// IMPORTANTE: rode este script só depois de confirmar que $env:DATABASE_URL
// aponta pra URL certa (local ou produção, conforme sua intenção nesse momento).
const url = process.env.DATABASE_URL;

const sql = `
CREATE TABLE IF NOT EXISTS locais_estoque (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nome VARCHAR(100) NOT NULL UNIQUE,
  ativo BOOLEAN NOT NULL DEFAULT true,
  createdAt TIMESTAMP NOT NULL DEFAULT (now())
);
`;

try {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Criando tabela locais_estoque (se não existir)...");
  await connection.query(sql);
  console.log("✅ Tabela locais_estoque pronta.");
  await connection.end();
} catch (err) {
  console.error("❌ Falhou:", err.code || "", "-", err.message);
}