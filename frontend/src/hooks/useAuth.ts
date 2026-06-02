import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authApi } from "@/lib/api";
import { useAuthStore } from "@/stores/auth.store";
import type { LoginRequest } from "@/types/auth";

export function useLogin(): {
  login: (payload: LoginRequest) => Promise<void>;
  isLoading: boolean;
  error: string | null;
} {
  const navigate = useNavigate();
  const setSession = useAuthStore((state) => state.setSession);

  const mutation = useMutation({
    mutationFn: async (payload: LoginRequest) => {
      const companyId = payload.company_id;
      if (!companyId) {
        throw new Error("กรุณากรอก Company ID");
      }

      const response = await authApi.login(payload, companyId);
      return { companyId, tokenResponse: response.data.data };
    },
    onSuccess: ({ companyId, tokenResponse }) => {
      setSession(tokenResponse, companyId);
      window.localStorage.setItem("last_company_id", companyId);
      navigate("/dashboard", { replace: true });
    }
  });

  return {
    login: async (payload) => {
      await mutation.mutateAsync(payload);
    },
    isLoading: mutation.isPending,
    error: mutation.error instanceof Error ? mutation.error.message : null
  };
}

export function useLogout(): () => void {
  const navigate = useNavigate();
  const clearSession = useAuthStore((state) => state.clearSession);

  return () => {
    const refreshToken = useAuthStore.getState().refreshToken;
    if (refreshToken) {
      void authApi.logout(refreshToken);
    }
    clearSession();
    navigate("/login", { replace: true });
  };
}

export function useMe() {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);

  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: async () => {
      const response = await authApi.me();
      return response.data.data;
    },
    enabled: isAuthenticated()
  });
}
