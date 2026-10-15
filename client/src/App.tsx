import { useEffect } from "react";
import { ShieldOff } from "lucide-react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { usePermissao } from "@/_core/hooks/usePermissao";
import type { Permissao } from "@shared/permissoes";
import { StockDashboardLayout, navItems } from "@/components/StockDashboardLayout";
import Home from "./pages/Home";
import Materiais from "./pages/Materiais";
import Obras from "./pages/Obras";
import Movimentacoes from "./pages/Movimentacoes";
import Importacao from "./pages/Importacao";
import PlanoCorte from "./pages/PlanoCorte";
import Relatorios from "./pages/Relatorios";
import Ajuste from "./pages/Ajuste";
import Especificacoes from "./pages/Especificacoes";
import RegistrosSaida from "./pages/RegistrosSaida";
import RegistrosEntrada from "./pages/RegistrosEntrada";
import GrdsGeradas from "./pages/GrdsGeradas";
import RelatorioDivergencia from "./pages/RelatorioDivergencia";
import LinhaDoTempoMaterial from "./pages/LinhaDoTempoMaterial";
import LeitorQr from "./pages/LeitorQr";
import MateriaisAChegar from "./pages/MateriaisAChegar";
import Historico from "./pages/Historico";
import Solicitacoes from "./pages/Solicitacoes";
import { Inventario } from "./pages/Inventario";
import Usuarios from "./pages/Usuarios";
import Locais from "./pages/Locais";
import Limpeza from "./pages/Limpeza";
import ConfiguracoesPermissoes from "./pages/ConfiguracoesPermissoes";
import Login from "./pages/Login";

// ─── Spinner de carregamento ──────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="w-6 h-6 border-2 border-muted-foreground border-t-accent rounded-full animate-spin" />
        <span className="text-sm">Verificando acesso...</span>
      </div>
    </div>
  );
}

// ─── Guard de autenticação ────────────────────────────────────────────────────
function AuthGuard({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  // navigate NÃO pode ser chamado diretamente no render — deve ficar no useEffect
  useEffect(() => {
    if (!isLoading && !user) {
      navigate("/login");
    }
  }, [isLoading, user, navigate]);

  if (isLoading) return <LoadingScreen />;
  if (!user) return null;

  return <>{children}</>;
}

// ─── Guard de permissão granular ──────────────────────────────────────────────
// Bloqueia acesso direto por URL quando a permissão de "ver" da página está
// desligada para o role/usuário — espelha o filtro do menu lateral
// (client/src/components/StockDashboardLayout.tsx), que usa a mesma chave.
//
// Importante: NÃO redireciona pra "/" — se a própria "/" (dashboard:ver) for a
// página bloqueada, um navigate("/") vira um no-op (já está em "/"), deixando
// a tela em branco pra sempre sem nenhum jeito de navegar pra outro lugar. Em
// vez disso, renderiza o aviso dentro do StockDashboardLayout: o menu lateral
// (já filtrado pelas mesmas permissões) continua visível e clicável, então o
// usuário sempre tem como ir pra uma página que ele realmente tem acesso.
function RequirePermission({ permission, children }: { permission: Permissao; children: React.ReactNode }) {
  const { loading, isAuthenticated } = useAuth();
  const { pode } = usePermissao();
  const permitido = pode(permission);

  if (loading || !isAuthenticated) return null;

  if (!permitido) {
    return (
      <StockDashboardLayout>
        <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-muted-foreground">
          <ShieldOff className="w-10 h-10 text-muted-foreground/60" />
          <h2 className="text-lg font-semibold text-foreground">Acesso restrito</h2>
          <p className="max-w-sm text-sm">
            Você não tem permissão para acessar esta página. Escolha outra opção no menu ao lado ou fale com um administrador.
          </p>
        </div>
      </StockDashboardLayout>
    );
  }

  return <>{children}</>;
}

// Mapa rota → permissão de "ver", derivado do navItems do menu lateral (fonte
// única — evita duas listas divergentes entre menu e roteamento).
const ROTA_PERMISSAO = new Map<string, Permissao | undefined>(
  navItems.map((item) => [item.href, item.permission])
);

function protectedRoute(
  path: string,
  Component: React.ComponentType,
  permissionOverride?: Permissao
) {
  const permission = permissionOverride ?? ROTA_PERMISSAO.get(path);
  return (
    <Route
      key={path}
      path={path}
      component={() => (
        <AuthGuard>
          {permission ? (
            <RequirePermission permission={permission}>
              <Component />
            </RequirePermission>
          ) : (
            <Component />
          )}
        </AuthGuard>
      )}
    />
  );
}

// ─── Guard exclusivo para owner ───────────────────────────────────────────────
function OwnerGuard({ children }: { children: React.ReactNode }) {
  const [, navigate] = useLocation();
  const { data: user, isLoading } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!isLoading && user && user.role !== "owner") {
      navigate("/");
    }
  }, [isLoading, user, navigate]);

  if (isLoading) return <LoadingScreen />;
  if (!user) return null;
  if (user.role !== "owner") return null;

  return <>{children}</>;
}

// ─── Roteador ─────────────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      {/* Rota pública */}
      <Route path="/login" component={Login} />

      {/* Rotas protegidas — permissão de "ver" aplicada automaticamente a
          partir do navItems (StockDashboardLayout), quando existir */}
      {protectedRoute("/", Home)}
      {protectedRoute("/materiais", Materiais)}
      {protectedRoute("/solicitacoes", Solicitacoes)}
      {protectedRoute("/registros-saida", RegistrosSaida)}
      {protectedRoute("/registros-entrada", RegistrosEntrada)}
      {protectedRoute("/grds-geradas", GrdsGeradas)}
      {protectedRoute("/relatorio-divergencia", RelatorioDivergencia)}
      {protectedRoute("/linha-do-tempo", LinhaDoTempoMaterial)}
      {protectedRoute("/materiais-a-chegar", MateriaisAChegar)}
      {protectedRoute("/linha-do-tempo/:id", LinhaDoTempoMaterial, ROTA_PERMISSAO.get("/linha-do-tempo"))}
      {protectedRoute("/leitor", LeitorQr)}
      {protectedRoute("/historico", Historico)}
      {protectedRoute("/obras", Obras)}
      {protectedRoute("/movimentacoes", Movimentacoes)}
      {protectedRoute("/importacao", Importacao)}
      {protectedRoute("/plano-corte", PlanoCorte)}
      {protectedRoute("/relatorios", Relatorios)}
      {protectedRoute("/ajuste", Ajuste)}
      {protectedRoute("/especificacoes", Especificacoes)}
      {protectedRoute("/inventario", Inventario)}

      {/* Usuários e Locais agora são controlados pela permissão granular
          (usuarios:ver / locais:ver) em vez de role fixo — ver ROTA_PERMISSAO */}
      {protectedRoute("/usuarios", Usuarios)}
      {protectedRoute("/locais", Locais)}

      {/* Rota exclusiva para owner */}
      <Route path="/limpeza"  component={() => <OwnerGuard><Limpeza /></OwnerGuard>} />
      <Route path="/configuracoes/permissoes" component={() => <OwnerGuard><ConfiguracoesPermissoes /></OwnerGuard>} />

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;