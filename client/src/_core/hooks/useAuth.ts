import { trpc } from "@/lib/trpc";
import { useCallback } from "react";

export function useAuth() {
  const utils = trpc.useUtils();
  const { data: user, isLoading: loading, error } = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
      utils.auth.me.invalidate();
      window.location.href = "/login";
    },
  });

  const logout = useCallback(async () => {
    await logoutMutation.mutateAsync();
  }, [logoutMutation]);

  const role = user?.role;

  return {
    user: user ?? null,
    loading,
    error,
    isAuthenticated: !!user,
    isAdmin: role === "admin" || role === "owner",
    isSupervisor: role === "supervisor",
    isOperator: role === "operator",
    isViewer: role === "viewer",
    role,
    logout,
  };
}