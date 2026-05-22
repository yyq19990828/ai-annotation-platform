import { useCallback, useState } from "react";

type CanvasContextMenuState = {
  open: boolean;
  x: number;
  y: number;
};

export function useCanvasContextMenu() {
  const [state, setState] = useState<CanvasContextMenuState>({
    open: false,
    x: 0,
    y: 0,
  });

  const openAt = useCallback((x: number, y: number) => {
    setState({ open: true, x, y });
  }, []);

  const close = useCallback(() => {
    setState((cur) => (cur.open ? { ...cur, open: false } : cur));
  }, []);

  return {
    ...state,
    openAt,
    close,
  };
}
