import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandos = [
  `ALTER TABLE itens_inventario MODIFY COLUMN percentual_divergencia DECIMAL(8,2) NULL`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Alargando coluna percentual_divergencia...");

  for (const sql of comandos) {
    try {
      await connection.query(sql);
      console.log("OK:", sql);
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
