import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

const comandos = [
  `ALTER TABLE itens_pedido_compra ADD COLUMN quantidade_recebida INT NOT NULL DEFAULT 0`,
  `ALTER TABLE itens_pedido_compra ADD COLUMN status_item ENUM('pendente','parcial','completo') NOT NULL DEFAULT 'pendente'`,
  `ALTER TABLE itens_pedido_compra ADD COLUMN justificativa_divergencia TEXT NULL`,
  `ALTER TABLE itens_pedido_compra ADD COLUMN encerrado_manualmente BOOLEAN NOT NULL DEFAULT false`,
  // Migra os dados do campo antigo "recebido" (se existir) pro novo modelo,
  // antes de remover a coluna — assim nenhum item que já estava marcado
  // como recebido perde essa informação.
  `UPDATE itens_pedido_compra SET status_item = 'completo', quantidade_recebida = quantidade_pecas WHERE recebido = true`,
  `ALTER TABLE itens_pedido_compra DROP COLUMN recebido`,
  `CREATE TABLE IF NOT EXISTS entregas_item_pedido_compra (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_pedido_compra_id INT NOT NULL,
    material_id INT NULL,
    quantidade INT NOT NULL,
    createdAt TIMESTAMP NOT NULL DEFAULT (now()),
    CONSTRAINT entregas_item_pedido_fk FOREIGN KEY (item_pedido_compra_id) REFERENCES itens_pedido_compra(id)
  )`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando mudanças de validação de pedidos de compra...");

  for (const sql of comandos) {
    try {
      await connection.query(sql);
      console.log("OK:", sql.split("\n")[0].trim());
    } catch (err) {
      if (err.code === "ER_DUP_FIELDNAME") {
        console.log("Coluna ja existe, pulando:", sql.split("\n")[0].trim());
      } else if (err.code === "ER_CANT_DROP_FIELD_OR_KEY") {
        console.log("Coluna 'recebido' ja nao existe, pulando remocao.");
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
