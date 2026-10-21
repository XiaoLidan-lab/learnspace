import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal } from "lucide-react";
export function ActionMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [position, setPosition] = useState<{ top: number; left: number }>();
  const trigger = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const close = (restore = true) => {
    setPosition(undefined);
    if (restore) trigger.current?.focus();
  };
  useEffect(() => {
    if (!position) return;
    panel.current
      ?.querySelector<HTMLElement>("button:not([disabled]),select")
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (
        !panel.current?.contains(e.target as Node) &&
        !trigger.current?.contains(e.target as Node)
      )
        close(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && panel.current) {
        const nodes = Array.from(
          panel.current.querySelectorAll<HTMLElement>(
            "button:not([disabled]),select",
          ),
        );
        if (!nodes.length) return;
        e.preventDefault();
        const index = nodes.indexOf(document.activeElement as HTMLElement);
        nodes[
          (index + (e.key === "ArrowDown" ? 1 : -1) + nodes.length) %
            nodes.length
        ].focus();
      }
    };
    const scroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    const resize = () => close(false);
    window.addEventListener("resize", resize);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [position]);
  return (
    <>
      <button
        className="action-menu-trigger"
        title={label}
        aria-label={label}
        aria-expanded={!!position}
        aria-haspopup="dialog"
        ref={trigger}
        onClick={() => {
          if (position) return close();
          const r = trigger.current!.getBoundingClientRect();
          setPosition({
            left: Math.max(8, Math.min(r.right - 190, window.innerWidth - 198)),
            top: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 260)),
          });
        }}
      >
        <MoreHorizontal size={17} />
      </button>
      {position &&
        createPortal(
          <div
            role="dialog"
            aria-label={label}
            className="action-menu-panel"
            ref={panel}
            style={position}
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button:not([disabled])"))
                close();
            }}
            onBlur={(e) => {
              if (
                e.relatedTarget &&
                !e.currentTarget.contains(e.relatedTarget as Node)
              )
                close(false);
            }}
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
