import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import { URL } from "url";

/**
 * Autorização Google pra LEITURA DE E-MAIL dos pedidos (Fase 2) — conta
 * DIFERENTE da usada no backup (aquela é só Drive). Esse script pede só a
 * permissão de Gmail, e gera um refresh token PRÓPRIO — não mexe em nada
 * do que já está configurado pro backup.
 *
 * Reaproveita o mesmo "app" OAuth (Client ID/Secret) já criado no Google
 * Cloud Console pro backup — não precisa criar um projeto novo lá, só
 * autorizar com a OUTRA conta Google (a que recebe os e-mails de pedido).
 */

// Reaproveita o Client ID/Secret que já existe (mesmo app), a menos que
// você tenha criado um separado especificamente pra isso.
const CLIENT_ID = process.env.GMAIL_PEDIDOS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_PEDIDOS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("Não achei GMAIL_PEDIDOS_CLIENT_ID/SECRET nem GOOGLE_OAUTH_CLIENT_ID/SECRET no .env.");
  console.error("Configure pelo menos um dos dois pares antes de rodar.");
  process.exit(1);
}

// Mesmo fluxo do gerar-refresh-token.mjs (retorno em localhost). O fluxo
// antigo de "copiar e colar o código" (urn:ietf:wg:oauth:2.0:oob) é bloqueado
// pelo Google quando o app está publicado ("In production") — e o app precisa
// estar publicado, senão o refresh token expira a cada 7 dias.
const PORTA = 53682;
const REDIRECT_URI = `http://localhost:${PORTA}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

const url = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: SCOPES,
});

console.log("\n⚠️  IMPORTANTE: quando abrir o link, faça login com a conta de E-MAIL");
console.log("   que recebe os pedidos (a que leva cópia dos fornecedores) —");
console.log("   NÃO a conta usada no backup do Google Drive.\n");
console.log("1. Abra esse link no navegador, já logado (ou trocando de conta) na conta certa:\n");
console.log(url);
console.log("\n2. Aceite a permissão de leitura do Gmail.");
console.log("3. Volte pra esse terminal — o token aparece aqui sozinho.\n");

const server = http.createServer(async (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  try {
    const recebido = new URL(req.url, REDIRECT_URI);
    const erro = recebido.searchParams.get("error");
    if (erro) {
      res.end(`O Google devolveu um erro: ${erro}. Volte no terminal.`);
      console.error("O Google devolveu um erro na autorização:", erro);
      server.close();
      process.exit(1);
    }
    const code = recebido.searchParams.get("code");
    if (!code) {
      res.end("Nenhum código recebido. Feche essa aba e tente de novo.");
      return;
    }
    const { tokens } = await oauth2Client.getToken(code);
    res.end("Autorizado com sucesso! Pode fechar essa aba e voltar pro terminal.");
    server.close();

    console.log("\n✅ Sucesso! Adicione essas 3 variáveis na Railway (e no .env local):\n");
    console.log("GMAIL_PEDIDOS_CLIENT_ID=" + CLIENT_ID);
    console.log("GMAIL_PEDIDOS_CLIENT_SECRET=" + CLIENT_SECRET);
    console.log("GMAIL_PEDIDOS_REFRESH_TOKEN=" + tokens.refresh_token);
    console.log("\nEssas são separadas das GOOGLE_OAUTH_* do backup — nada muda lá.");
    process.exit(0);
  } catch (err) {
    console.error("Falhou ao trocar o código pelo token:", err.message);
    res.end("Deu erro — volte no terminal pra ver o que houve.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORTA, () => {
  console.log(`(aguardando resposta em http://localhost:${PORTA} — não feche esse terminal)`);
});
