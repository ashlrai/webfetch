/**
 * Inline SVG icon set. ~1.5KB total, zero deps, consistent 16×16 stroke-based.
 * Style: Lucide/Feather-esque, 1.5 stroke, round caps.
 */

export type IconName =
  | "grid" | "key" | "bar" | "plug" | "users" | "card" | "shield" | "cog"
  | "search" | "plus" | "chevron" | "menu" | "x" | "copy" | "check"
  | "trash" | "out" | "book" | "eye" | "eye-off" | "download" | "arrow-up"
  | "arrow-down" | "external" | "info" | "alert" | "clock" | "filter";

const P: Record<IconName, React.ReactNode> = {
  grid:   <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></>,
  key:    <><circle cx="5" cy="11" r="2.5"/><path d="M6.8 9.2l6.7-6.7M11 5l2 2M9 7l2 2"/></>,
  bar:    <><path d="M3 13V8M8 13V3M13 13V6"/></>,
  plug:   <><path d="M5 2v3M11 2v3M3.5 5h9v3.5a4.5 4.5 0 0 1-9 0V5zM8 13v1.5"/></>,
  users:  <><circle cx="6" cy="6" r="2.5"/><path d="M2 13.5c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5M11 10a2.5 2.5 0 1 0 0-5M14 13.5c0-1.7-1.3-3-3-3.2"/></>,
  card:   <><rect x="2" y="3.5" width="12" height="9" rx="1.5"/><path d="M2 6.5h12M4.5 10h2"/></>,
  shield: <><path d="M8 2l5 2v4c0 3-2 5.5-5 6-3-.5-5-3-5-6V4l5-2z"/></>,
  cog:    <><circle cx="8" cy="8" r="2"/><path d="M8 1.5V3M8 13v1.5M14.5 8H13M3 8H1.5M12.6 3.4l-1 1M4.4 11.6l-1 1M12.6 12.6l-1-1M4.4 4.4l-1-1"/></>,
  search: <><circle cx="7" cy="7" r="4"/><path d="M10 10l3.5 3.5"/></>,
  plus:   <><path d="M8 3.5v9M3.5 8h9"/></>,
  chevron: <><path d="M4 6l4 4 4-4"/></>,
  menu:   <><path d="M2.5 4h11M2.5 8h11M2.5 12h11"/></>,
  x:      <><path d="M4 4l8 8M12 4l-8 8"/></>,
  copy:   <><rect x="5" y="5" width="8.5" height="8.5" rx="1.5"/><path d="M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h6A1.5 1.5 0 0 1 10.5 3v.5"/></>,
  check:  <><path d="M3 8.5L6.5 12 13 4.5"/></>,
  trash:  <><path d="M3 4.5h10M6 4.5V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5M4.5 4.5l.7 8.5a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8.5"/></>,
  out:    <><path d="M9.5 3h3v10h-3M9 5.5L11.5 8 9 10.5M2 8h9.5"/></>,
  book:   <><path d="M2.5 2.5h5a2 2 0 0 1 2 2v9a1.5 1.5 0 0 0-1.5-1.5h-5.5V2.5zM13.5 2.5h-5a2 2 0 0 0-2 2v9a1.5 1.5 0 0 1 1.5-1.5h5.5V2.5z"/></>,
  eye:    <><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.8"/></>,
  "eye-off": <><path d="M2 2l12 12M6.5 3.8A7 7 0 0 1 8 3.5c4 0 6.5 4.5 6.5 4.5a12.7 12.7 0 0 1-2.3 2.8M4 5.2C2.5 6.5 1.5 8 1.5 8S4 12.5 8 12.5a7 7 0 0 0 2.5-.5"/></>,
  download: <><path d="M8 2v8M5 7l3 3 3-3M2.5 13.5h11"/></>,
  "arrow-up": <><path d="M8 13V3M4 7l4-4 4 4"/></>,
  "arrow-down": <><path d="M8 3v10M4 9l4 4 4-4"/></>,
  external: <><path d="M9 2.5h4.5V7M13 3L7 9M11 8.5V13H3V5h4.5"/></>,
  info:   <><circle cx="8" cy="8" r="6"/><path d="M8 7.5v3.5M8 5v.5"/></>,
  alert:  <><path d="M8 2l6.5 11.5h-13z"/><path d="M8 6.5v3M8 11v.5"/></>,
  clock:  <><circle cx="8" cy="8" r="6"/><path d="M8 4.5V8l2.5 2"/></>,
  filter: <><path d="M2 3.5h12L9.5 9v3L6.5 13.5v-4.5L2 3.5z"/></>,
};

export function Icon({
  name,
  size = 14,
  className,
  style,
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      {P[name]}
    </svg>
  );
}
