import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosColunas = [
  `ALTER TABLE solicitacoes_separacao ADD COLUMN observacoes_separacao TEXT NULL`,
];

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS solicitacao_imagens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    solicitacao_id INT NOT NULL,
    nome_arquivo VARCHAR(255) NOT NULL,
    tipo_arquivo VARCHAR(100) NULL,
    tamanho INT NULL,
    conteudo LONGBLOB NOT NULL,
    usuario_nome VARCHAR(100) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT fk_solicitacao_imagens_solicitacao FOREIGN KEY (solicitacao_id) REFERENCES solicitacoes_separacao(id)
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

  console.log("Aplicando tabela nova...");
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
