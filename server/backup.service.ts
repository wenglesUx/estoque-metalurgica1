import mysql from "mysql2/promise";
import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Backup do banco de dados — gerado 100% em JavaScript, sem depender do
 * programa `mysqldump` estar instalado no ambiente da Railway (já tivemos
 * dor de cabeça demais com dependências externas nesse projeto — Python,
 * pip — pra repetir o mesmo problema aqui). O resultado é um arquivo .sql
 * padrão, restaurável com qualquer cliente MySQL, sem nenhuma dependência
 * própria do sistema.
 */

interface ResultadoBackup {
  ok: boolean;
  arquivo?: string;
  tamanhoBytes?: number;
  erro?: string;
}

/** Gera o dump completo do banco (schema + dados) como uma string .sql. */
async function gerarDumpSql(): Promise<string> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL não configurada.");

  const connection = await mysql.createConnection(dbUrl);
  try {
    const [tabelasRows] = await connection.query<any[]>("SHOW TABLES");
    const nomesTabelas = tabelasRows.map((row: any) => Object.values(row)[0] as string);

    const partes: string[] = [
      `-- Backup automático — Estoque Metalúrgica`,
      `-- Gerado em: ${new Date().toISOString()}`,
      `SET FOREIGN_KEY_CHECKS=0;`,
      ``,
    ];

    for (const tabela of nomesTabelas) {
      const [createRows] = await connection.query<any[]>(`SHOW CREATE TABLE \`${tabela}\``);
      const createSql = createRows[0]["Create Table"] as string;
      partes.push(`-- ────────────────────────────────────────`);
      partes.push(`-- Tabela: ${tabela}`);
      partes.push(`-- ────────────────────────────────────────`);
      partes.push(`DROP TABLE IF EXISTS \`${tabela}\`;`);
      partes.push(`${createSql};`);
      partes.push(``);

      const [colunasRows] = await connection.query<any[]>(`SHOW COLUMNS FROM \`${tabela}\``);
      const colunas = colunasRows.map((c: any) => c.Field as string);
      const colunasStr = colunas.map((c) => `\`${c}\``).join(", ");

      const TAMANHO_LOTE = 500;
      let offset = 0;
      while (true) {
        const [linhas] = await connection.query<any[]>(
          `SELECT * FROM \`${tabela}\` LIMIT ? OFFSET ?`,
          [TAMANHO_LOTE, offset]
        );
        if (linhas.length === 0) break;

        const valoresLinhas = linhas.map((linha: any) => {
          const valores = colunas.map((coluna) => connection.escape(linha[coluna]));
          return `(${valores.join(", ")})`;
        });
        partes.push(`INSERT INTO \`${tabela}\` (${colunasStr}) VALUES`);
        partes.push(valoresLinhas.join(",\n") + ";");
        partes.push(``);

        offset += TAMANHO_LOTE;
        if (linhas.length < TAMANHO_LOTE) break;
      }
    }

    partes.push(`SET FOREIGN_KEY_CHECKS=1;`);
    return partes.join("\n");
  } finally {
    await connection.end();
  }
}

/**
 * Autentica no Google Drive como o PRÓPRIO usuário (OAuth2), não como conta
 * de serviço — contas de serviço não têm cota de armazenamento própria
 * (erro "do not have storage quota"), então não conseguem criar arquivo
 * nenhum numa conta pessoal do Drive. Autenticando como o usuário real, o
 * backup usa a cota normal e gratuita da conta (15GB).
 */
function autenticarGoogleDrive() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error("Variáveis do Google OAuth não configuradas (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET / GOOGLE_OAUTH_REFRESH_TOKEN).");
  }

  const auth = new google.auth.OAuth2(clientId, clientSecret);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

/** Sobe o conteúdo do backup pro Google Drive, na pasta configurada. */
async function uploadBackupParaDrive(sqlContent: string, nomeArquivo: string): Promise<void> {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_BACKUP_FOLDER_ID não configurada.");

  const drive = autenticarGoogleDrive();
  const stream = Readable.from([sqlContent]);

  await drive.files.create({
    requestBody: {
      name: nomeArquivo,
      parents: [folderId],
    },
    media: {
      mimeType: "application/sql",
      body: stream,
    },
  });
}

/**
 * Apaga backups mais antigos que o limite de retenção, pra pasta do Drive
 * não crescer sem limite. Mantém os últimos `manterDias` dias.
 */
async function limparBackupsAntigos(manterDias: number = 30): Promise<void> {
  const folderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID;
  if (!folderId) return;

  const drive = autenticarGoogleDrive();
  const limite = new Date();
  limite.setDate(limite.getDate() - manterDias);

  const res = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'backup_estoque_' and trashed = false`,
    fields: "files(id, name, createdTime)",
    pageSize: 1000,
  });

  const arquivosAntigos = (res.data.files || []).filter((f) => {
    if (!f.createdTime) return false;
    return new Date(f.createdTime) < limite;
  });

  for (const arquivo of arquivosAntigos) {
    if (arquivo.id) await drive.files.delete({ fileId: arquivo.id });
  }
}

/** Executa o backup completo: gera o dump, sobe pro Drive, limpa os antigos. */
export async function executarBackupCompleto(): Promise<ResultadoBackup> {
  try {
    console.log("[Backup] Iniciando backup do banco de dados...");
    const sqlContent = await gerarDumpSql();
    const tamanhoBytes = Buffer.byteLength(sqlContent, "utf-8");

    const agora = new Date();
    const carimbo = agora.toISOString().replace(/[:.]/g, "-").slice(0, 16);
    const nomeArquivo = `backup_estoque_${carimbo}.sql`;

    await uploadBackupParaDrive(sqlContent, nomeArquivo);
    console.log(`[Backup] Concluído: ${nomeArquivo} (${(tamanhoBytes / 1024 / 1024).toFixed(2)} MB)`);

    try {
      await limparBackupsAntigos(30);
    } catch (err: any) {
      console.error("[Backup] Aviso: falha ao limpar backups antigos:", err.message);
    }

    return { ok: true, arquivo: nomeArquivo, tamanhoBytes };
  } catch (error: any) {
    console.error("[Backup] Falhou:", error.message);
    return { ok: false, erro: error.message };
  }
}