import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosColunas = [
  `ALTER TABLE materiais ADD COLUMN grd_gerada BOOLEAN NOT NULL DEFAULT false`,
];

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS grds_geradas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero VARCHAR(50) NOT NULL,
    obra VARCHAR(200) NOT NULL,
    cliente VARCHAR(200) NULL,
    data_grd VARCHAR(20) NULL,
    dados JSON NOT NULL,
    usuario_nome VARCHAR(100) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now())
  )`,
  `CREATE TABLE IF NOT EXISTS grd_certificados (
    id INT AUTO_INCREMENT PRIMARY KEY,
    grd_id INT NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    tipo_arquivo VARCHAR(100) NULL,
    tamanho INT NULL,
    conteudo LONGBLOB NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT fk_grd_certificados_grd FOREIGN KEY (grd_id) REFERENCES grds_geradas(id)
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando coluna nova...");

  for (const sql of comandosColunas) {
    try {
      await connection.query(sql);
      console.log("OK (coluna):", sql);
    } catch (err) {
      if (err.code === "ER_DUP_FIELDNAME") {
        console.log("Coluna ja existe, pulando:", sql);
      } else {
        console.error("Falhou (coluna):", err.code || "", "-", err.message);
      }
    }
  }

  console.log("Aplicando tabelas novas...");
  for (const sql of comandosTabelas) {
    try {
      await connection.query(sql);
      console.log("OK (tabela):", sql.split("\n")[0].trim());
    } catch (err) {
      console.error("Falhou (tabela):", err.code || "", "-", err.message);
    }
  }

  console.log("Concluido.");
  await connection.end();
}

rodar().catch((err) => {
  console.error("Falhou:", err.code || "", "-", err.message);
});
