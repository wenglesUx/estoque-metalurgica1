import "dotenv/config";
import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Verificando duplicatas existentes antes de travar a coluna...");

  // Antes de aplicar a restrição, verifica se já existem números duplicados
  // no banco (como os que apareceram na tela) — se existirem, a migration
  // avisa quais são, sem quebrar, pra você decidir manualmente o que fazer
  // com eles (renumerar via a opção "editar número" na tela de GRDs).
  const [duplicatas] = await connection.query(`
    SELECT numero, COUNT(*) as qtd FROM grds_geradas GROUP BY numero HAVING qtd > 1
  `);

  if (duplicatas.length > 0) {
    console.log("\n⚠️  ATENÇÃO: números duplicados encontrados, a restrição NÃO pôde ser aplicada ainda:");
    for (const d of duplicatas) {
      console.log(`   - Número "${d.numero}" aparece ${d.qtd} vezes`);
    }
    console.log("\nAntes de rodar essa migration de novo, renumere as GRDs duplicadas");
    console.log("(tela de GRDs Geradas → ícone de lápis ao lado do número), deixando");
    console.log("só uma com cada número. Depois rode esse script de novo.");
    await connection.end();
    return;
  }

  try {
    await connection.query(`ALTER TABLE grds_geradas ADD CONSTRAINT grds_geradas_numero_unique UNIQUE (numero)`);
    console.log("OK: restrição de unicidade aplicada — números repetidos não são mais possíveis.");
  } catch (err) {
    if (err.code === "ER_DUP_KEYNAME") {
      console.log("Restrição já existia, nada a fazer.");
    } else {
      console.error("Falhou:", err.code || "", "-", err.message);
    }
  }

  console.log("Concluido.");
  await connection.end();
}

rodar().catch((err) => {
  console.error("Falhou:", err.code || "", "-", err.message);
});
