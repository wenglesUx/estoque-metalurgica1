import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosColunas = [
  `ALTER TABLE pedidos_compra_fila_revisao ADD COLUMN possivel_duplicado BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE pedidos_compra_fila_revisao ADD COLUMN duplicado_detalhe TEXT NULL`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando colunas de detecção de duplicidade...");

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
