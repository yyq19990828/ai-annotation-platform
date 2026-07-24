import { useCallback, useEffect, useRef } from "react";
import { projectsApi } from "@/api/projects";

/** v0.10.13 · E1 · annotation guide 图片资源上传 / 签发 / 删除. */
export function useGuideAssets(projectId: string | undefined) {
  // 同一 key 同时多次签发会浪费 storage round-trip; 加内存缓存 (短期 1h, expires_in=3600).
  const urlCacheRef = useRef<Map<string, { url: string; until: number }>>(new Map());

  useEffect(() => {
    // projectId 变更或卸载时清缓存, 防跨项目串味.
    urlCacheRef.current.clear();
  }, [projectId]);

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
      await projectsApi.guideAssets.remove(projectId, key);
      urlCacheRef.current.delete(key);
    },
    [projectId],
  );

  const signAsset = useCallback(
    async (key: string): Promise<string> => {
      if (!projectId) throw new Error("projectId is required");
      const cached = urlCacheRef.current.get(key);
      const now = Date.now();
      // 留 60s 安全垫, 早于过期就重签
      if (cached && cached.until - now > 60_000) return cached.url;
      const resp = await projectsApi.guideAssets.signUrl(projectId, key);
      urlCacheRef.current.set(key, {
        url: resp.url,
        until: now + resp.expires_in * 1000,
      });
      return resp.url;
    },
    [projectId],
  );

  return { uploadAsset, deleteAsset, signAsset };
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
