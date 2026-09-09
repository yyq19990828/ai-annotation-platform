import { useContext, useEffect } from "react";
import { UNSAFE_NavigationContext } from "react-router-dom";

let activeTraversalGuard: ((event: PopStateEvent) => void) | undefined;

/** Register before BrowserRouter so a rejected pop cannot unmount the form. */
export function bindSettingsHistoryGuard() {
  const onPopState = (event: PopStateEvent) => activeTraversalGuard?.(event);
  window.addEventListener("popstate", onPopState);
  return () => window.removeEventListener("popstate", onPopState);
}

/** Guard this BrowserRouter form, including browser back/forward traversal. */
export function useUnsavedSettingsGuard(dirty: boolean) {
  const navigation = useContext(UNSAFE_NavigationContext);
  useEffect(() => {
    if (!dirty || !navigation) return;
    const navigator = navigation.navigator;
    const confirmLeave = () => window.confirm("系统设置有未保存修改，确定离开吗？");
    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    const guardedPush: typeof navigator.push = (...args) => {
      if (confirmLeave()) originalPush.apply(navigator, args);
    };
    const guardedReplace: typeof navigator.replace = (...args) => {
      if (confirmLeave()) originalReplace.apply(navigator, args);
    };
    navigator.push = guardedPush;
    navigator.replace = guardedReplace;

    // BrowserRouter records an index for same-document history entries. The
    // bootstrap listener runs first so rejecting a traversal keeps the form
    // mounted while restoring the previously accepted URL/index.
    let currentIndex: unknown = window.history.state?.idx;
    let restoring = false;
    const onPopState = (event: PopStateEvent) => {
      const nextIndex: unknown = event.state?.idx;
      if (restoring) {
        restoring = false;
        event.stopImmediatePropagation();
        return;
      }
      if (
        typeof currentIndex === "number" &&
        typeof nextIndex === "number" &&
        nextIndex !== currentIndex &&
        !confirmLeave()
      ) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(currentIndex - nextIndex);
        return;
      }
      currentIndex = nextIndex;
    };
    activeTraversalGuard = onPopState;
    return () => {
      if (navigator.push === guardedPush) navigator.push = originalPush;
      if (navigator.replace === guardedReplace) navigator.replace = originalReplace;
      if (activeTraversalGuard === onPopState) activeTraversalGuard = undefined;
    };
  }, [dirty, navigation]);
}
