import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
console.log("Testando conexão (com SSL) com:", url ? url.replace(/:[^:@]+@/, ":****@") : "(vazia!)");

try {
  const connection = await mysql.createConnection({
    uri: url,
    ssl: { rejectUnauthorized: false },
  });
  console.log("✅ Conectou com sucesso (SSL)!");
  const [rows] = await connection.query("SELECT 1 as ok");
  console.log("✅ Query de teste OK:", rows);
  await connection.end();
} catch (err) {
  console.error("❌ Falhou (SSL):", err.code, "-", err.message);
}