import { useEffect } from "react";

/**
 * B-6 · 当 dirty 时阻止刷新/关闭页面，浏览器会弹原生确认。
 */
export function useUnsavedWarning(dirty: boolean, message = "你有未保存的修改,确定离开吗?") {
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = message;
      return message;
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty, message]);
}
