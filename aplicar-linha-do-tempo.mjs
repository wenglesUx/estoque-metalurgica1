import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosColunas = [
  `ALTER TABLE registros_saida ADD COLUMN material_id INT NULL`,
  `ALTER TABLE registros_entrada ADD COLUMN material_id INT NULL`,
];

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS grd_materiais (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grd_id INT NOT NULL,
    material_id INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT fk_grd_materiais_grd FOREIGN KEY (grd_id) REFERENCES grds_geradas(id),
    CONSTRAINT fk_grd_materiais_material FOREIGN KEY (material_id) REFERENCES materiais(id)
  )`,
  `CREATE TABLE IF NOT EXISTS relatorio_recebimento_materiais (
    id INT AUTO_INCREMENT PRIMARY KEY,
    relatorio_id INT NOT NULL,
    material_id INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT fk_rel_recebimento_materiais_relatorio FOREIGN KEY (relatorio_id) REFERENCES relatorios_recebimento(id),
    CONSTRAINT fk_rel_recebimento_materiais_material FOREIGN KEY (material_id) REFERENCES materiais(id)
  )`,
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

  console.log("Aplicando tabelas novas...");
  for (const sql of comandosTabelas) {
    try {
      await connection.query(sql);
      console.log("OK:", sql.split("\n")[0].trim());
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
