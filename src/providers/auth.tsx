import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, onAuthProblem, setCsrfToken } from "@/lib/api";
import type { User } from "@/lib/types";

type AuthState = {
  user: User | null;
  isLoading: boolean;
  isManager: boolean;
  isAdmin: boolean;
  login: (identifier: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);
const ME_KEY = ["auth", "me"];

async function fetchMe(): Promise<User | null> {
  try {
    const data = await api.get<{ user: User; csrfToken: string }>("/auth/me");
    setCsrfToken(data.csrfToken);
    return data.user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 5 * 60_000, retry: 1 });

  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ME_KEY });
  }, [queryClient]);

  // Session expired or password change required elsewhere → re-check who we are.
  useEffect(
    () =>
      onAuthProblem((error) => {
        if (error.status === 401) {
          queryClient.setQueryData(ME_KEY, null);
          queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
        } else {
          void refresh();
        }
      }),
    [queryClient, refresh],
  );

  const login = useCallback(
    async (identifier: string, password: string) => {
      await api.post("/auth/login", { identifier, password });
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
      const user = await queryClient.fetchQuery({ queryKey: ME_KEY, queryFn: fetchMe, staleTime: 0 });
      if (!user) throw new Error("Sign-in failed. Please try again.");
      return user;
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.post("/auth/logout");
    } finally {
      setCsrfToken(null);
      queryClient.clear();
      queryClient.setQueryData(ME_KEY, null);
    }
  }, [queryClient]);

  const value = useMemo<AuthState>(() => {
    const user = me.data ?? null;
    return {
      user,
      isLoading: me.isLoading,
      isManager: user?.role === "manager" || user?.role === "admin",
      isAdmin: user?.role === "admin",
      login,
      logout,
      refresh,
    };
  }, [me.data, me.isLoading, login, logout, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}
