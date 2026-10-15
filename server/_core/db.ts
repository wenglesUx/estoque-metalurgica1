/**
 * server/_core/db.ts
 *
 * Re-export canônico — a implementação real vive em server/db.ts.
 * Este arquivo existe apenas para compatibilidade caso algum import interno
 * aponte para _core/db. Não duplique lógica aqui.
 */
export * from "../db";