import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS requisicoes_producao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    numero VARCHAR(100) NOT NULL,
    data_requisicao VARCHAR(10) NOT NULL,
    obra_id INT NULL,
    obra_nome VARCHAR(200) NOT NULL,
    etapa VARCHAR(200) NOT NULL,
    status ENUM('em_separacao','aguardando_aprovacao','aprovada','rejeitada','cancelada') NOT NULL DEFAULT 'em_separacao',
    observacoes TEXT NULL,
    usuario_criacao VARCHAR(100) NOT NULL,
    data_envio TIMESTAMP NULL DEFAULT NULL,
    usuario_aprovacao VARCHAR(100) NULL,
    data_aprovacao TIMESTAMP NULL DEFAULT NULL,
    motivo_rejeicao TEXT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    updatedAt TIMESTAMP NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_req_producao_obra FOREIGN KEY (obra_id) REFERENCES obras(id)
  )`,
  `CREATE TABLE IF NOT EXISTS itens_requisicao_producao (
    id INT AUTO_INCREMENT PRIMARY KEY,
    requisicao_id INT NOT NULL,
    material_id INT NOT NULL,
    quantidade INT NOT NULL,
    usuario_nome VARCHAR(100) NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    updatedAt TIMESTAMP NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_itens_req_producao_req FOREIGN KEY (requisicao_id) REFERENCES requisicoes_producao(id),
    CONSTRAINT fk_itens_req_producao_material FOREIGN KEY (material_id) REFERENCES materiais(id)
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando tabelas de requisição de produção...");

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
