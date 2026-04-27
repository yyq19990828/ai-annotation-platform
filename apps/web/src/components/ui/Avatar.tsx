interface AvatarProps {
  initial: string;
  size?: "sm" | "md" | "lg";
  style?: React.CSSProperties;
}

const sizes = {
  sm: { width: 20, height: 20, fontSize: 10 },
  md: { width: 28, height: 28, fontSize: 12 },
  lg: { width: 36, height: 36, fontSize: 14 },
};

export function Avatar({ initial, size = "sm", style }: AvatarProps) {
  const s = sizes[size];
  return (
    <div
      style={{
        ...s,
        borderRadius: "50%",
        background: "linear-gradient(135deg, oklch(0.7 0.12 30), oklch(0.6 0.18 350))",
        color: "white",
        fontWeight: 600,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        ...style,
      }}
    >
      {initial}
    </div>
  );
}
