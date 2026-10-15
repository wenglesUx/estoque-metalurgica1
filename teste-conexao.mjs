import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
console.log("Testando conexão com:", url ? url.replace(/:[^:@]+@/, ":****@") : "(vazia!)");

try {
  const connection = await mysql.createConnection(url);
  console.log("✅ Conectou com sucesso!");
  const [rows] = await connection.query("SELECT 1 as ok");
  console.log("✅ Query de teste OK:", rows);
  await connection.end();
} catch (err) {
  console.error("❌ Falhou:", err.code, "-", err.message);
}