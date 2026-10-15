import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosColunas = [
  `ALTER TABLE itens_inventario ADD COLUMN justificativa TEXT NULL`,
  `ALTER TABLE itens_inventario ADD COLUMN justificado_em TIMESTAMP NULL`,
  `ALTER TABLE itens_inventario ADD COLUMN justificado_por VARCHAR(100) NULL`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando colunas novas...");

  for (const sql of comandosColunas) {
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
