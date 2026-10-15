import "dotenv/config";
import { google } from "googleapis";
import readline from "readline";

/**
 * Re-autorização Google com escopo AMPLIADO — o refresh token que já existe
 * (usado só pro backup) foi gerado pedindo só permissão de Drive. Esse
 * script pede as DUAS permissões de uma vez (Drive continua funcionando +
 * Gmail somado), gerando um novo refresh token que substitui o antigo.
 *
 * Depois de rodar, atualize GOOGLE_OAUTH_REFRESH_TOKEN na Railway com o
 * valor novo que aparecer no final — local e produção.
 */

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET precisam estar no .env antes de rodar.");
  process.exit(1);
}

const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"; // fluxo "copiar e colar o código" — não precisa de servidor local

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = [
  "https://www.googleapis.com/auth/drive.file",   // mesmo escopo já usado pelo backup
  "https://www.googleapis.com/auth/gmail.readonly", // novo — leitura de e-mail pros pedidos
];

const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent", // força mostrar a tela de permissão de novo, mesmo se já tiver autorizado antes
  scope: SCOPES,
});

console.log("\n1. Abra esse link no navegador (com a conta Google certa logada):\n");
console.log(url);
console.log("\n2. Aceite as duas permissões (Drive e Gmail).");
console.log("3. Copie o código que aparecer na tela e cole aqui embaixo.\n");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question("Cole o código aqui: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log("\n✅ Sucesso! Novo refresh token gerado:\n");
    console.log(tokens.refresh_token);
    console.log("\nAtualize GOOGLE_OAUTH_REFRESH_TOKEN com esse valor — local (.env) e produção (Railway).");
    console.log("(o Client ID e Client Secret continuam os mesmos, não precisa mexer neles)");
  } catch (err) {
    console.error("Falhou ao trocar o código pelo token:", err.message);
  }
});
