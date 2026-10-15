import { useEffect, useState } from "react";
import "./DeveloperCredit.css";

const NOTIFICATIONS_SNOOZE_KEY = "hcmStockNotificationsSnoozedUntil";
const SHOW_DELAY_MS = 900;
const VISIBLE_DURATION_MS = 5000;
const FADE_OUT_MS = 400;

function notificationsWidgetIsActive(): boolean {
  if (typeof window === "undefined") return false;
  const raw = Number(localStorage.getItem(NOTIFICATIONS_SNOOZE_KEY));
  const snoozedUntil = Number.isFinite(raw) ? raw : 0;
  return snoozedUntil <= Date.now();
}

/**
 * Crédito de autoria, discreto e animado, exibido brevemente a cada
 * carregamento da página. Ancorado no mesmo canto do balão de notificações
 * de estoque (StockNotifications) — "nasce" dele quando o balão está
 * visível, ou aparece sozinho no canto quando o balão está silenciado.
 */
export function DeveloperCredit() {
  const [phase, setPhase] = useState<"hidden" | "in" | "out">("hidden");
  const [anchored, setAnchored] = useState(false);

  useEffect(() => {
    setAnchored(notificationsWidgetIsActive());

    const showTimer = window.setTimeout(() => setPhase("in"), SHOW_DELAY_MS);
    const hideTimer = window.setTimeout(
      () => setPhase("out"),
      SHOW_DELAY_MS + VISIBLE_DURATION_MS
    );
    const removeTimer = window.setTimeout(
      () => setPhase("hidden"),
      SHOW_DELAY_MS + VISIBLE_DURATION_MS + FADE_OUT_MS
    );

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      window.clearTimeout(removeTimer);
    };
  }, []);

  if (phase === "hidden") return null;

  return (
    <div
      className="hcm-dev-credit"
      data-anchored={anchored}
      data-phase={phase}
      aria-hidden="true"
    >
      <span className="hcm-dev-credit__dot" />
      Desenvolvido por Wengles Monteiro
    </div>
  );
}

export default DeveloperCredit;
