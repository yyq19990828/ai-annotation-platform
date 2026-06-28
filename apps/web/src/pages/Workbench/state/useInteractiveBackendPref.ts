import { useCallback, useEffect, useRef, useState } from "react";
import { authApi } from "@/api/auth";
import { useAuthStore } from "@/stores/authStore";

/**
 * v0.18.31 · 工作台「交互后端(引擎)选择」的用户级偏好, 按 project 分桶。
 *
 * 修 BUG: 此前交互后端选择存 localStorage (`wb:preferred-interactive`), 不跨设备 / 不跨标签页;
 * 现迁到 `User.preferences.ai.interactive_backend_by_project`, 与 {@link useAiToolModelPref}
 * (model_by_backend) / useAiToolParamPrefs (params_by_backend) 对齐 —— 跟用户走、跨设备,
 * 后端 `ai` 子树「深一层合并」故三键各自独立保存、互不覆盖。
 *
 * 按 project 分桶:「这个项目用哪个交互后端」是 per-project 的个人选择 (与 model 选择按
 * backend 分桶是有意区别, 见 epic plan §5 决策 2)。
 *
 * 读取优先级链由 {@link useBackendRouting} 实现: 本会话显式切换 > 本偏好 (savedBackendId) >
 * 项目默认 / 首个交互后端。
 */
export function useInteractiveBackendPref(projectId: string | null | undefined) {
  const userId = useAuthStore((s) => s.user?.id);
  const [byProject, setByProject] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const pendingRef = useRef<Record<string, string> | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    if (!userId) {
      // 切账号/登出: 清掉上一个用户的 byProject + 取消任何 pending 写, 否则下一个用户首渲染
      // useBackendRouting.preferredOverride 会读到上一个用户的项目→后端映射 (issue claude[bot] P1).
      setByProject({});
      pendingRef.current = null;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setLoaded(false);
      return;
    }
    authApi
      .getPreferences()
      .then((res) => {
        if (!active) return;
        setByProject(res.ai?.interactive_backend_by_project ?? {});
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [userId]);

  useEffect(() => {
    return () => {
      // 切完后端立刻离开 workbench → 节流 pending 还在 timer 里, 不 flush 这次选择会丢
      // (违背"跨设备持久化"承诺, 见 issue claude[bot] P1)。fire-and-forget flush。
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        const payload = pendingRef.current;
        if (payload) {
          authApi
            .updatePreferences({ ai: { interactive_backend_by_project: payload } })
            .catch(() => {});
          pendingRef.current = null;
        }
      }
    };
  }, []);

  const savedBackendId = projectId ? byProject[projectId] : undefined;

  const save = useCallback(
    (backendId: string | null) => {
      if (!projectId) return;
      setByProject((prev) => {
        const next = { ...prev };
        if (backendId) next[projectId] = backendId;
        else delete next[projectId];
        pendingRef.current = next;
        return next;
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const payload = pendingRef.current;
        if (!payload) return;
        authApi
          .updatePreferences({ ai: { interactive_backend_by_project: payload } })
          .catch(() => {});
      }, 600);
    },
    [projectId],
  );

  return { savedBackendId, loaded, save };
}
