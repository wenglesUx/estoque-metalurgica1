import "dotenv/config";
import path from "path";
import fs from "fs";
import dotenv from "dotenv";
import express from "express";

// Garantir que o .env seja carregado da raiz do projeto
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
}
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { initializeDefaultPermissions } from "./auth";
import cron from "node-cron";
import { executarBackupCompleto } from "../backup.service";
import { executarVarreduraEmailPedidos } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Remove o header "X-Powered-By: Express" (fingerprint gratuito da stack
  // pra quem inspeciona as respostas HTTP).
  app.disable("x-powered-by");

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // Inicializa permissões padrão no banco (idempotente — seguro rodar sempre)
  try {
    await initializeDefaultPermissions();
    console.log("[Auth] Permissões padrão inicializadas");
  } catch (err) {
    console.error("[Auth] Falha ao inicializar permissões:", err);
  }

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);

    // Backup automático do banco de dados — todo dia às 3h da manhã (horário
    // do servidor). Só é ativado se as variáveis do Google Drive estiverem
    // configuradas; senão fica silenciosamente desligado, sem quebrar nada.
    if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON && process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID) {
      cron.schedule("0 3 * * *", () => {
        executarBackupCompleto().catch((err) => console.error("[Backup] Erro inesperado:", err));
      });
      console.log("[Backup] Agendamento diário ativado (03:00).");
    } else {
      console.log("[Backup] Variáveis do Google Drive não configuradas — backup automático desativado.");
    }

    // Leitura automática de pedidos de compra por e-mail (Fase 2) — a cada
    // 20 minutos. Usa credenciais PRÓPRIAS (GMAIL_PEDIDOS_*), separadas das
    // do backup (GOOGLE_OAUTH_*), porque a conta de e-mail que recebe os
    // pedidos é diferente da conta usada pro Drive.
    if (process.env.GMAIL_PEDIDOS_CLIENT_ID && process.env.GMAIL_PEDIDOS_CLIENT_SECRET && process.env.GMAIL_PEDIDOS_REFRESH_TOKEN) {
      cron.schedule("*/20 * * * *", () => {
        executarVarreduraEmailPedidos().catch((err) => console.error("[GmailPedidos] Erro inesperado:", err));
      });
      console.log("[GmailPedidos] Varredura automática de pedidos por e-mail ativada (a cada 20min).");
    } else {
      console.log("[GmailPedidos] Variáveis GMAIL_PEDIDOS_* não configuradas — leitura automática de pedidos desativada.");
    }
  });
}

startServer().catch(console.error);