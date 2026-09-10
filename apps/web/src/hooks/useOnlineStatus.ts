import { useEffect, useState } from "react";
import {
  countDurably,
  subscribe,
  type OfflineQueueScope,
} from "@/pages/Workbench/state/offlineQueue";

/**
 * 监听 navigator online/offline + 离线队列长度。
 *
 * 注：autoflush 由调用方注册到 online 事件；这个 hook 仅暴露状态。
 */
export function useOnlineStatus(scope?: OfflineQueueScope) {
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [queueCount, setQueueCount] = useState<number>(0);
  const [queueReady, setQueueReady] = useState(false);
  const [queueReadError, setQueueReadError] = useState<string | null>(null);
  const [readScope, setReadScope] = useState(scope);

  useEffect(() => {
    const onOn = () => setOnline(true);
    const onOff = () => setOnline(false);
    window.addEventListener("online", onOn);
    window.addEventListener("offline", onOff);
    return () => {
      window.removeEventListener("online", onOn);
      window.removeEventListener("offline", onOff);
    };
  }, []);

  useEffect(() => {
    let active = true;
    // Do not render the previous account's queue while the new scope is being read.
    setQueueCount(0);
    setQueueReady(false);
    setQueueReadError(null);
    const unsub = subscribe((next) => {
      if (active) {
        setReadScope(scope);
        setQueueCount(next);
        setQueueReady(true);
        setQueueReadError(null);
      }
    }, scope);
    void countDurably(scope).then(
      (next) => {
        if (active) {
          setReadScope(scope);
          setQueueCount(next);
          setQueueReady(true);
          setQueueReadError(null);
        }
      },
      () => {
        if (active) {
          setReadScope(scope);
          setQueueReady(false);
          setQueueReadError("无法读取本机待同步记录，请检查浏览器存储后重试");
        }
      },
    );
    return () => {
      active = false;
      unsub();
    };
  }, [scope]);

  return {
    online,
    queueCount: readScope === scope ? queueCount : 0,
    queueReady: readScope === scope && queueReady,
    queueReadError: readScope === scope ? queueReadError : null,
  };
}
