import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { Eye, EyeOff, LogIn, ShieldCheck } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const utils = trpc.useUtils();

  const loginMutation = trpc.auth.login.useMutation({
    onSuccess: async () => {
      // Força o recarregamento do user ANTES de navegar
      // para que o AuthGuard já encontre a sessão válida
      await utils.auth.me.refetch();
      toast.success("Login realizado com sucesso!");
      navigate("/");
    },
    onError: (err) => {
      toast.error(err.message || "E-mail ou senha incorretos.");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !senha.trim()) {
      toast.warning("Preencha e-mail e senha.");
      return;
    }
    loginMutation.mutate({ email: email.trim(), senha: senha });
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background flex items-center justify-center p-4 sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-accent/14 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-40 -right-28 h-[30rem] w-[30rem] rounded-full bg-primary/8 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-transparent via-accent to-transparent opacity-80" />
      <div className="relative z-10 w-full max-w-[27rem] space-y-7">

        {/* Logo */}
        <div className="text-center space-y-3">
          <div className="mx-auto mb-2 flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-[1.35rem] p-3 shadow-xl shadow-primary/15 ring-8 ring-accent/10">
            <img src="/brand/hcm-industrial.svg" alt="HCM Industrial" className="h-full w-full object-contain" />
          </div>
          <p className="eyebrow text-accent-foreground">HCM · Engenharia Industrial</p>
          <h1 className="text-3xl font-bold tracking-[-0.045em] text-foreground">Controle de Estoque</h1>
          <p className="mx-auto max-w-xs text-sm leading-relaxed text-muted-foreground">
            Precisão na matéria-prima, rastreabilidade nas movimentações e apoio à produção.
          </p>
        </div>

        {/* Card de login */}
        <Card className="relative overflow-hidden p-7 border-border/70 bg-card/95 shadow-[0_24px_70px_-38px_color-mix(in_oklch,var(--primary)_55%,transparent)] backdrop-blur-sm">
          <div aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-accent" />
          <div className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-accent" />
            Acesso corporativo HCM
          </div>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">E-mail</label>
              <Input
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                disabled={loginMutation.isPending}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Senha</label>
              <div className="relative">
                <Input
                  type={mostrarSenha ? "text" : "password"}
                  placeholder="••••••••"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  autoComplete="current-password"
                  disabled={loginMutation.isPending}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setMostrarSenha(!mostrarSenha)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                >
                  {mostrarSenha
                    ? <EyeOff className="w-4 h-4" />
                    : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              className="mt-2 h-11 w-full gap-2"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Entrando...
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" />
                  Entrar
                </>
              )}
            </Button>
          </form>
        </Card>

        <p className="mx-auto max-w-xs text-center text-xs leading-relaxed text-muted-foreground/80">
          Problemas para acessar? Contate o administrador do sistema.
        </p>
      </div>
    </div>
  );
}
