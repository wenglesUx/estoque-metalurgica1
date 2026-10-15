import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandos = [
  "ALTER TABLE materiais ADD COLUMN observacoes_material TEXT NULL",
  "ALTER TABLE materiais ADD COLUMN numero_pedido VARCHAR(100) NULL",
];

try {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando colunas novas em materiais...");
  for (const sql of comandos) {
    try {
      await connection.query(sql);
      console.log("OK:", sql);
    } catch (err) {
      if (err.code === "ER_DUP_FIELDNAME") {
        console.log("Coluna ja existe, pulando:", sql);
      } else {
        throw err;
      }
    }
  }
  console.log("Concluido.");
  await connection.end();
} catch (err) {
  console.error("Falhou:", err.code || "", "-", err.message);
}