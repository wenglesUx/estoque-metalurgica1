import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS relatorio_recebimento_imagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    relatorio_id INT NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    tipo_arquivo VARCHAR(100) NULL,
    tamanho INT NULL,
    conteudo LONGBLOB NOT NULL,
    usuario_nome VARCHAR(100) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT fk_relatorio_recebimento_imagens_relatorio FOREIGN KEY (relatorio_id) REFERENCES relatorios_recebimento(id)
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando tabela nova...");

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
