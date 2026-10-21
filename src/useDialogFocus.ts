import { useEffect, useRef } from "react";

// Shared keyboard behavior for existing modal surfaces; no navigation/data changes.
export function useDialogFocus(close: () => void, locked = false) {
  const panel = useRef<HTMLElement>(null);
  const state = useRef({ close, locked });
  state.current = { close, locked };
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement);
  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const controls = () => Array.from(root.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
    )).filter(el => el.getClientRects().length && el.getAttribute("aria-hidden") !== "true");
    if (!root.contains(document.activeElement)) (controls()[0] || root).focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const modals = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'));
      if (modals.at(-1) !== root) return;
      const activeDialog = document.activeElement?.closest('[role="dialog"]');
      if (activeDialog && activeDialog !== root && !root.contains(activeDialog)) return;
      if (event.key === "Escape" && !state.current.locked) {
        event.preventDefault();
        event.stopPropagation();
        state.current.close();
      }
      if (event.key !== "Tab") return;
      const nodes = controls();
      event.preventDefault();
      if (!nodes.length) { root.focus(); return; }
      const current = nodes.indexOf(document.activeElement as HTMLElement);
      const next = current < 0 ? (event.shiftKey ? nodes.length - 1 : 0)
        : (current + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length;
      nodes[next].focus();
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      if (!Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(el => el !== root) && opener.current instanceof HTMLElement && opener.current.isConnected)
        opener.current.focus({ preventScroll: true });
    };
  }, []);
  return panel;
}
