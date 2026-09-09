import { useCallback, useMemo, useState } from "react";
import { authApi, type OnboardingProjectState, type UserPreferences } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";
import { isGuideSeen } from "@/utils/annotationGuide";

/**
 * The checklist is a user preference, but its completion is still derived from
 * real project/task state by the caller.  This hook only owns the durable
 * per-user dismissal and guide-reading acknowledgement.
 */
export function useOnboardingProjectState(projectId: string, guideVersion: string) {
  const user = useAuthStore((state) => state.user);
  const setUser = useAuthStore((state) => state.setUser);
  const [isSaving, setIsSaving] = useState(false);

  const stored = user?.preferences?.onboarding?.projects?.[projectId];
  const matchesVersion = stored?.guide_version === guideVersion;
  const guideReadFromStorage = isGuideSeen(user?.id, projectId, guideVersion);

  const state = useMemo(
    () => ({
      dismissed: matchesVersion ? Boolean(stored?.dismissed) : false,
      guideRead: (matchesVersion && Boolean(stored?.guide_read)) || guideReadFromStorage,
    }),
    [guideReadFromStorage, matchesVersion, stored?.dismissed, stored?.guide_read],
  );

  const save = useCallback(
    async (patch: Partial<OnboardingProjectState>) => {
      if (!user) return;
      const previousPreferences = user.preferences ?? {};
      const previousProjects = previousPreferences.onboarding?.projects ?? {};
      const previous = previousProjects[projectId];
      const nextState: OnboardingProjectState = {
        guide_version: guideVersion,
        dismissed: previous?.guide_version === guideVersion ? previous.dismissed : false,
        guide_read: previous?.guide_version === guideVersion ? previous.guide_read : false,
        ...patch,
      };
      const projects = { ...previousProjects, [projectId]: nextState };
      const nextPreferences = {
        ...previousPreferences,
        onboarding: { ...(previousPreferences.onboarding ?? {}), projects },
      };
      setUser({ ...user, preferences: nextPreferences });
      setIsSaving(true);
      try {
        await authApi.updatePreferences({ onboarding: { projects } });
      } catch {
        // Keep the optimistic state. The next authenticated refresh will
        // reconcile a failed write, while local guide-seen state still works
        // when the user is temporarily offline.
      } finally {
        setIsSaving(false);
      }
    },
    [guideVersion, projectId, setUser, user],
  );

  const dismiss = useCallback(() => save({ dismissed: true }), [save]);
  const reopen = useCallback(() => save({ dismissed: false }), [save]);
  const markGuideRead = useCallback(() => save({ guide_read: true }), [save]);

  return { ...state, isSaving, dismiss, reopen, markGuideRead };
}

/** Narrow helper for tests and consumers that need the current preference map. */
export function onboardingProjects(prefs: UserPreferences | undefined) {
  return prefs?.onboarding?.projects ?? {};
}
