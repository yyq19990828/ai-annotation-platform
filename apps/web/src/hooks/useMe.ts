import { useMutation, useQueryClient } from "@tanstack/react-query";
import { meApi, type PasswordChangePayload, type ProfileUpdatePayload } from "../api/me";
import { useAuthStore } from "../stores/authStore";

export function useUpdateProfile() {
  const qc = useQueryClient();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: (payload: ProfileUpdatePayload) => meApi.updateProfile(payload),
    onSuccess: (user) => {
      if (token) setAuth(token, user);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (payload: PasswordChangePayload) => meApi.changePassword(payload),
  });
}

export function useRequestDeactivation() {
  const qc = useQueryClient();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: (reason: string) => meApi.requestDeactivation(reason),
    onSuccess: (user) => {
      if (token) setAuth(token, user);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}

export function useCancelDeactivation() {
  const qc = useQueryClient();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  return useMutation({
    mutationFn: () => meApi.cancelDeactivation(),
    onSuccess: (user) => {
      if (token) setAuth(token, user);
      qc.invalidateQueries({ queryKey: ["me"] });
    },
  });
}
