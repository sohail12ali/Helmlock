import { type ReactNode, useState } from "react";

/**
 * Fixed-row-height windowing for long lists (F109: virtualise past a few hundred rows).
 * Below `threshold` rows it renders everything, so short lists stay plain DOM.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height = 560,
  threshold = 300,
  overscan = 8,
  render,
  as: Tag = "div",
  label,
  className,
}: {
  items: T[];
  rowHeight: number;
  height?: number;
  threshold?: number;
  overscan?: number;
  render: (item: T, index: number) => ReactNode;
  as?: "div" | "ul";
  label?: string;
  className?: string;
}) {
  const [top, setTop] = useState(0);
  if (items.length <= threshold)
    return (
      <Tag className={className} aria-label={label}>
        {items.map(render)}
      </Tag>
    );

  const first = Math.max(0, Math.floor(top / rowHeight) - overscan);
  const last = Math.min(items.length, Math.ceil((top + height) / rowHeight) + overscan);
  return (
    <div className={className} style={{ height, overflowY: "auto" }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: items.length * rowHeight, position: "relative" }}>
        <Tag aria-label={label} style={{ transform: `translateY(${first * rowHeight}px)` }}>
          {items.slice(first, last).map((it, i) => render(it, first + i))}
        </Tag>
      </div>
    </div>
  );
}
