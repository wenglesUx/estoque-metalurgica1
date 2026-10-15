// Script de uso ÚNICO — roda uma vez no seu PC pra gerar o "refresh token"
// que autoriza o sistema a usar sua conta pessoal do Google Drive daqui pra
// frente, sem precisar repetir esse processo de novo.
//
// Uso: node gerar-refresh-token.mjs
//
// Precisa de GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET no .env (pega
// elas na tela do Google Cloud Console, na credencial OAuth que você criou).

import "dotenv/config";
import { google } from "googleapis";
import http from "http";
import { URL } from "url";

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("GOOGLE_OAUTH_CLIENT_ID e GOOGLE_OAUTH_CLIENT_SECRET precisam estar no .env antes de rodar.");
  process.exit(1);
}
const PORTA = 53682;
const REDIRECT_URI = `http://localhost:53682/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/drive.file"],
});

console.log("\nAbra esse link no navegador, faça login com sua conta pessoal do Google, e autorize:\n");
console.log(authUrl);
console.log("\nAguardando você autorizar no navegador...\n");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, REDIRECT_URI);
    const code = url.searchParams.get("code");
    if (!code) {
      res.end("Nenhum código recebido. Feche essa aba e tente de novo.");
      return;
    }
    const { tokens } = await oauth2Client.getToken(code);
    res.end("Autorizado com sucesso! Pode fechar essa aba e voltar pro terminal.");
    server.close();

    console.log("\n✅ Pronto! Aqui estão os valores pra colocar na Railway:\n");
    console.log("GOOGLE_OAUTH_CLIENT_ID =", CLIENT_ID);
    console.log("GOOGLE_OAUTH_CLIENT_SECRET =", CLIENT_SECRET);
    console.log("GOOGLE_OAUTH_REFRESH_TOKEN =", tokens.refresh_token);
    console.log("\nGuarde esses 3 valores — principalmente o REFRESH_TOKEN, ele só aparece essa vez.\n");
    process.exit(0);
  } catch (err) {
    console.error("Erro ao trocar o código por token:", err.message);
    res.end("Deu erro — volta no terminal pra ver o que houve.");
    server.close();
    process.exit(1);
  }
});

server.listen(PORTA, () => {
  console.log(`(aguardando resposta em http://localhost:${PORTA} — não feche esse terminal)`);
});
