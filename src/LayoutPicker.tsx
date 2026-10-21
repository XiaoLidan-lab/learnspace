import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LayoutTemplate, Check } from "lucide-react";
import type { LayoutPreset } from "./layout";
const options: {
  name: LayoutPreset;
  description: string;
  boxes: number[][];
}[] = [
  {
    name: "按用途",
    description: "阅读为主，问答与笔记在旁",
    boxes: [
      [0, 0, 61, 54],
      [66, 0, 30, 25],
      [66, 30, 30, 24],
    ],
  },
  {
    name: "双栏",
    description: "左右对照，适合边读边记",
    boxes: [
      [0, 0, 45, 54],
      [51, 0, 45, 54],
    ],
  },
  {
    name: "三栏",
    description: "三列并排，同时查看多个工具",
    boxes: [
      [0, 0, 28, 54],
      [34, 0, 28, 54],
      [68, 0, 28, 54],
    ],
  },
  {
    name: "四宫格",
    description: "分区查看，适合多个工具协作",
    boxes: [
      [0, 0, 45, 24],
      [51, 0, 45, 24],
      [0, 30, 45, 24],
      [51, 30, 45, 24],
    ],
  },
  {
    name: "主次",
    description: "主工具更宽，辅助内容在侧",
    boxes: [
      [0, 0, 61, 54],
      [67, 0, 29, 54],
    ],
  },
  {
    name: "自适应",
    description: "按工具数量自动选择列数",
    boxes: [
      [0, 0, 28, 24],
      [34, 0, 62, 24],
      [0, 30, 62, 24],
      [68, 30, 28, 24],
    ],
  },
];
export function LayoutPicker({
  apply,
}: {
  apply: (preset: LayoutPreset) => boolean;
}) {
  const [preset, setPreset] = useState<LayoutPreset>("按用途"),
    [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    toggle = useRef<HTMLButtonElement>(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    root.current
      ?.querySelector<HTMLButtonElement>(
        '[data-layout-option][aria-pressed="true"]',
      )
      ?.focus();
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  function choose(value: LayoutPreset) {
    if (apply(value)) {
      setPreset(value);
      setOpen(false);
      toggle.current?.focus();
    }
  }
  return (
    <div
      className="layout-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          toggle.current?.focus();
        }
      }}
    >
      <div className="layout-picker-trigger">
        <button
          className="layout-picker-apply"
          onClick={() => choose(preset)}
          title={`应用${preset}布局`}
        >
          <LayoutTemplate size={16} />
          <span>一键布局</span>
          <b>{preset}</b>
        </button>
        <button
          className="layout-picker-toggle"
          ref={toggle}
          aria-label="选择布局方案"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown size={15} />
        </button>
      </div>
      {open && (
        <section
          id={id}
          className="layout-picker-popover"
          aria-label="布局方案"
        >
          <header>
            <strong>选择布局</strong>
            <span>选择即应用，可撤销恢复</span>
          </header>
          <div className="layout-picker-options">
            {options.map((option) => (
              <button
                key={option.name}
                data-layout-option
                aria-pressed={preset === option.name}
                onClick={() => choose(option.name)}
              >
                <svg viewBox="-5 -5 106 64" aria-hidden="true">
                  {option.boxes.map(([x, y, w, h], i) => (
                    <rect key={i} x={x} y={y} width={w} height={h} rx="3" />
                  ))}
                </svg>
                <span className="layout-picker-option-name">
                  {option.name}
                  {option.name === "按用途" && <small>推荐</small>}
                  {preset === option.name && <Check size={13} />}
                </span>
                <span className="layout-picker-description">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
