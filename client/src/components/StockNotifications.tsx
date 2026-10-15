import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import "./StockNotifications.css";

type MovementStatus = "ok" | "attention" | "critical";

type MovementInfo = {
  days: number | null;
  status: MovementStatus;
  dateLabel: string;
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function parseDate(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function daysSince(value: unknown, now: Date = new Date()): number | null {
  const date = parseDate(value);
  if (!date) return null;
  const diff = startOfDay(now).getTime() - startOfDay(date).getTime();
  return Math.max(0, Math.floor(diff / 86400000));
}

function statusForDays(days: number | null): MovementStatus {
  if (days === null) return "critical";
  if (days >= 7) return "critical";
  if (days >= 2) return "attention";
  return "ok";
}

function daysLabel(days: number | null): string {
  if (days === null) return "sem registro";
  if (days === 0) return "hoje";
  if (days === 1) return "dia";
  return "dias";
}

function daysText(days: number | null): string {
  return days === null ? "—" : numberFormatter.format(days);
}

function dateText(value: unknown): string {
  const date = parseDate(value);
  return date ? `Último registro em ${dateFormatter.format(date)}` : "Nenhum registro encontrado";
}

function buildMovement(value: unknown): MovementInfo {
  const days = daysSince(value);
  return { days, status: statusForDays(days), dateLabel: dateText(value) };
}

const SNOOZE_KEY = "hcmStockNotificationsSnoozedUntil";
const SNOOZE_DURATION_MS = 30 * 60 * 1000; // 30 minutos

function readSnoozedUntil(): number {
  if (typeof window === "undefined") return 0;
  const raw = Number(localStorage.getItem(SNOOZE_KEY));
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * Balão flutuante com a recência das últimas movimentações de estoque
 * (entrada e baixa de material). Ancorado no canto inferior direito.
 * Ao fechar, some por 30 minutos e volta a aparecer sozinho — funciona
 * como um lembrete recorrente em vez de um fechamento definitivo.
 */
export function StockNotifications() {
  const [open, setOpen] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState(readSnoozedUntil);
  const dismissed = snoozedUntil > Date.now();
  const rootRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Reagenda a reexibição automática enquanto a aba continuar aberta,
  // sem precisar de reload para o balão voltar a aparecer.
  useEffect(() => {
    if (!dismissed) return;
    const remaining = snoozedUntil - Date.now();
    const timer = window.setTimeout(() => setSnoozedUntil(0), remaining);
    return () => window.clearTimeout(timer);
  }, [dismissed, snoozedUntil]);

  const { data } = trpc.notificacoesEstoque.resumo.useQuery(undefined, {
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
    staleTime: 60 * 1000,
  });

  const entrada = useMemo(() => buildMovement(data?.entrada?.ultimaMovimentacaoEm ?? null), [data]);
  const baixa = useMemo(() => buildMovement(data?.baixa?.ultimaMovimentacaoEm ?? null), [data]);

  const maxDays = useMemo(() => {
    const values = [entrada.days, baixa.days].filter((d): d is number => d !== null);
    return values.length ? Math.max(...values) : null;
  }, [entrada.days, baixa.days]);

  const overallStatus = statusForDays(maxDays);

  const summaryText = useMemo(() => {
    if (!data) return "Verificando movimentações...";
    if (maxDays === null) return "Nenhuma movimentação registrada";
    if (maxDays === 0) return "Movimentações atualizadas hoje";
    return `Última movimentação há ${numberFormatter.format(maxDays)} ${maxDays === 1 ? "dia" : "dias"}`;
  }, [data, maxDays]);

  // Fecha ao clicar fora ou pressionar Escape (o botão fica dentro de rootRef,
  // então clicar nele nunca fecha o painel que acabou de abrir).
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("click", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("click", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (open) closeButtonRef.current?.focus();
  }, [open]);

  function handleDismiss(event: React.MouseEvent) {
    event.stopPropagation();
    const until = Date.now() + SNOOZE_DURATION_MS;
    setOpen(false);
    setSnoozedUntil(until);
    localStorage.setItem(SNOOZE_KEY, String(until));
  }

  if (dismissed) return null;

  return (
    <div
      ref={rootRef}
      className="hcm-stock-notifications"
      data-status={overallStatus}
      aria-label="Notificações de movimentação do estoque"
    >
      {open && (
        <section
          className="hcm-stock-notifications__panel"
          aria-labelledby="hcmStockNotificationsPanelTitle"
        >
          <header className="hcm-stock-notifications__panel-header">
            <div>
              <strong id="hcmStockNotificationsPanelTitle">Atualizações do estoque</strong>
              <span>Recência das movimentações registradas</span>
            </div>
            <button
              ref={closeButtonRef}
              className="hcm-stock-notifications__close"
              type="button"
              aria-label="Fechar notificações"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>

          <div className="hcm-stock-notifications__body" aria-live="polite">
            <MovementRow type="entrada" title="Entrada de material" movement={entrada} />
            <MovementRow type="baixa" title="Baixa de material" movement={baixa} />
          </div>

          <footer className="hcm-stock-notifications__footer">
            Considere atualizar as movimentações quando houver recebimento ou retirada física de material.
          </footer>
        </section>
      )}

      <div className="hcm-stock-notifications__button-wrap">
        <button
          className="hcm-stock-notifications__button"
          type="button"
          aria-expanded={open}
          aria-controls="hcmStockNotificationsPanel"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="hcm-stock-notifications__icon" aria-hidden="true">
            ⌁
          </span>
          <span className="hcm-stock-notifications__copy">
            <strong className="hcm-stock-notifications__title">Atualizações</strong>
            <span className="hcm-stock-notifications__summary">{summaryText}</span>
          </span>
          <span className="hcm-stock-notifications__badge" data-status={overallStatus}>
            {maxDays === null ? "!" : `${numberFormatter.format(maxDays)}d`}
          </span>
        </button>

        <button
          className="hcm-stock-notifications__dismiss"
          type="button"
          aria-label="Fechar notificações de estoque"
          title="Fechar notificações"
          onClick={handleDismiss}
        >
          ×
        </button>
      </div>
    </div>
  );
}

function MovementRow({
  type,
  title,
  movement,
}: {
  type: "entrada" | "baixa";
  title: string;
  movement: MovementInfo;
}) {
  return (
    <article className="hcm-stock-notifications__movement">
      <div className="hcm-stock-notifications__movement-icon" data-type={type} aria-hidden="true">
        {type === "entrada" ? "↓" : "↑"}
      </div>
      <div>
        <strong className="hcm-stock-notifications__movement-title">{title}</strong>
        <small className="hcm-stock-notifications__movement-date">{movement.dateLabel}</small>
      </div>
      <div className="hcm-stock-notifications__days" data-status={movement.status}>
        <strong>{daysText(movement.days)}</strong>
        <small>{daysLabel(movement.days)}</small>
      </div>
    </article>
  );
}

export default StockNotifications;
