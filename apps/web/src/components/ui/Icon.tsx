import React from "react";

const iconPaths: Record<string, string> = {
  dashboard: "M3 3h7v8H3zM12 3h6v5h-6zM3 13h7v5H3zM12 10h6v8h-6z",
  folder: "M3 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  box: "M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10",
  users: "M16 14a4 4 0 0 0-8 0v3h8zM12 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 14a3 3 0 0 0-2-2.83",
  user: "M12 13a4 4 0 0 0-4 4v2h8v-2a4 4 0 0 0-4-4zM12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  settings:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  bell: "M6 14V9a6 6 0 0 1 12 0v5l1.5 2h-15zM10 18a2 2 0 0 0 4 0",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l4 4",
  plus: "M12 5v14M5 12h14",
  chevDown: "M6 9l6 6 6-6",
  chevRight: "M9 6l6 6-6 6",
  chevLeft: "M15 6l-6 6 6 6",
  sparkles:
    "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8z",
  bot: "M7 10h10a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2zM12 6v4M9 14h.01M15 14h.01",
  target:
    "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
  check: "M5 12l5 5 9-11",
  x: "M6 6l12 12M6 18L18 6",
  trash:
    "M5 7h14M10 7V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2M7 7v12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V7",
  edit: "M4 20h4l10-10-4-4L4 16zM14 6l4 4",
  upload: "M12 4v12M6 10l6-6 6 6M4 18h16v2H4z",
  download: "M12 4v12M6 12l6 6 6-6M4 20h16",
  play: "M7 5l11 7-11 7z",
  pause: "M7 5h3v14H7zM14 5h3v14h-3z",
  db: "M5 5c0-1.1 3.1-2 7-2s7 .9 7 2v14c0 1.1-3.1 2-7 2s-7-.9-7-2zM5 5c0 1.1 3.1 2 7 2s7-.9 7-2M5 11c0 1.1 3.1 2 7 2s7-.9 7-2",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  filter: "M5 5h14l-5 7v6l-4-2v-4z",
  refresh:
    "M4 11a8 8 0 0 1 14-5l3-1M20 13a8 8 0 0 1-14 5l-3 1M19 4v5h-5M5 20v-5h5",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  list: "M4 6h16M4 12h16M4 18h16",
  rect: "M4 6h16v12H4z",
  polygon: "M4 7l8-4 8 4v10l-8 4-8-4z",
  point: "M12 12m-3 0a3 3 0 1 0 6 0 3 3 0 1 0-6 0",
  move: "M12 4v16M4 12h16M9 7l3-3 3 3M7 9l-3 3 3 3M17 9l3 3-3 3M9 17l3 3 3-3",
  zoomIn:
    "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l4 4M11 8v6M8 11h6",
  zoomOut: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM16 16l4 4M8 11h6",
  save: "M5 5h11l3 3v11H5zM8 5v6h7V5M8 19v-6h7v6",
  flag: "M5 4v17M5 4h12l-2 4 2 4H5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  activity: "M3 12h4l3-7 4 14 3-7h4",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  key: "M14 7a4 4 0 1 1-4 4M10 11l-7 7v3h3l1-1v-2h2v-2h2l1-1",
  link: "M9 15a4 4 0 0 1 0-6l3-3a4 4 0 1 1 6 6l-1 1M15 9a4 4 0 0 1 0 6l-3 3a4 4 0 1 1-6-6l1-1",
  folderOpen:
    "M3 8a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v1H3zM3 11h18l-2 7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  image:
    "M4 5h16v14H4zM4 15l4-4 5 5 3-3 4 4M9 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  cube: "M12 3l9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v10",
  video: "M3 6h12v12H3zM15 10l6-3v10l-6-3z",
  mm: "M4 5h10v8H4zM14 13l4 4M16 9l4 4M9 9h.01",
  eyeOff:
    "M17.9 17.9A10 10 0 0 1 2 12s3-7 10-7a10 10 0 0 1 5.9 2.1M6.1 6.1A10 10 0 0 0 2 12s4 7 10 7a10 10 0 0 0 5.9-2.1M2 2l20 20M12 15a3 3 0 0 1-3-3m3.3-5.7A3 3 0 0 1 15 9",
  warning:
    "M12 4L2 20h20zM12 9v5M12 17h.01",
  logout:
    "M9 5H7a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2M15 16l4-4-4-4M9 12h11",
};

export type IconName = keyof typeof iconPaths;

interface IconProps {
  name: IconName;
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}

export function Icon({ name, size = 16, stroke = 1.6, style }: IconProps) {
  const d = iconPaths[name as string];
  if (!d) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      <path d={d} />
    </svg>
  );
}
