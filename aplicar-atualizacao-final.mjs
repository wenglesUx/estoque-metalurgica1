import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS registros_entrada (
    id INT AUTO_INCREMENT PRIMARY KEY,
    tipo VARCHAR(100) NOT NULL,
    bitola VARCHAR(100) NOT NULL,
    quantidade INT NOT NULL,
    comprimento INT NOT NULL,
    largura INT NULL,
    categoria VARCHAR(20) NULL,
    peso_total DECIMAL(12,3) NOT NULL,
    aco VARCHAR(50) NOT NULL,
    obra_nome VARCHAR(200) NULL,
    local VARCHAR(200) NULL,
    fornecedor VARCHAR(200) NULL,
    nf VARCHAR(50) NULL,
    numero_certificado VARCHAR(100) NULL,
    corrida VARCHAR(100) NULL,
    numero_pedido VARCHAR(100) NULL,
    usuario_nome VARCHAR(100) NULL,
    data_entrada TIMESTAMP NOT NULL DEFAULT (now()),
    createdAt TIMESTAMP NOT NULL DEFAULT (now())
  )`,
  `CREATE TABLE IF NOT EXISTS relatorios_recebimento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    dados JSON NOT NULL,
    usuario_nome VARCHAR(100) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now())
  )`,
];

const comandosColunas = [
  `ALTER TABLE registros_saida ADD COLUMN motivo VARCHAR(300) NULL`,
  `ALTER TABLE registros_saida ADD COLUMN numero_pedido VARCHAR(100) NULL`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando tabelas novas...");

  for (const sql of comandosTabelas) {
    try {
      await connection.query(sql);
      console.log("OK (tabela):", sql.split("\n")[0].trim());
    } catch (err) {
      console.error("Falhou (tabela):", err.code || "", "-", err.message);
    }
  }

  console.log("Aplicando colunas novas...");
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

  console.log("Concluido.");
  await connection.end();
}

rodar().catch((err) => {
  console.error("Falhou:", err.code || "", "-", err.message);
});
