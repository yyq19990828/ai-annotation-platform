import type { ReactNode, CSSProperties, MouseEvent } from "react";

import styles from "./Card.module.css";
import { useElementStyle } from "./useElementStyle";

interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function Card({ children, style, onClick }: CardProps) {
  const styleRef = useElementStyle<HTMLDivElement>(style);
  return (
    <div ref={styleRef} className={styles.card} onClick={onClick}>
      {children}
    </div>
  );
}
