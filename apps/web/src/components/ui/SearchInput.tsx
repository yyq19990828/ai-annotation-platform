import { useLayoutEffect, useRef } from "react";
import { Icon } from "./Icon";
import styles from "./SearchInput.module.css";

interface SearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  width?: number;
  kbd?: string;
  /** v0.7.2 · TopBar 用作 ⌘K palette 触发；点击外壳即调用 onClick。 */
  onClick?: () => void;
  /** v0.7.2 · 与 onClick 配合：只读，避免 input 拿到焦点抢键盘事件。 */
  readOnly?: boolean;
}

export function SearchInput({
  placeholder = "搜索...",
  value,
  onChange,
  width = 240,
  kbd,
  onClick,
  readOnly,
}: SearchInputProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    rootRef.current?.style.setProperty("--search-input-width", `${width}px`);
  }, [width]);

  return (
    <div
      ref={rootRef}
      onClick={onClick}
      className={`${styles.root} ${onClick ? styles.clickable : ""}`}
    >
      <Icon name="search" size={13} className={styles.icon} />
      <input
        placeholder={placeholder}
        value={value}
        onChange={e => onChange?.(e.target.value)}
        readOnly={readOnly}
        className={`${styles.input} ${onClick ? styles.clickable : ""}`}
      />
      {kbd && (
        <span className={styles.kbd}>
          {kbd}
        </span>
      )}
    </div>
  );
}
