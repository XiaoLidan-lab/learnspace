import { useEffect, useRef, useState, useId } from "react";
import { X, Pin, PinOff, Pause, Trash2 } from "lucide-react";
import type { Mod } from "./model";
import type { ModuleProps } from "./moduleProps";
import type { WorkspaceBus } from "./events";
import { ModuleIcon } from "./registry";
import { ModuleBody } from "./ModuleBody";
import { definitions } from "./definitions";
import {
  isUtilityTool,
  utilityTypes,
  timerLabel,
  timerRemaining,
} from "./utilityTools";
import { patchData } from "./moduleProps";
export function UtilityDock({
  modules,
  moduleProps,
  bus,
  edit,
  remove,
  notify,
}: {
  modules: Mod[];
  moduleProps: (m: Mod) => ModuleProps;
  bus: WorkspaceBus;
  edit: boolean;
  remove: (id: string) => void;
  notify: (s: string) => void;
}) {
  const tools = modules.filter((m) => isUtilityTool(m.type));
  const [open, setOpen] = useState<string>(),
    [pinned, setPinned] = useState(false),
    [now, setNow] = useState(Date.now());
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const root = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLElement>(null),
    buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  const panelId = useId();
  const selected = tools.find((m) => m.id === open);
  const running = tools.some((m) => !!m.data?.timer?.endsAt);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  useEffect(
    () =>
      bus.on("module.focus", ({ moduleId }) => {
        const m = tools.find((m) => m.id === moduleId);
        if (m) {
          setChosen((old) => ({ ...old, [m.type]: m.id }));
          setOpen(m.id);
        }
      }),
    [bus, tools],
  );
  useEffect(() => {
    if (open && !selected) {
      setOpen(undefined);
      setPinned(false);
    }
  }, [open, selected]);
  useEffect(() => {
    if (selected) panel.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!selected || pinned) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        setOpen(undefined);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [selected, pinned]);
  function close() {
    if (selected) buttons.current[selected.type]?.focus();
    setOpen(undefined);
    setPinned(false);
  }
  if (!tools.length) return null;
  return (
    <div
      className="utility-dock"
      ref={root}
      aria-label="工作台辅助工具"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selected) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      }}
    >
      <aside
        id={panelId}
        className="utility-dock-panel"
        aria-label={selected ? `${selected.title}工具面板` : "辅助工具面板"}
        hidden={!selected}
        ref={panel}
        tabIndex={-1}
      >
        <header>
          <div>
            <strong>{selected?.title}</strong>
            <small>{selected && definitions[selected.type].name}</small>
          </div>
          {edit && selected && (
            <button
              className="utility-icon-button"
              title="移除此工具"
              aria-label="移除此工具"
              disabled={selected.locked}
              onClick={() => {
                remove(selected.id);
                notify("工具已移除，可撤销恢复");
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button
            className="utility-icon-button"
            title={pinned ? "取消固定" : "固定展开"}
            aria-label={pinned ? "取消固定" : "固定展开"}
            aria-pressed={pinned}
            onClick={() => setPinned(!pinned)}
          >
            {pinned ? <PinOff size={15} /> : <Pin size={15} />}
          </button>
          <button
            className="utility-icon-button"
            aria-label="收起工具"
            title="收起工具"
            onClick={close}
          >
            <X size={17} />
          </button>
        </header>
        {selected &&
          tools.filter((m) => m.type === selected.type).length > 1 && (
            <label className="utility-instance-picker">
              切换工具
              <select
                aria-label={`选择${definitions[selected.type].name}实例`}
                value={selected.id}
                onChange={(e) => {
                  setOpen(e.target.value);
                  setChosen({ ...chosen, [selected.type]: e.target.value });
                }}
              >
                {tools
                  .filter((m) => m.type === selected.type)
                  .map((m, i) => (
                    <option key={m.id} value={m.id}>
                      {m.title} · {i + 1}
                    </option>
                  ))}
              </select>
            </label>
          )}
        {tools.map((m) => (
          <div
            key={m.id}
            className="utility-instance"
            hidden={m.id !== selected?.id}
          >
            <ModuleBody {...moduleProps(m)} />
          </div>
        ))}
      </aside>
      <nav className="utility-dock-bar" aria-label="已添加的辅助工具">
        {utilityTypes.map((type) => {
          const instances = tools.filter((m) => m.type === type);
          if (!instances.length) return null;
          const current =
            instances.find((m) => m.id === chosen[type]) || instances[0];
          const timer =
            type === "pomodoro"
              ? instances.find((m) => m.data?.timer?.endsAt) || current
              : undefined;
          const pending =
            type === "todo"
              ? instances.reduce(
                  (n, m) =>
                    n + (m.data?.tasks?.filter((t) => !t.done).length || 0),
                  0,
                )
              : 0;
          const active = selected?.type === type;
          return (
            <div
              className={`utility-dock-item ${active ? "active" : ""}`}
              key={type}
            >
              <button
                ref={(el) => {
                  buttons.current[type] = el;
                }}
                aria-label={`打开${definitions[type].name}`}
                title={definitions[type].name}
                aria-expanded={active}
                aria-controls={panelId}
                onClick={() => {
                  setOpen(
                    active
                      ? undefined
                      : timer?.data?.timer?.endsAt
                        ? timer.id
                        : current.id,
                  );
                  setPinned(false);
                }}
              >
                <ModuleIcon type={type} size={19} />
                {pending > 0 && (
                  <span className="utility-count">
                    {pending > 99 ? "99+" : pending}
                  </span>
                )}
                {timer?.data?.timer?.endsAt && (
                  <span className="utility-timer-label">
                    {timerLabel(timer, now)}
                  </span>
                )}
              </button>
              {timer?.data?.timer?.endsAt && (
                <button
                  className="utility-pause"
                  title="暂停计时"
                  aria-label="暂停计时"
                  onClick={() =>
                    moduleProps(timer).update(
                      patchData(timer, {
                        timer: {
                          ...timer.data!.timer!,
                          remaining: timerRemaining(timer, Date.now()),
                          endsAt: undefined,
                        },
                      }),
                    )
                  }
                >
                  <Pause size={13} />
                </button>
              )}
            </div>
          );
        })}
      </nav>
    </div>
  );
}
