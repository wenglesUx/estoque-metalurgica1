import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;

// Parte 1: renomeia chaves de permissão do formato antigo (ponto) pro atual
// (dois-pontos) — seguro rodar mesmo que já estejam no formato novo (WHERE
// não encontra nada, não faz nada).
const comandosRenomear = [
  `UPDATE permissoes SET chave = 'materiais:ver'      WHERE chave = 'material.visualizar'`,
  `UPDATE permissoes SET chave = 'materiais:criar'    WHERE chave = 'material.criar'`,
  `UPDATE permissoes SET chave = 'materiais:editar'   WHERE chave = 'material.editar'`,
  `UPDATE permissoes SET chave = 'materiais:remover'  WHERE chave = 'material.deletar'`,
  `UPDATE permissoes SET chave = 'materiais:ajustar'  WHERE chave = 'material.baixa'`,
  `UPDATE permissoes SET chave = 'obras:ver'          WHERE chave = 'obra.visualizar'`,
  `UPDATE permissoes SET chave = 'obras:criar'        WHERE chave = 'obra.criar'`,
  `UPDATE permissoes SET chave = 'obras:editar'       WHERE chave = 'obra.editar'`,
  `UPDATE permissoes SET chave = 'obras:remover'      WHERE chave = 'obra.deletar'`,
  `UPDATE permissoes SET chave = 'especificacoes:ver'    WHERE chave = 'especificacao.visualizar'`,
  `UPDATE permissoes SET chave = 'especificacoes:editar' WHERE chave IN ('especificacao.criar', 'especificacao.editar', 'especificacao.deletar')`,
  `UPDATE permissoes SET chave = 'solicitacoes:ver'      WHERE chave = 'solicitacao.visualizar'`,
  `UPDATE permissoes SET chave = 'solicitacoes:criar'    WHERE chave = 'solicitacao.criar'`,
  `UPDATE permissoes SET chave = 'solicitacoes:responder' WHERE chave = 'solicitacao.editar'`,
  `UPDATE permissoes SET chave = 'inventario:ver'        WHERE chave = 'inventario.visualizar'`,
  `UPDATE permissoes SET chave = 'inventario:criar'      WHERE chave = 'inventario.criar'`,
  `UPDATE permissoes SET chave = 'inventario:contar'     WHERE chave = 'inventario.editar'`,
  `UPDATE permissoes SET chave = 'relatorios:ver'        WHERE chave = 'relatorio.visualizar'`,
  `UPDATE permissoes SET chave = 'usuarios:ver'          WHERE chave = 'usuario.visualizar'`,
  `UPDATE permissoes SET chave = 'usuarios:criar'        WHERE chave = 'usuario.criar'`,
  `UPDATE permissoes SET chave = 'usuarios:editar'       WHERE chave = 'usuario.editar'`,
  `UPDATE permissoes SET chave = 'usuarios:remover'      WHERE chave = 'usuario.deletar'`,
  `DELETE p1 FROM permissoes p1 INNER JOIN permissoes p2 ON p1.chave = p2.chave AND p1.id > p2.id`,
  `UPDATE permissoes SET descricao = 'Criar plano de corte / excluir solicitação' WHERE chave = 'solicitacoes:criar'`,
];

async function rodar() {
  const connection = await mysql.createConnection(url);
  console.log("Conectado. Aplicando renomeação de chaves de permissão...");

  for (const sql of comandosRenomear) {
    try {
      const [result] = await connection.query(sql);
      console.log("OK:", sql.slice(0, 70), "...", `(${result.affectedRows ?? 0} linha(s))`);
    } catch (err) {
      console.error("Falhou:", err.code || "", "-", err.message, "\n  SQL:", sql);
    }
  }

  console.log("\nVerificando FK antiga em movimentacoes.estoque_id (apontando pra tabela morta 'estoque')...");
  const [fkRows] = await connection.query(`
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'movimentacoes'
      AND COLUMN_NAME = 'estoque_id'
      AND REFERENCED_TABLE_NAME = 'estoque'
    LIMIT 1
  `);

  if (fkRows.length > 0) {
    const nomeFk = fkRows[0].CONSTRAINT_NAME;
    console.log(`Encontrada FK antiga: ${nomeFk} — removendo...`);
    await connection.query(`ALTER TABLE \`movimentacoes\` DROP FOREIGN KEY \`${nomeFk}\``);
    console.log("OK: FK antiga removida.");
  } else {
    console.log("Nenhuma FK antiga encontrada — nada a remover (já estava limpo).");
  }

  console.log("\nValidando: existe alguma movimentação apontando pra material inexistente?");
  const [orfas] = await connection.query(`
    SELECT m.id, m.estoque_id
    FROM movimentacoes m
    LEFT JOIN materiais mat ON mat.id = m.estoque_id
    WHERE mat.id IS NULL
    LIMIT 20
  `);
  if (orfas.length > 0) {
    console.log(`⚠ Atenção: ${orfas.length} movimentação(ões) órfã(s) encontrada(s):`, orfas);
    console.log("NÃO adicionando a nova FK corrigida automaticamente — corrija esses registros primeiro.");
  } else {
    console.log("OK: nenhuma movimentação órfã. Adicionando a FK corrigida (apontando pra materiais)...");
    try {
      await connection.query(`
        ALTER TABLE \`movimentacoes\`
        ADD CONSTRAINT \`movimentacoes_estoque_id_materiais_id_fk\`
        FOREIGN KEY (\`estoque_id\`) REFERENCES \`materiais\`(\`id\`)
        ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
      console.log("OK: nova FK adicionada.");
    } catch (err) {
      if (err.code === "ER_DUP_KEYNAME" || err.code === "ER_FK_DUP_NAME") {
        console.log("FK corrigida já existia, pulando.");
      } else {
        console.error("Falhou ao adicionar FK corrigida:", err.code || "", "-", err.message);
      }
    }
  }

  console.log("\nConcluido.");
  await connection.end();
}

rodar().catch((err) => {
  console.error("Falhou:", err.code || "", "-", err.message);
});
