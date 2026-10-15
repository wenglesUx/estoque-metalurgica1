import React, { useState, useRef, useEffect } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissao } from "@/_core/hooks/usePermissao";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  Menu, X, LogOut, BarChart3, Package, Briefcase, FileText, Truck,
  Settings, Upload, Zap, Wrench, Database, ArrowRightLeft,
  Search, ClipboardList, User as UserIcon, Trash2, MapPin, AlertTriangle, ShieldCheck, Route, QrCode,
} from "lucide-react";
import { BotaoLeitorQr } from "@/modules/leitor-qr/LeitorQr";
import { trpc } from "@/lib/trpc";
import { StockNotifications } from "./StockNotifications";
import { DeveloperCredit } from "./DeveloperCredit";
import { PERMISSOES, type Permissao } from "@shared/permissoes";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  ownerOnly?: boolean;
  /** Chave de "ver" exigida para aparecer no menu e para acessar a rota diretamente por URL. */
  permission?: Permissao;
}

export const navItems: NavItem[] = [
  { label: "Dashboard",        href: "/",               icon: <BarChart3 className="w-5 h-5" />, permission: PERMISSOES.DASHBOARD_VER },
  { label: "Materiais",        href: "/materiais",       icon: <Package className="w-5 h-5" />, permission: PERMISSOES.MATERIAIS_VER },
  { label: "Inventário",       href: "/inventario",      icon: <Database className="w-5 h-5" />, permission: PERMISSOES.INVENTARIO_VER },
  { label: "Relatório de Divergência", href: "/relatorio-divergencia", icon: <AlertTriangle className="w-5 h-5" />, permission: PERMISSOES.INVENTARIO_VER },
  { label: "Linha do Tempo",   href: "/linha-do-tempo",  icon: <Route className="w-5 h-5" />, permission: PERMISSOES.MATERIAIS_VER },
  { label: "Leitor de QR",     href: "/leitor",          icon: <QrCode className="w-5 h-5" />, permission: PERMISSOES.MATERIAIS_VER },
  { label: "Materiais a Chegar", href: "/materiais-a-chegar", icon: <Truck className="w-5 h-5" />, permission: PERMISSOES.MATERIAIS_A_CHEGAR_VER },
  { label: "Solicitações",     href: "/solicitacoes",    icon: <ArrowRightLeft className="w-5 h-5" />, permission: PERMISSOES.SOLICITACOES_VER },
  { label: "Registros de Entrada", href: "/registros-entrada", icon: <FileText className="w-5 h-5" />, permission: PERMISSOES.REGISTROS_ENTRADA_VER },
  { label: "GRDs Geradas", href: "/grds-geradas", icon: <FileText className="w-5 h-5" />, permission: PERMISSOES.GRDS_VER },
  { label: "Registros de Saída", href: "/registros-saida", icon: <FileText className="w-5 h-5" />, permission: PERMISSOES.SAIDAS_VER },
  { label: "Histórico",        href: "/historico",       icon: <BarChart3 className="w-5 h-5" />, permission: PERMISSOES.MATERIAIS_VER },
  { label: "Obras",            href: "/obras",           icon: <Briefcase className="w-5 h-5" />, permission: PERMISSOES.OBRAS_VER },
  // "Movimentações" ocultada do menu por enquanto (sem uso definido ainda) —
  // a rota continua existindo, só não aparece na navegação. Descomente pra reativar.
  // { label: "Movimentações",    href: "/movimentacoes",   icon: <FileText className="w-5 h-5" /> },
  { label: "Importar",         href: "/importacao",      icon: <Upload className="w-5 h-5" />, permission: PERMISSOES.IMPORTACAO_VER },
  // "Plano de Corte" ocultada do menu por enquanto (sem uso definido ainda).
  // { label: "Plano de Corte",   href: "/plano-corte",     icon: <Zap className="w-5 h-5" /> },
  { label: "Especificações",   href: "/especificacoes",  icon: <Database className="w-5 h-5" />, permission: PERMISSOES.ESPECIFICACOES_VER },
  // "Ajuste" ocultada do menu por enquanto — a aba de usuários que ela tinha
  // foi removida (consolidada em /usuarios) e a de ajuste de estoque não tem
  // uso real hoje (opera sobre uma tabela legada). Rota continua existindo.
  // { label: "Ajuste",           href: "/ajuste",          icon: <Wrench className="w-5 h-5" /> },
  { label: "Relatórios",       href: "/relatorios",     icon: <BarChart3 className="w-5 h-5" />, permission: PERMISSOES.RELATORIOS_VER },
  { label: "Usuários",         href: "/usuarios",       icon: <UserIcon className="w-5 h-5" />, permission: PERMISSOES.USUARIOS_VER },
  { label: "Locais",           href: "/locais",         icon: <MapPin className="w-5 h-5" />, permission: PERMISSOES.LOCAIS_VER },
  { label: "Permissões",       href: "/configuracoes/permissoes", icon: <ShieldCheck className="w-5 h-5" />, ownerOnly: true },
  { label: "Limpeza de Dados", href: "/limpeza",         icon: <Trash2 className="w-5 h-5" />, ownerOnly: true },
];

// ─── Busca Global ─────────────────────────────────────────────────────────────
function BuscaGlobal() {
  const [termo, setTermo] = useState("");
  const [termoDebounced, setTermoDebounced] = useState("");
  const [aberto, setAberto] = useState(false);
  const [, navigate] = useLocation();
  const ref = useRef<HTMLDivElement>(null);

  // Debounce: aguarda 400ms após última tecla pressionada para buscar
  useEffect(() => {
    const timer = setTimeout(() => setTermoDebounced(termo.trim()), 400);
    return () => clearTimeout(timer);
  }, [termo]);

  // Fechar popover ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setAberto(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const { data: resultados, isFetching } = trpc.materiais.busca.useQuery(
    { termo: termoDebounced },
    {
      enabled: termoDebounced.length >= 2,
      staleTime: 10_000,
    }
  );

  const irParaMaterial = (id: number) => {
    navigate(`/materiais?highlight=${id}`);
    setAberto(false);
    setTermo("");
    setTermoDebounced("");
  };

  return (
    <div ref={ref} className="relative w-full max-w-[34rem]">
      {/* Campo de busca */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar NF, certificado, corrida, tipo..."
          value={termo}
          onChange={(e) => {
            setTermo(e.target.value);
            setAberto(true);
          }}
          onFocus={() => setAberto(true)}
          className="w-full pl-10 pr-10 py-2.5 text-sm border border-border/80 rounded-xl bg-card text-foreground placeholder:text-muted-foreground shadow-sm focus:outline-none focus:border-ring focus:ring-4 focus:ring-ring/10 transition-all"
        />
        {termo && (
          <button
            onClick={() => { setTermo(""); setTermoDebounced(""); setAberto(false); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Popover de resultados */}
      {aberto && termoDebounced.length >= 2 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-card border border-border rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
          {isFetching ? (
            <div className="p-4 text-sm text-muted-foreground text-center flex items-center justify-center gap-2">
              <span className="inline-block w-3 h-3 border-2 border-muted-foreground border-t-accent rounded-full animate-spin" />
              Buscando...
            </div>
          ) : !resultados || resultados.length === 0 ? (
            <div className="p-4 text-sm text-center">
              <p className="text-muted-foreground">Nenhum resultado para</p>
              <p className="font-medium text-foreground mt-0.5">"{termoDebounced}"</p>
            </div>
          ) : (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-muted-foreground border-b border-border bg-muted/40 sticky top-0">
                {resultados.length} resultado(s) para "{termoDebounced}"
              </div>
              {resultados.map((item: any) => (
                <button
                  key={item.id}
                  onClick={() => irParaMaterial(item.id)}
                  className="w-full text-left px-3 py-3 hover:bg-accent/10 transition-colors border-b border-border last:border-0 group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-sm text-foreground group-hover:text-accent transition-colors">
                        {item.tipo} {item.bitola}
                        {item.aco && (
                          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                            {item.aco}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                        {item.nf && (
                          <span>NF: <span className="font-medium text-foreground">{item.nf}</span></span>
                        )}
                        {item.numero_certificado && (
                          <span>Cert.: <span className="font-medium text-foreground">{item.numero_certificado}</span></span>
                        )}
                        {item.corrida && (
                          <span>Corrida: <span className="font-medium text-foreground">{item.corrida}</span></span>
                        )}
                      </div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground shrink-0">
                      <div className="font-medium">{item.quantidade} un</div>
                      <div>{parseFloat(String(item.pesoTotal || 0)).toFixed(1)} kg</div>
                      {item.obraNome && (
                        <div className="text-accent font-semibold mt-0.5">{item.obraNome}</div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              <div className="px-3 py-2 text-xs text-muted-foreground text-center border-t border-border bg-muted/20">
                Clique em um item para ir aos Materiais
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Layout Principal ─────────────────────────────────────────────────────
export function StockDashboardLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const { pode } = usePermissao();
  const [location, navigate] = useLocation();

  const itensVisiveis = navItems.filter(
    (item) =>
      (!item.ownerOnly || user?.role === "owner") &&
      (!item.permission || pode(item.permission))
  );

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  return (
    <div className="flex min-h-screen h-svh bg-background">
      <StockNotifications />
      <DeveloperCredit />
      {/* Sidebar Desktop */}
      <aside
        className={`hidden md:flex ${
          sidebarOpen ? "w-[16.5rem]" : "w-[4.75rem]"
        } bg-sidebar text-sidebar-foreground border-r border-sidebar-border shadow-[12px_0_32px_-28px_rgba(12,35,56,0.55)] transition-[width] duration-300 ease-out flex-col`}
      >
        {/* Logo */}
        <div className="flex items-center justify-between min-h-[4.5rem] px-4 border-b border-sidebar-border shrink-0">
          {sidebarOpen ? (
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-sidebar-primary/20">
                <img src="/brand/hcm-industrial.svg" alt="HCM Industrial" className="h-8 w-8 object-contain" />
              </div>
              <div className="min-w-0 leading-tight"><span className="block truncate font-semibold text-[14px] tracking-[-0.025em] text-sidebar-foreground">Controle de Estoque</span><span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-sidebar-foreground/45">HCM Industrial</span></div>
            </div>
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white ring-1 ring-sidebar-primary/20">
              <img src="/brand/hcm-industrial.svg" alt="HCM Industrial" className="h-8 w-8 object-contain" />
            </div>
          )}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-sidebar-accent rounded-lg transition-colors ml-auto text-sidebar-foreground/65 hover:text-sidebar-foreground"
          >
            {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>

        {/* Navegação Desktop */}
        <nav className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto">
          {itensVisiveis.map((item) => {
            const isActive = location === item.href;
            return (
              <button
                key={item.href}
                onClick={() => navigate(item.href)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
                  isActive
                    ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/10"
                    : item.ownerOnly
                      ? "text-red-300 hover:bg-red-950/45"
                      : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                }`}
                title={!sidebarOpen ? item.label : undefined}
              >
                <span className="flex-shrink-0">{item.icon}</span>
                {sidebarOpen && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Usuário e logout Desktop */}
        <div className="border-t border-sidebar-border p-3 space-y-2 shrink-0">
          {sidebarOpen && (
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">Sessão ativa</p>
              <p className="text-sm font-medium text-sidebar-foreground truncate mt-0.5">
                {user?.name || user?.email || "Usuário"}
              </p>
            </div>
          )}
          <Button
            onClick={handleLogout}
            variant="outline"
            size="sm"
            className="w-full justify-center gap-2 border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <LogOut className="w-4 h-4" />
            {sidebarOpen && "Sair"}
          </Button>
        </div>
      </aside>

      {/* Mobile Menu Sheet */}
      <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
        <SheetContent side="left" className="w-[17rem] border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
          <SheetHeader className="border-b border-sidebar-border p-4">
            <SheetTitle className="flex items-center gap-3 text-sidebar-foreground">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1 ring-sidebar-primary/20">
                <img src="/brand/hcm-industrial.svg" alt="HCM Industrial" className="h-8 w-8 object-contain" />
              </div>
              <span className="font-semibold">Controle de Estoque</span>
            </SheetTitle>
          </SheetHeader>
          
          {/* Navegação Mobile */}
          <nav className="flex-1 px-3 py-5 space-y-1.5 overflow-y-auto">
            {itensVisiveis.map((item) => {
              const isActive = location === item.href;
              return (
                <button
                  key={item.href}
                  onClick={() => {
                    navigate(item.href);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all text-sm font-medium ${
                    isActive
                      ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-md shadow-sidebar-primary/10"
                      : item.ownerOnly
                        ? "text-red-300 hover:bg-red-950/45"
                        : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                  }`}
                >
                  <span className="flex-shrink-0">{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Usuário e logout Mobile */}
          <div className="border-t border-sidebar-border p-3 space-y-2">
            <div className="px-3 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/40">Sessão ativa</p>
              <p className="text-sm font-medium text-sidebar-foreground truncate mt-0.5">
                {user?.name || user?.email || "Usuário"}
              </p>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              size="sm"
              className="w-full justify-center gap-2 border-sidebar-border bg-sidebar-accent/40 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              <LogOut className="w-4 h-4" />
              Sair
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Conteúdo principal */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header com busca global */}
        <header className="min-h-[4.5rem] bg-background/90 backdrop-blur border-b border-border/70 flex items-center justify-between px-4 sm:px-6 gap-3 sm:gap-5 shrink-0">
          {/* Menu mobile */}
          <button
            onClick={() => setMobileMenuOpen(true)}
            className="md:hidden p-2.5 hover:bg-muted rounded-xl transition-colors text-muted-foreground"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="hidden items-center gap-2 whitespace-nowrap lg:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" />
            <h1 className="text-sm font-semibold tracking-[-0.02em] text-foreground">HCM Industrial · Controle de Estoque</h1>
          </div>

          {/* Busca global centralizada */}
          <div className="flex-1 flex justify-center">
            <BuscaGlobal />
          </div>

          <BotaoLeitorQr />

          <button aria-label="Abrir configurações" className="hidden sm:block p-2.5 hover:bg-muted rounded-xl transition-colors shrink-0 text-muted-foreground hover:text-foreground">
            <Settings className="w-5 h-5 text-muted-foreground" />
          </button>
        </header>

        {/* Conteúdo da página */}
        <div className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8 xl:p-10 max-w-[1600px] w-full mx-auto">{children}</div>
        </div>
      </main>
    </div>
  );
}