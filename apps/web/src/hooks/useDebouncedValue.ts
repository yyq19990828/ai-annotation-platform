import { useEffect, useRef, useState } from "react";

export function useDebouncedValue<T>(value: T, delay = 250, immediateKey?: unknown): T {
  const [debounced, setDebounced] = useState(value);
  const previousImmediateKey = useRef(immediateKey);
  const immediateKeyChanged = previousImmediateKey.current !== immediateKey;
  useEffect(() => {
    if (previousImmediateKey.current !== immediateKey) {
      previousImmediateKey.current = immediateKey;
      setDebounced(value);
      return;
    }
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, immediateKey, value]);
  return immediateKeyChanged ? value : debounced;
}
