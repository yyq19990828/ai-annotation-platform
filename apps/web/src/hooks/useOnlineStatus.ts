import { useEffect, useState } from "react";
import { count, subscribe } from "@/pages/Workbench/state/offlineQueue";

/**
 * 监听 navigator online/offline + 离线队列长度。
 *
 * 注：autoflush 由调用方注册到 online 事件；这个 hook 仅暴露状态。
 */
export function useOnlineStatus() {
  const [online, setOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [queueCount, setQueueCount] = useState<number>(0);

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
    const unsub = subscribe(setQueueCount);
    count().then(setQueueCount);
    return unsub;
  }, []);

  return { online, queueCount };
}
