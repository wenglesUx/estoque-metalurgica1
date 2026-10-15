import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandos = [
  `ALTER TABLE materiais ADD COLUMN excluir_relatorios TINYINT(1) NOT NULL DEFAULT 0`,
  `ALTER TABLE registros_saida ADD COLUMN excluir_relatorios TINYINT(1) NOT NULL DEFAULT 0`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando coluna de exclusão de relatórios...");

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
