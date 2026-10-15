import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandos = [
  `ALTER TABLE especificacoes_materiais ADD COLUMN estoque_minimo DECIMAL(12,2) NOT NULL DEFAULT 0.00`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando coluna nova...");

  for (const sql of comandos) {
    try {
      await connection.query(sql);
      console.log("OK:", sql);
    } catch (err) {
      if (err.code === "ER_DUP_FIELDNAME") {
        console.log("Coluna ja existe, pulando:", sql);
      } else {
        console.error("Falhou:", err.code || "", "-", err.message);
      }
    }
  }

  console.log("Concluido.");
  await connection.end();
}

rodar().catch((err) => {
  console.error("Falhou:", err.code || "", "-", err.message);
});