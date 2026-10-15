import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosColunas = [
  `ALTER TABLE materiais ADD COLUMN obra_compra_id INT NULL`,
  `ALTER TABLE materiais ADD COLUMN obra_compra_nome VARCHAR(200) NULL`,
  `ALTER TABLE registros_entrada ADD COLUMN obra_compra_nome VARCHAR(200) NULL`,
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
