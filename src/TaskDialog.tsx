import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
export function TaskDialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null),
    onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const el = ref.current!;
    const targets = () =>
      Array.from(
        el.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ),
      ).filter((n) => n.getClientRects().length);
    const initial =
      el.querySelector<HTMLElement>(
        "textarea:not(:disabled),input:not(:disabled),select:not(:disabled)",
      ) ||
      targets()[0] ||
      el;
    initial.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose.current();
      }
      if (e.key === "Tab") {
        const list = targets(),
          first = list[0],
          last = list.at(-1);
        if (!first) {
          e.preventDefault();
          el.focus();
        } else if (
          e.shiftKey &&
          (document.activeElement === first ||
            !el.contains(document.activeElement))
        ) {
          e.preventDefault();
          last!.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !el.contains(document.activeElement))
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    el.addEventListener("keydown", key);
    return () => {
      el.removeEventListener("keydown", key);
      if (previous?.isConnected) previous.focus();
    };
  }, [title]);
  return createPortal(
    <div
      className="learning-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section
        ref={ref}
        className="learning-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header>
          <h2>{title}</h2>
          <button
            className="learning-icon"
            aria-label={`关闭${title}`}
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {children}
      </section>
    </div>,
    document.body,
  );
}
