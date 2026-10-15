import { sdk } from "./sdk";
import * as db from "../db";
import type { Request, Response } from "express";

export async function createContext({ req, res }: { req: Request; res: Response }) {
  let user = null;

  try {
    user = await sdk.authenticateRequest(req);
  } catch {
    // Sessão ausente ou inválida — usuário não autenticado
    user = null;
  }

  return {
    user,
    req,
    res,
    // Cache de permissões efetivas por usuário, válido só durante esta requisição.
    // Evita repetir a mesma consulta (role_permissoes + usuario_permissoes) quando
    // vários middlewares permissaoProcedure/permissaoEstritaProcedure rodam na
    // mesma chamada. Ver getCachedUserPermissions em rbac.ts.
    permissionsCache: new Map<number, Promise<string[]>>(),
  };
}

export type TrpcContext = Awaited<ReturnType<typeof createContext>>;