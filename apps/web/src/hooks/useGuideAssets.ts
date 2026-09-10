import { useCallback, useRef } from "react";
import { projectsApi } from "@/api/projects";
import type { MarkdownImageResolver } from "@/components/markdown/types";

/** v0.10.13 · E1 · annotation guide 图片资源上传 / 签发 / 删除. */
export function useGuideAssets(projectId: string | undefined) {
  type CachedUrl = { url: string; expiresAt: number };

  // The hook can stay mounted while a workbench switches projects. Update the
  // scope during render so a new callback can never observe the old cache,
  // even before React runs the next effect.
  const projectScopeRef = useRef<string | undefined>(projectId);
  const scopeVersionRef = useRef(0);
  const urlCacheRef = useRef<Map<string, CachedUrl>>(new Map());
  const inFlightRef = useRef<Map<string, Promise<CachedUrl>>>(new Map());
  if (projectScopeRef.current !== projectId) {
    projectScopeRef.current = projectId;
    scopeVersionRef.current += 1;
    urlCacheRef.current.clear();
    inFlightRef.current.clear();
  }

  const signAssetInternal = useCallback(
    async (key: string, options?: { refresh?: boolean }): Promise<CachedUrl> => {
      if (!projectId) throw new Error("projectId is required");
      if (!key) throw new Error("guide asset key is required");
      if (projectScopeRef.current !== projectId) {
        throw new Error("project context changed");
      }

      const scopeVersion = scopeVersionRef.current;
      const cached = urlCacheRef.current.get(key);
      const now = Date.now();
      const forceRefresh = options?.refresh === true;
      // Leave a 60s safety margin before expiry. A forced refresh always
      // bypasses cache, while concurrent callers still share one request.
      if (!forceRefresh && cached && cached.expiresAt - now > 60_000) return cached;

      const existing = inFlightRef.current.get(key);
      if (existing) return existing;

      const request = projectsApi.guideAssets.signUrl(projectId, key).then((resp) => {
        const entry: CachedUrl = {
          url: resp.url,
          expiresAt: Date.now() + Math.max(0, resp.expires_in) * 1000,
        };
        // A response from the previous project may complete after the hook
        // has switched scopes. It remains useful to that old caller, but is
        // never allowed to populate the current project's cache.
        if (scopeVersion === scopeVersionRef.current && projectScopeRef.current === projectId) {
          urlCacheRef.current.set(key, entry);
        }
        return entry;
      });

      inFlightRef.current.set(key, request);
      const clearInFlight = () => {
        if (inFlightRef.current.get(key) === request) inFlightRef.current.delete(key);
      };
      request.then(clearInFlight, clearInFlight);
      return request;
    },
    [projectId],
  );

  const uploadAsset = useCallback(
    async (file: File): Promise<{ src: string; alt?: string }> => {
      if (!projectId) throw new Error("projectId is required");
      const init = await projectsApi.guideAssets.uploadInit(projectId, {
        filename: file.name,
        content_type: file.type || "application/octet-stream",
        size: file.size,
      });
      const putRes = await fetch(init.upload_url, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`storage upload failed: ${putRes.status}`);
      }
      const entry = await projectsApi.guideAssets.uploadComplete(projectId, {
        key: init.key,
        original_name: file.name,
        content_type: file.type || "application/octet-stream",
      });
      return { src: `guide-asset:${entry.key}`, alt: file.name };
    },
    [projectId],
  );

  const deleteAsset = useCallback(
    async (key: string) => {
      if (!projectId) throw new Error("projectId is required");
      const scopeVersion = scopeVersionRef.current;
      await projectsApi.guideAssets.remove(projectId, key);
      if (scopeVersion === scopeVersionRef.current && projectScopeRef.current === projectId) {
        urlCacheRef.current.delete(key);
      }
    },
    [projectId],
  );

  const signAsset = useCallback(
    async (key: string, options?: { refresh?: boolean }): Promise<string> => {
      const result = await signAssetInternal(key, options);
      return result.url;
    },
    [signAssetInternal],
  );

  const resolveImage = useCallback<MarkdownImageResolver>(
    async (src, options) => {
      if (!src.startsWith("guide-asset:")) {
        throw new Error("仅支持解析 guide-asset 图片资源");
      }
      const key = src.slice("guide-asset:".length);
      if (!key) throw new Error("guide-asset 图片缺少资源标识");
      const result = await signAssetInternal(key, options);
      return { url: result.url, expiresAt: result.expiresAt };
    },
    [signAssetInternal],
  );

  return { uploadAsset, deleteAsset, signAsset, resolveImage };
}

/** 把 markdown 里 `guide-asset:KEY` 形式的 src 转成签名 URL (用于预览). */
export function rewriteGuideAssetSrc(
  src: string,
  resolver: (key: string) => Promise<string>,
): { resolvedSrc: string; pending: boolean; key: string | null } {
  if (!src.startsWith("guide-asset:")) {
    return { resolvedSrc: src, pending: false, key: null };
  }
  const key = src.slice("guide-asset:".length);
  // 立即返回 placeholder; 调用方通过 effect 异步替换 src
  void resolver(key);
  return { resolvedSrc: "", pending: true, key };
}
