/**
 * seed-master.ts
 * Cria (ou atualiza) um usuário master com role "owner" diretamente no banco.
 *
 * USO:
 *   npx tsx seed-master.ts
 *
 * Edite as variáveis abaixo antes de rodar se quiser outro e-mail/senha.
 */

import "dotenv/config";
import { createHash, randomBytes } from "crypto";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { sql } from "drizzle-orm";

// ─── Configurações do usuário master ─────────────────────────────────────────
const MASTER_NAME     = "Master";
const MASTER_EMAIL    = "master@sistema.local";
const MASTER_PASSWORD = "Master@123";
const MASTER_ROLE     = "owner";
// ─────────────────────────────────────────────────────────────────────────────

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

function nanoid(size = 21): string {
  return randomBytes(size).toString("base64url").slice(0, size);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("❌  DATABASE_URL não definida no .env");
    process.exit(1);
  }

  const connection = await mysql.createConnection(databaseUrl);
  const db = drizzle(connection);

  try {
    // Verifica se já existe
    const existing = await db.execute(
      sql`SELECT id, email, role FROM users WHERE email = ${MASTER_EMAIL} LIMIT 1`
    );

    const rows = (existing as any)[0] as any[];

    if (rows.length > 0) {
      // Atualiza senha e role para garantir acesso total
      const passwordHash = hashPassword(MASTER_PASSWORD);
      await db.execute(sql`
        UPDATE users
        SET password_hash = ${passwordHash},
            role          = ${MASTER_ROLE},
            ativo         = 1
        WHERE email = ${MASTER_EMAIL}
      `);
      console.log(`✅  Usuário master atualizado com sucesso.`);
    } else {
      // Cria do zero
      const passwordHash = hashPassword(MASTER_PASSWORD);
      const openId = `local_${nanoid(21)}`;
      await db.execute(sql`
        INSERT INTO users (openId, name, email, password_hash, loginMethod, role, ativo)
        VALUES (${openId}, ${MASTER_NAME}, ${MASTER_EMAIL}, ${passwordHash}, 'local', ${MASTER_ROLE}, 1)
      `);
      console.log(`✅  Usuário master criado com sucesso.`);
    }

    console.log("");
    console.log("   E-mail : " + MASTER_EMAIL);
    console.log("   Senha  : " + MASTER_PASSWORD);
    console.log("   Role   : " + MASTER_ROLE);
    console.log("");
    console.log("⚠️   Troque a senha depois do primeiro login!");
  } finally {
    await connection.end();
  }
}

main().catch((err) => {
  console.error("❌  Erro ao executar seed:", err.message);
  process.exit(1);
});
