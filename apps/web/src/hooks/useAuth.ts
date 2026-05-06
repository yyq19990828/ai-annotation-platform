import { useMutation } from "@tanstack/react-query";
import { authApi, type LoginPayload } from "../api/auth";
import { useAuthStore } from "../stores/authStore";

export function useLogin() {
  const { setToken, setUser } = useAuthStore();

  return useMutation({
    mutationFn: async (payload: LoginPayload) => {
      const { access_token } = await authApi.login(payload);
      setToken(access_token);
      const user = await authApi.me();
      setUser(user);
      return user;
    },
  });
}

export function useLogout() {
  const clearLocal = useAuthStore((s) => s.logout);
  return () => {
    authApi.logout().catch(() => {});
    clearLocal();
  };
}

export function useLogoutAll() {
  const { setToken } = useAuthStore();
  return useMutation({
    mutationFn: async () => {
      const { access_token } = await authApi.logoutAll();
      setToken(access_token);
    },
  });
}

export function useCurrentUser() {
  return useAuthStore((s) => s.user);
}
