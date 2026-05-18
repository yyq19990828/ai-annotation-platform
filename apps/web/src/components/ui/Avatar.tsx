import { clsx } from "clsx";

import styles from "./Avatar.module.css";

interface AvatarProps {
  initial: string;
  size?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}

const sizeClassNames: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: styles.sm,
  md: styles.md,
  lg: styles.lg,
};

export function Avatar({ initial, size = "sm", style }: AvatarProps) {
  return (
    <div className={clsx(styles.avatar, sizeClassNames[size])} style={style}>
      {initial}
    </div>
  );
}
