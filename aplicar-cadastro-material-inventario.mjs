import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

// Cadastro de material feito durante a contagem do inventário — fica pendente
// de análise nesta tabela e só vira material de verdade quando aprovado.
const comandosTabelas = [
  `CREATE TABLE IF NOT EXISTS materiais_pendentes_inventario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    inventario_id INT NOT NULL,
    categoria VARCHAR(20) NOT NULL DEFAULT 'PERFIL',
    tipo VARCHAR(100) NOT NULL,
    bitola VARCHAR(100) NOT NULL,
    aco VARCHAR(50) NOT NULL,
    quantidade INT NOT NULL,
    comprimento INT NOT NULL,
    largura INT NULL,
    local VARCHAR(200) NULL,
    obra_id INT NULL,
    obra_nome VARCHAR(200) NULL,
    fornecedor VARCHAR(200) NULL,
    nf VARCHAR(50) NULL,
    numero_certificado VARCHAR(100) NULL,
    corrida VARCHAR(100) NULL,
    origem TEXT NOT NULL,
    status ENUM('pendente','aprovado','reprovado') NOT NULL DEFAULT 'pendente',
    cadastrado_por VARCHAR(100) NOT NULL,
    analisado_por VARCHAR(100) NULL,
    analisado_em TIMESTAMP NULL DEFAULT NULL,
    parecer TEXT NULL,
    material_id INT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    updatedAt TIMESTAMP NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_mat_pend_inv_inventario FOREIGN KEY (inventario_id) REFERENCES inventarios(id),
    CONSTRAINT fk_mat_pend_inv_obra FOREIGN KEY (obra_id) REFERENCES obras(id),
    CONSTRAINT fk_mat_pend_inv_material FOREIGN KEY (material_id) REFERENCES materiais(id)
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Criando tabela de materiais pendentes do inventário...");

  for (const sql of comandosTabelas) {
    try {
      await connection.query(sql);
      console.log("OK:", sql.split("\n")[0]);
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
