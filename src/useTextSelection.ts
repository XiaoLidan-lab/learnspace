import { useEffect, useRef, useState } from "react";
export function useTextSelection() {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [selection, setSelection] = useState({ text: "", start: 0, end: 0 });
  useEffect(() => {
    const capture = () => {
      const el = ref.current;
      if (!el || document.activeElement !== el) return;
      const next = {
        text: el.value.slice(el.selectionStart, el.selectionEnd),
        start: el.selectionStart,
        end: el.selectionEnd,
      };
      setSelection((prev) =>
        prev.text === next.text &&
        prev.start === next.start &&
        prev.end === next.end
          ? prev
          : next,
      );
    };
    document.addEventListener("selectionchange", capture);
    document.addEventListener("keyup", capture);
    document.addEventListener("pointerup", capture);
    const timer = setInterval(capture, 250);
    return () => {
      document.removeEventListener("selectionchange", capture);
      document.removeEventListener("keyup", capture);
      document.removeEventListener("pointerup", capture);
      clearInterval(timer);
    };
  }, []);
  return { ref, selection };
}
