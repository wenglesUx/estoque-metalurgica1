// /modules/separacao-producao/status.ts

export type StatusRequisicao =
  | "em_separacao"
  | "aguardando_aprovacao"
  | "aprovada"
  | "rejeitada"
  | "cancelada";

export const STATUS_REQUISICAO: Record<
  StatusRequisicao,
  { label: string; className: string }
> = {
  em_separacao: {
    label: "Em separação",
    className: "bg-blue-100 text-blue-800",
  },
  aguardando_aprovacao: {
    label: "Aguardando aprovação",
    className: "bg-amber-100 text-amber-800",
  },
  aprovada: {
    label: "Aprovada · baixada",
    className: "bg-green-100 text-green-800",
  },
  rejeitada: {
    label: "Rejeitada",
    className: "bg-red-100 text-red-800",
  },
  cancelada: {
    label: "Cancelada",
    className: "bg-muted text-muted-foreground",
  },
};

/** "2026-10-03" → "03/10/2026" sem passar por Date (evita erro de fuso) */
export function formatarDataRequisicao(valor: string | null | undefined) {
  if (!valor) return "-";

  const [ano, mes, dia] = valor.split("-");

  return ano && mes && dia ? `${dia}/${mes}/${ano}` : valor;
}

export function hojeIso() {
  const agora = new Date();
  const mes = String(agora.getMonth() + 1).padStart(2, "0");
  const dia = String(agora.getDate()).padStart(2, "0");

  return `${agora.getFullYear()}-${mes}-${dia}`;
}

/** Mensagens do servidor vêm prefixadas pelo handleDbError (server/db.ts) */
export function mensagemErro(error: unknown) {
  const mensagem = (error as any)?.message ?? "Erro inesperado.";

  return String(mensagem).replace(/^Failed query:\s*/, "");
}
