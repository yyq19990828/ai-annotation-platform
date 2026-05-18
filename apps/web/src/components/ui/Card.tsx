import type { ReactNode, CSSProperties, MouseEvent } from "react";

import styles from "./Card.module.css";

interface CardProps {
  children: ReactNode;
  style?: CSSProperties;
  onClick?: (e: MouseEvent<HTMLDivElement>) => void;
}

export function Card({ children, style, onClick }: CardProps) {
  return (
    <div className={styles.card} onClick={onClick} style={style}>
      {children}
    </div>
  );
}
