import { layoutResultSchema, type LayoutPlanning } from "./layoutPlan";
import {
  materialCandidates,
  attachMaterials,
  validateMaterialBindings,
  MATERIAL_BUCKET,
  type SharedMaterial,
} from "./sharedMaterials";
import { uploadMaterials } from "./materialService";
import { MaterialPicker, SharedMaterialList } from "./MaterialPicker";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  Clock,
  Copy,
  FileText,
  FolderOpen,
  Globe,
  Grid2X2,
  GripVertical,
  Languages,
  LayoutDashboard,
  LogIn,
  Maximize2,
  MessageCircle,
  MoreHorizontal,
  NotebookPen,
  Plus,
  Redo2,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
  Pencil,
  Play,
  PanelsTopLeft,
  Download,
  RefreshCw,
  Heart,
} from "lucide-react";
import type { Session } from "@supabase/supabase-js";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { ModuleIcon as MIcon } from "./registry";
import { definitions, MAX_MODULES } from "./definitions";
import { WorkspaceBus } from "./events";
import { nextPosition, applyPlan, restoreStructure, arrange } from "./layout";
import {
  builtins,
  fromTemplate,
  labels,
  safeTemplate,
  suggest,
  templateSchema,
  types,
  uid,
  type Mod,
  type ModuleType,
  type Note,
  type Resource,
  type Source,
  type Template,
  type Workspace,
} from "./model";
import { store } from "./storage";
import { ai, supabase } from "./services";
import {
  authCallbackError,
  authErrorMessage,
  readAuthRetryDeadline,
  saveAuthRetryDeadline,
} from "./authErrors";
function MiniPreview({
  template,
  large = false,
}: {
  template: Pick<Template, "modules">;
  large?: boolean;
}) {
  const max = Math.max(
    ...template.modules.map((m) => m.layout.y + m.layout.h),
    9,
  );
  return (
    <div className={`mini-preview ${large ? "large" : ""}`}>
      <div className="mini-dots" />
      <div className="mini-grid">
        {template.modules.map((m, i) => (
          <div
            key={i}
            className={`mini-module ${m.type}`}
            style={{
              left: `${(m.layout.x / 12) * 100}%`,
              top: `${(m.layout.y / max) * 100}%`,
              width: `${(m.layout.w / 12) * 100}%`,
              height: `${(m.layout.h / max) * 100}%`,
            }}
          >
            <div className="mini-title">
              <MIcon type={m.type} size={large ? 11 : 6} />
              <span>{m.title}</span>
              <MoreHorizontal size={8} />
            </div>
            <div className="mini-content">
              {m.type === "pdf" ? (
                <>
                  <b>1. Introduction</b>
                  <i />
                  <i />
                  <mark />
                  <i />
                  <i />
                  <i />
                </>
              ) : m.type === "chat" ? (
                <>
                  <div className="mini-bubble" />
                  <i />
                  <i />
                  <i />
                </>
              ) : m.type === "note" ? (
                <>
                  <b>学习笔记</b>
                  <i />
                  <i />
                  <i />
                  <span className="mini-tag" />
                </>
              ) : (
                <>
                  <span className="mini-tag" />
                  <i />
                  <i />
                  <i />
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
type Dialog =
  | { kind: "create" }
  | { kind: "ai"; adjust?: boolean }
  | {
      kind: "preview";
      template: Template;
      origin?: string;
      adjust?: boolean;
      base?: string;
      planning?: LayoutPlanning;
      materials?: SharedMaterial[];
    }
  | { kind: "delete"; workspace: Workspace }
  | { kind: "rename"; workspace: Workspace }
  | { kind: "settings" }
  | { kind: "login" }
  | { kind: "resources" }
  | { kind: "publish" }
  | {
      kind: "detail";
      template: Template;
      author?: string;
      origin?: string;
      materials?: SharedMaterial[];
      ownPublication?: boolean;
    }
  | {
      kind: "target";
      type: ModuleType;
      text: string;
      source?: Source;
      targets: Mod[];
    };
function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]),
    [resources, setResources] = useState<Resource[]>([]),
    [notes, setNotes] = useState<Note[]>([]),
    [page, setPage] = useState<"home" | "community" | "editor">("home"),
    [currentId, setCurrentId] = useState(""),
    [edit, setEdit] = useState(false),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("全部"),
    [dialog, setDialog] = useState<Dialog | null>(null),
    [toast, setToast] = useState(""),
    [saveStatus, setSaveStatus] = useState("已保存"),
    [ready, setReady] = useState(false),
    [session, setSession] = useState<Session | null>(null),
    [community, setCommunity] = useState<any[]>([]),
    [communityError, setCommunityError] = useState(""),
    [ownSubmissions, setOwnSubmissions] = useState<
      {
        id: string;
        title: string;
        category: string;
        publication_status: string;
        created_at: string;
        template_config: unknown;
        shared_materials?: unknown;
        author_name?: string;
      }[]
    >([]),
    [communityRevision, setCommunityRevision] = useState(0),
    [personalTemplateTab, setPersonalTemplateTab] = useState<
      "favorites" | "published"
    >("favorites"),
    [favorites, setFavorites] = useState<string[]>(() => {
      try {
        const value = JSON.parse(
          localStorage.getItem("learnspace-favorites") || "[]",
        );
        return Array.isArray(value)
          ? value.filter((v) => typeof v === "string")
          : [];
      } catch {
        return [];
      }
    }),
    [history, setHistory] = useState<Mod[][]>([]),
    [future, setFuture] = useState<Mod[][]>([]),
    [menu, setMenu] = useState<string | null>(null);
  function toggleFavorite(id: string) {
    const next = favorites.includes(id)
      ? favorites.filter((x) => x !== id)
      : [...favorites, id];
    try {
      localStorage.setItem("learnspace-favorites", JSON.stringify(next));
      setFavorites(next);
      notify(next.includes(id) ? "已收藏到此设备" : "已取消收藏");
    } catch {
      notify("收藏保存失败，请检查浏览器存储权限");
    }
  }
  const current = workspaces.find((w) => w.id === currentId);
  const bus = useMemo(() => new WorkspaceBus(currentId), [currentId]);
  useEffect(() => () => bus.dispose(), [bus]);
  useEffect(() => {
    if (page !== "editor") bus.emit("selection.cleared", {});
  }, [page, bus]);
  const importInput = useRef<HTMLInputElement>(null),
    moduleCache = useRef(new Map<string, Mod>()),
    toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const notify = (s: string) => {
    setToast(s);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4200);
  };
  useEffect(() => {
    const callbackError = authCallbackError(window.location.hash);
    if (callbackError) {
      notify(callbackError);
      setDialog({ kind: "login" });
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    }
    Promise.all([store.workspaces(), store.resources(), store.notes()])
      .then(([w, r, n]) => {
        setWorkspaces(w);
        setResources(r);
        setNotes(n);
        setReady(true);
      })
      .catch(() => {
        setSaveStatus("保存失败");
        notify("本地存储无法打开，请检查浏览器存储权限");
      });
    if (supabase) {
      void supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (error) notify("登录状态读取失败，请重新登录。");
          else setSession(data.session);
        })
        .catch(() => notify("登录服务连接失败，请稍后重试。"));
      const { data } = supabase.auth.onAuthStateChange((_, s) => setSession(s));
      return () => data.subscription.unsubscribe();
    }
  }, []);
  useEffect(() => {
    if (!ready) return;
    setSaveStatus("保存中");
    const timer = setTimeout(() => {
      store
        .saveSnapshot(workspaces, notes)
        .then(() => setSaveStatus("已保存"))
        .catch(() => {
          setSaveStatus("保存失败");
          notify("本地保存失败，可能是存储空间不足。请重试。");
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [workspaces, notes, ready]);
  useEffect(() => {
    if (!ready) return;
    const flush = () => {
      void store.saveSnapshot(workspaces, notes).catch(() => {});
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, [workspaces, notes, ready]);
  useEffect(() => {
    if (page !== "community" || !supabase) return;
    let active = true;
    const client = supabase;
    void Promise.all([
      client
        .from("templates")
        .select("*")
        .eq("publication_status", "published")
        .order("created_at", { ascending: false }),
      session
        ? client
            .from("templates")
            .select("*")
            .eq("author_id", session.user.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])
      .then(([publicResult, ownResult]) => {
        if (!active) return;
        setCommunity(publicResult.data || []);
        setOwnSubmissions(ownResult.data || []);
        setCommunityError(
          publicResult.error || ownResult.error
            ? "在线模板加载失败，请重试。"
            : "",
        );
      })
      .catch(() => {
        if (active) setCommunityError("社区连接失败，请稍后重试。");
      });
    return () => {
      active = false;
    };
  }, [page, session?.user.id, communityRevision]);
  useEffect(() => {
    if (!current) return;
    current.modules.forEach((m) => moduleCache.current.set(m.id, m));
  }, [current]);
  function updateWorkspace(p: Partial<Workspace>) {
    setWorkspaces((ws) =>
      ws.map((w) =>
        w.id === currentId ? { ...w, ...p, updatedAt: Date.now() } : w,
      ),
    );
  }
  function updateMod(id: string, p: Partial<Mod>) {
    setWorkspaces((ws) =>
      ws.map((w) =>
        w.id === currentId
          ? {
              ...w,
              updatedAt: Date.now(),
              modules: w.modules.map((m) => (m.id === id ? { ...m, ...p } : m)),
            }
          : w,
      ),
    );
  }
  function structure(modules: Mod[]) {
    if (!current) return;
    const valid = templateSchema.safeParse(
      safeTemplate({ ...current, modules }),
    );
    if (!valid.success) {
      notify("布局无效：请检查重叠、边界或模块数量");
      return;
    }
    setHistory((h) => [
      ...h.slice(-29),
      current.modules.map((m) => ({ ...m, layout: { ...m.layout } })),
    ]);
    setFuture([]);
    updateWorkspace({ modules });
  }
  function restore(snapshot: Mod[]) {
    return restoreStructure(snapshot, moduleCache.current);
  }
  function undo() {
    if (!current || !history.length) return;
    setFuture((f) => [...f, current.modules]);
    updateWorkspace({ modules: restore(history[history.length - 1]) });
    setHistory((h) => h.slice(0, -1));
  }
  function redo() {
    if (!current || !future.length) return;
    setHistory((h) => [...h, current.modules]);
    updateWorkspace({ modules: restore(future[future.length - 1]) });
    setFuture((f) => f.slice(0, -1));
  }
  function open(w: Workspace, editing = false) {
    setCurrentId(w.id);
    setPage("editor");
    setEdit(editing);
    setQuery("");
    setHistory([]);
    setFuture([]);
    setMenu(null);
  }
  async function create(
    t: Template,
    origin?: string,
    materials: SharedMaterial[] = [],
  ) {
    const w = fromTemplate(t, origin);
    try {
      const installed = await attachMaterials(w, t, materials, async (path) => {
        if (!supabase) throw Error("尚未配置社区资料服务");
        const { data, error } = await supabase.storage
          .from(MATERIAL_BUCKET)
          .download(path);
        if (error || !data)
          throw Error("附带资料下载失败，请检查社区配置或稍后重试");
        return data;
      });
      await store.saveInstallation(w, installed.notes, installed.resources);
      setResources((rs) => [...rs, ...installed.resources]);
      setNotes((ns) => [...ns, ...installed.notes]);
      setWorkspaces((ws) => [w, ...ws]);
      setDialog(null);
      open(w, true);
      notify("工作台已创建，开始搭建你的学习空间");
    } catch (e) {
      notify(
        e instanceof Error
          ? `创建失败：${e.message}`
          : "创建失败，请检查本地存储空间",
      );
    }
  }
  function addModule(type: ModuleType, position?: { x: number; y: number }) {
    if (!current) return;
    if (current.modules.length >= MAX_MODULES)
      return notify(`一个工作台最多 ${MAX_MODULES} 个模块`);
    try {
      const size = definitions[type].size;
      const layout = position
        ? { x: position.x, y: position.y, ...size }
        : nextPosition(current.modules, size.w, size.h);
      structure([
        ...current.modules,
        { id: uid(), type, title: labels[type], layout },
      ]);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function duplicate(m: Mod) {
    if (!current || current.modules.length >= MAX_MODULES)
      return notify(`最多 ${MAX_MODULES} 个模块`);
    try {
      const id = uid();
      const copy = {
        ...structuredClone(m),
        id,
        group: undefined,
        locked: false,
        title: m.title + " 副本",
        layout: nextPosition(current.modules, m.layout.w, m.layout.h),
      };
      const clonedNotes = notes
        .filter((n) => n.moduleId === m.id && n.workspaceId === currentId)
        .map((n) => ({ ...structuredClone(n), id: uid(), moduleId: id }));
      await Promise.all(clonedNotes.map((n) => store.saveNote(n)));
      setNotes((ns) => [...ns, ...clonedNotes]);
      structure([...current.modules, copy]);
    } catch (e) {
      notify((e as Error).message);
    }
  }
  async function saveResource(f: File) {
    if (!/^(image|video)\//.test(f.type)) throw Error("请选择图片或视频文件");
    if (f.type === "image/svg+xml")
      throw Error("请使用 PNG、JPEG、WebP 等位图格式");
    const r: Resource = {
      id: uid(),
      name: f.name,
      version: uid(),
      file: f,
      createdAt: Date.now(),
    };
    await store.saveResource(r);
    setResources((rs) => [...rs, r]);
    return r.id;
  }
  async function upload(modId: string, f: File) {
    if (f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"))
      throw Error("请选择 PDF 文件");
    const header = new TextDecoder().decode(await f.slice(0, 5).arrayBuffer());
    if (header !== "%PDF-") throw Error("文件不是有效的 PDF");
    const r: Resource = {
      id: uid(),
      name: f.name,
      version: uid(),
      file: f,
      createdAt: Date.now(),
    };
    await store.saveResource(r);
    setResources((rs) => [...rs, r]);
    updateMod(modId, { resourceId: r.id, page: 1 });
    notify("PDF 已保存到此设备");
  }
  async function saveNote(n: Note) {
    setNotes((ns) => [...ns.filter((x) => x.id !== n.id), n]);
    try {
      await store.saveNote(n);
    } catch {
      setSaveStatus("保存失败");
      notify("笔记保存失败，请检查存储空间");
    }
  }
  async function deleteNote(id: string) {
    try {
      await store.removeNote(id);
      setNotes((n) => n.filter((x) => x.id !== id));
    } catch {
      notify("删除失败");
    }
  }
  function receive(
    target: Mod,
    type: ModuleType,
    text: string,
    source?: Source,
  ) {
    if (type === "text" || type === "sticky") {
      updateMod(target.id, {
        data: {
          ...target.data,
          text: (target.data?.text ? target.data.text + "\n\n" : "") + text,
        },
      });
    } else if (type === "todo") {
      updateMod(target.id, {
        data: {
          ...target.data,
          tasks: [
            ...(target.data?.tasks || []),
            { id: uid(), text, done: false },
          ],
        },
      });
    } else if (type === "note") {
      const old = notes.find(
        (n) => n.moduleId === target.id && n.workspaceId === currentId,
      );
      if (
        old?.content &&
        !confirm(`将内容追加到「${target.title}」？已有笔记将保留。`)
      )
        return;
      void saveNote({
        id: old?.id || uid(),
        moduleId: target.id,
        workspaceId: currentId,
        content:
          (old?.content ? old.content + "\n\n" : "") +
          (source
            ? `> ${text.replace(/\n/g, "\n> ")}\n\n— ${source.resourceName || "原文"}${source.kind === "pdf" || !source.kind ? ` · 第 ${source.page} 页` : ""}`
            : text),
        sources: [...(old?.sources || []), ...(source ? [source] : [])],
      });
    } else {
      if (target.input && !confirm(`替换「${target.title}」中尚未发送的文本？`))
        return;
      updateMod(target.id, {
        input: type === "chat" ? target.input || "" : text,
        source,
        output: undefined,
      });
    }
    setDialog(null);
    notify(`已发送到${target.title}`);
  }
  function send(type: ModuleType, text: string, source?: Source) {
    const targets = current?.modules.filter((m) => m.type === type) || [];
    if (!targets.length) return notify(`请先添加${labels[type]}模块`);
    if (targets.length > 1)
      setDialog({ kind: "target", type, text, source, targets });
    else
      bus.emit("content.insert", {
        targetId: targets[0].id,
        type,
        text,
        source,
      });
  }
  function jump(s: Source) {
    if (s.kind && s.kind !== "pdf") {
      const m = current?.modules.find((m) => m.id === s.moduleId);
      if (m) {
        if (s.kind === "video" && s.timestamp != null)
          updateMod(m.id, { data: { ...m.data, seek: s.timestamp } });
        bus.emit("module.focus", { moduleId: m.id });
        notify("已打开来源模块");
      } else if (s.url) {
        try {
          window.open(
            new URL(s.url).protocol === "https:" ||
              new URL(s.url).protocol === "http:"
              ? s.url
              : "",
            "_blank",
            "noopener,noreferrer",
          );
        } catch {
          notify("来源地址无效");
        }
      } else notify("原始模块不可用");
      return;
    }
    const r = resources.find((r) => r.id === s.resourceId);
    if (!r || r.version !== s.version)
      return notify("此来源的历史文件版本不可用");
    const targets = current?.modules.filter((m) => m.type === "pdf");
    const m =
      targets?.find((m) => m.id === s.moduleId) ||
      targets?.find((m) => m.resourceId === r.id) ||
      targets?.[0];
    if (!m) return notify("请先添加 PDF 阅读模块");
    updateMod(m.id, { resourceId: r.id, page: s.page });
    bus.emit("module.focus", { moduleId: m.id });
    notify(`已定位到第 ${s.page} 页`);
  }
  useEffect(() => {
    const insert = bus.on("content.insert", (p) => {
      const target = current?.modules.find((m) => m.id === p.targetId);
      if (target) receive(target, p.type, p.text, p.source);
    });
    const source = bus.on("source.navigate", jump);
    return () => {
      insert();
      source();
    };
  }, [bus, current, notes]);
  function exportTemplate(w: Workspace) {
    const blob = new Blob([JSON.stringify(safeTemplate(w), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${w.title}.learnspace.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify("模板已导出，不包含 PDF、笔记和聊天内容");
  }
  async function importTemplate(f: File) {
    try {
      if (f.size > 100 * 1024) throw Error("模板文件不能超过 100 KB");
      const t = templateSchema.parse(JSON.parse(await f.text()));
      setDialog({ kind: "preview", template: t });
    } catch {
      notify("导入失败：请使用合法的 LearnSpace V1 模板，且布局不能重叠");
    }
  }
  const sorted = [...workspaces]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .filter((w) => w.title.toLowerCase().includes(query.toLowerCase()));
  const allTemplates = [
    ...builtins.map((t) => ({ ...t, sharedMaterials: [] as SharedMaterial[] })),
    ...community.flatMap((t) => {
      const parsed = templateSchema.safeParse(t.template_config);
      return parsed.success
        ? [
            {
              ...parsed.data,
              id: t.id,
              category: t.category,
              author: t.author_name,
              uses: "新发布",
              color: "lavender",
              sharedMaterials: (() => {
                try {
                  return validateMaterialBindings(
                    parsed.data,
                    t.shared_materials || [],
                  );
                } catch {
                  return null;
                }
              })(),
            },
          ]
        : [];
    }),
  ].filter((t) => t.sharedMaterials !== null);
  const templates = allTemplates.filter(
    (t) =>
      (category === "全部" || t.category === category) &&
      (t.title + t.description).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className={`app ${page === "editor" ? "editor-app" : ""}`}>
      {page !== "editor" && (
        <aside className="sidebar">
          <a
            className="brand"
            href="#"
            onClick={(e) => {
              e.preventDefault();
              setPage("home");
            }}
          >
            <span className="brand-mark">
              <PanelsTopLeft size={21} />
            </span>
            LearnSpace<span className="brand-period">.</span>
          </a>
          <div className="nav-label">你的学习空间</div>
          <nav>
            <button
              className={page === "home" ? "active" : ""}
              onClick={() => {
                setPage("home");
                setQuery("");
              }}
            >
              <LayoutDashboard size={19} />
              我的工作台
            </button>
            <button
              className={page === "community" ? "active" : ""}
              onClick={() => {
                setPage("community");
                setQuery("");
              }}
            >
              <Grid2X2 size={19} />
              模板社区<span className="new-badge">NEW</span>
            </button>
            <button onClick={() => setDialog({ kind: "resources" })}>
              <FolderOpen size={19} />
              我的资料<span className="nav-count">{resources.length}</span>
            </button>
          </nav>
          <div className="sidebar-bottom">
            <div className="local-card">
              <span className="local-dot" />
              本地优先，安心学习<p>你的资料只属于你</p>
              <ShieldCheck size={30} />
            </div>
            <button
              className="settings-nav"
              onClick={() => setDialog({ kind: "settings" })}
            >
              <Settings size={18} />
              设置与帮助
            </button>
            <button
              className="profile"
              onClick={() =>
                setDialog({ kind: session ? "settings" : "login" })
              }
            >
              <span className="avatar">
                {session?.user.email?.slice(0, 1).toUpperCase() || "L"}
              </span>
              <span>
                <b>{session?.user.email?.split("@")[0] || "本地学习者"}</b>
                <small>{session ? "已登录" : "无需登录，即刻开始"}</small>
              </span>
              <ChevronDown size={14} />
            </button>
          </div>
        </aside>
      )}
      {page !== "editor" ? (
        <main className="main">
          <header className="topbar">
            <span>
              {page === "home" ? "工作台 / 我的工作台" : "发现 / 模板社区"}
            </span>
            <div>
              <span className="device-tag">
                <span />
                所有内容保存在此设备
              </span>
              <button
                className="icon-button"
                title="帮助与设置"
                onClick={() => setDialog({ kind: "settings" })}
              >
                <Settings size={17} />
              </button>
            </div>
          </header>
          <div className="page-content">
            {page === "home" ? (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">A SPACE FOR YOUR MIND</div>
                    <h1>
                      我的工作台<span className="heading-dot">.</span>
                    </h1>
                    <p>把工具放在一起，让专注自然发生。</p>
                  </div>
                  <div className="heading-actions">
                    <button
                      className="btn"
                      onClick={() => importInput.current?.click()}
                    >
                      <Upload size={16} />
                      导入模板
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => setDialog({ kind: "create" })}
                    >
                      <Plus size={17} />
                      新建工作台
                    </button>
                  </div>
                </div>
                <section className="ai-banner">
                  <div className="banner-art">
                    <div className="orb orb-one" />
                    <div className="orb orb-two" />
                    <span className="sparkle-one">✦</span>
                    <span className="sparkle-two">✧</span>
                    <div className="art-window">
                      <div>
                        <i />
                        <i />
                        <i />
                      </div>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                  <div className="banner-copy">
                    <div className="banner-eyebrow">
                      <Sparkles size={14} />
                      AI 智能搭建
                    </div>
                    <h2>一句话，搭建你的理想学习空间</h2>
                    <p>告诉 AI 你想学什么，让合适的工具和布局为你准备好。</p>
                    <button
                      className="btn dark"
                      onClick={() => setDialog({ kind: "ai" })}
                    >
                      试试 AI 创建
                      <ArrowRight size={16} />
                    </button>
                  </div>
                  <span className="banner-watermark">
                    Your space.
                    <br />
                    Your pace.
                  </span>
                </section>
                <div className="section-heading">
                  <h2>
                    全部工作台{" "}
                    <span className="count-pill">{workspaces.length}</span>
                  </h2>
                  <div className="section-controls">
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="搜索工作台"
                        placeholder="搜索工作台…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <span className="sort-label">
                      最近修改
                      <ChevronDown size={13} />
                    </span>
                  </div>
                </div>
                <div className="workspace-grid">
                  <button
                    className="new-workspace"
                    onClick={() => setDialog({ kind: "create" })}
                  >
                    <span className="add-circle">
                      <Plus size={26} />
                    </span>
                    <h3>创建新的工作台</h3>
                    <p>从空白画布开始，自由搭建</p>
                    <span className="new-card-link">
                      开启一段新的学习
                      <ArrowUpRight size={14} />
                    </span>
                  </button>
                  {sorted.map((w) => (
                    <article className="workspace-card" key={w.id}>
                      <button
                        className="workspace-preview"
                        onClick={() => open(w)}
                      >
                        <MiniPreview template={w} />
                        <span className="preview-open">
                          <Play size={15} />
                          打开工作台
                        </span>
                      </button>
                      <div className="workspace-info">
                        <div>
                          <button
                            className="card-title"
                            onClick={() => open(w)}
                          >
                            {w.title}
                          </button>
                          <div className="card-menu">
                            <button
                              className="icon-button"
                              title={`${w.title}的操作`}
                              onClick={() =>
                                setMenu(menu === w.id ? null : w.id)
                              }
                            >
                              <MoreHorizontal size={18} />
                            </button>
                            {menu === w.id && (
                              <div className="dropdown">
                                <button
                                  onClick={() => {
                                    setDialog({ kind: "rename", workspace: w });
                                    setMenu(null);
                                  }}
                                >
                                  <Pencil size={14} />
                                  重命名
                                </button>
                                <button
                                  onClick={() => {
                                    void create(safeTemplate(w));
                                    setMenu(null);
                                  }}
                                >
                                  <Copy size={14} />
                                  复制工作台结构
                                </button>
                                <button onClick={() => exportTemplate(w)}>
                                  <Download size={14} />
                                  导出模板
                                </button>
                                <button
                                  className="danger"
                                  onClick={() => {
                                    setDialog({ kind: "delete", workspace: w });
                                    setMenu(null);
                                  }}
                                >
                                  <Trash2 size={14} />
                                  删除工作台
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <p>{w.description || "为你的下一次专注学习准备好了"}</p>
                        <footer>
                          <span className="module-stack">
                            {w.modules.slice(0, 4).map((m) => (
                              <MIcon key={m.id} type={m.type} size={12} />
                            ))}
                            <span>{w.modules.length} 个模块</span>
                          </span>
                          <span>
                            <Clock size={11} />
                            {new Date(w.updatedAt).toLocaleDateString("zh-CN", {
                              month: "numeric",
                              day: "numeric",
                            })}
                          </span>
                        </footer>
                      </div>
                    </article>
                  ))}
                </div>
                {query && !sorted.length && (
                  <p className="no-results">没有找到匹配的工作台</p>
                )}
                <div className="section-heading recommended-heading">
                  <div>
                    <h2>
                      为你推荐的起点{" "}
                      <span className="subtle-label">不必每次都从零开始</span>
                    </h2>
                  </div>
                  <button
                    className="text-button"
                    onClick={() => {
                      setPage("community");
                      setQuery("");
                    }}
                  >
                    探索模板社区
                    <ArrowRight size={15} />
                  </button>
                </div>
                <div className="template-grid">
                  {builtins.map((t) => (
                    <article className="template-card" key={t.id}>
                      <button
                        className={`template-cover ${t.color}`}
                        onClick={() =>
                          setDialog({
                            kind: "detail",
                            template: t,
                            author: t.author,
                            origin: t.id,
                            materials:
                              allTemplates.find((item) => item.id === t.id)
                                ?.sharedMaterials || [],
                          })
                        }
                      >
                        <MiniPreview template={t} />
                        <span className="template-category">{t.category}</span>
                      </button>
                      <div className="template-info">
                        <button
                          className="card-title"
                          onClick={() =>
                            setDialog({
                              kind: "detail",
                              template: t,
                              author: t.author,
                              origin: t.id,
                              materials:
                                allTemplates.find((item) => item.id === t.id)
                                  ?.sharedMaterials || [],
                            })
                          }
                        >
                          {t.title}
                        </button>
                        <p>{t.description}</p>
                        <footer>
                          <span>
                            <BookOpen size={12} />
                            {t.modules.length} 个模块
                          </span>
                          <button
                            title={`使用${t.title}`}
                            onClick={() =>
                              setDialog({
                                kind: "preview",
                                template: safeTemplate(fromTemplate(t)),
                                origin: t.id,
                                materials:
                                  allTemplates.find((item) => item.id === t.id)
                                    ?.sharedMaterials || [],
                              })
                            }
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        </footer>
                      </div>
                    </article>
                  ))}
                </div>
                <footer className="page-footer">
                  <span>
                    <span className="tiny-brand">✦</span>一点秩序，更多可能。
                  </span>
                  <span>LearnSpace · Made for focused minds</span>
                </footer>
              </>
            ) : (
              <>
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">
                      BUILT BY LEARNERS, FOR LEARNERS
                    </div>
                    <h1>
                      发现你的下一种可能<span className="heading-dot">.</span>
                    </h1>
                    <p>好的学习方式，值得分享。找到适合你的工作台。</p>
                  </div>
                  <button
                    className="btn primary"
                    onClick={() =>
                      setDialog({ kind: session ? "publish" : "login" })
                    }
                  >
                    <Upload size={16} />
                    发布模板
                  </button>
                </div>
                <div className="community-tools">
                  <div className="filter-tabs">
                    {[
                      "全部",
                      "论文阅读",
                      "课程复习",
                      "技术学习",
                      "通用学习",
                    ].map((c) => (
                      <button
                        key={c}
                        className={category === c ? "selected" : ""}
                        onClick={() => setCategory(c)}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="search-field">
                    <Search size={16} />
                    <input
                      aria-label="搜索模板"
                      placeholder="搜索你需要的模板…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </div>
                </div>
                <div className="community-notice">
                  <Globe size={15} />
                  {supabase
                    ? "内置精选与社区公开模板"
                    : "精选内置模板可直接安装。配置社区服务后可浏览和发布在线模板。"}
                </div>
                {communityError && (
                  <p className="inline-error">{communityError}</p>
                )}
                <section className="own-submissions" aria-label="我的模板">
                  <div className="own-submissions-header">
                    <div
                      className="personal-template-tabs"
                      role="tablist"
                      aria-label="我的模板列表"
                    >
                      <button
                        role="tab"
                        id="favorites-tab"
                        aria-controls="personal-template-panel"
                        aria-selected={personalTemplateTab === "favorites"}
                        onClick={() => setPersonalTemplateTab("favorites")}
                      >
                        <Heart size={14} />
                        我的收藏<span>{favorites.length}</span>
                      </button>
                      <button
                        role="tab"
                        id="published-tab"
                        aria-controls="personal-template-panel"
                        aria-selected={personalTemplateTab === "published"}
                        onClick={() => setPersonalTemplateTab("published")}
                      >
                        <Upload size={14} />
                        我的发布<span>{ownSubmissions.length}</span>
                      </button>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setCommunityRevision((r) => r + 1)}
                    >
                      <RefreshCw size={12} />
                      刷新状态
                    </button>
                  </div>
                  <div
                    id="personal-template-panel"
                    role="tabpanel"
                    aria-labelledby={
                      personalTemplateTab === "favorites"
                        ? "favorites-tab"
                        : "published-tab"
                    }
                  >
                    {personalTemplateTab === "favorites" ? (
                      favorites.length ? (
                        <div className="personal-favorites-list">
                          {favorites.map((id) => {
                            const t = allTemplates.find(
                              (template) => template.id === id,
                            );
                            return (
                              <div className="personal-favorite-row" key={id}>
                                {t ? (
                                  <>
                                    <button
                                      className={`personal-favorite-cover template-cover ${t.color}`}
                                      aria-label={`查看收藏的${t.title}`}
                                      onClick={() =>
                                        setDialog({
                                          kind: "detail",
                                          template: t,
                                          author: t.author,
                                          origin: t.id,
                                          materials:
                                            allTemplates.find(
                                              (item) => item.id === t.id,
                                            )?.sharedMaterials || [],
                                        })
                                      }
                                    >
                                      <MiniPreview template={t} />
                                    </button>
                                    <div className="personal-favorite-info">
                                      <button
                                        onClick={() =>
                                          setDialog({
                                            kind: "detail",
                                            template: t,
                                            author: t.author,
                                            origin: t.id,
                                            materials:
                                              allTemplates.find(
                                                (item) => item.id === t.id,
                                              )?.sharedMaterials || [],
                                          })
                                        }
                                      >
                                        {t.title}
                                      </button>
                                      <span>
                                        {t.category} · {t.modules.length} 个模块
                                      </span>
                                    </div>
                                    <button
                                      className="btn mini"
                                      onClick={() =>
                                        setDialog({
                                          kind: "preview",
                                          template: safeTemplate(
                                            fromTemplate(t),
                                          ),
                                          origin: t.id,
                                          materials:
                                            allTemplates.find(
                                              (item) => item.id === t.id,
                                            )?.sharedMaterials || [],
                                        })
                                      }
                                    >
                                      安装模板
                                      <ArrowDownToLine size={13} />
                                    </button>
                                  </>
                                ) : (
                                  <div className="personal-favorite-info">
                                    <span>
                                      此收藏暂时不可用，请刷新或检查社区连接
                                    </span>
                                  </div>
                                )}
                                <button
                                  className="template-favorite active"
                                  aria-label={`取消收藏${t?.title || "暂时不可用的模板"}`}
                                  title="取消收藏"
                                  onClick={() => toggleFavorite(id)}
                                >
                                  <Heart size={15} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="submission-empty">
                          还没有收藏。点击下方模板的爱心，即可在这里找到。收藏保存在当前设备。
                        </p>
                      )
                    ) : !session ? (
                      <div className="personal-publish-login">
                        <p>登录后查看你发布的社区模板。</p>
                        <button
                          className="btn mini"
                          onClick={() => setDialog({ kind: "login" })}
                        >
                          登录
                        </button>
                      </div>
                    ) : ownSubmissions.length ? (
                      <div className="personal-favorites-list">
                        {ownSubmissions.map((t) => {
                          const parsed = templateSchema.safeParse(
                            t.template_config,
                          );
                          let materials: SharedMaterial[] = [];
                          if (parsed.success)
                            try {
                              materials = validateMaterialBindings(
                                parsed.data,
                                t.shared_materials || [],
                              );
                            } catch {}
                          const showDetail = () => {
                            if (parsed.success)
                              setDialog({
                                kind: "detail",
                                template: parsed.data,
                                author: t.author_name,
                                origin: t.id,
                                materials,
                                ownPublication: true,
                              });
                          };
                          return (
                            <div
                              key={t.id}
                              className="personal-favorite-row personal-published-row"
                            >
                              {parsed.success && (
                                <button
                                  className="personal-favorite-cover template-cover lavender"
                                  aria-label={`查看发布的${t.title}`}
                                  onClick={showDetail}
                                >
                                  <MiniPreview template={parsed.data} />
                                </button>
                              )}
                              <div className="personal-favorite-info">
                                <button
                                  disabled={!parsed.success}
                                  onClick={showDetail}
                                >
                                  {t.title}
                                </button>
                                <div className="personal-published-meta">
                                  <span>
                                    {t.category}
                                    {parsed.success &&
                                      ` · ${parsed.data.modules.length} 个模块`}
                                    {materials.length > 0 &&
                                      ` · ${materials.length} 项资料`}
                                  </span>
                                  <span
                                    className={`submission-status ${t.publication_status}`}
                                  >
                                    {t.publication_status === "pending"
                                      ? "旧版未公开"
                                      : t.publication_status === "published"
                                        ? "已公开"
                                        : "未通过"}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="submission-empty">
                        发布后的模板会直接进入公开社区。
                      </p>
                    )}
                  </div>
                </section>

                <div className="template-grid community-grid">
                  {templates.map((t) => (
                    <article className="template-card" key={t.id}>
                      <button
                        className={`template-cover ${t.color}`}
                        onClick={() =>
                          setDialog({
                            kind: "detail",
                            template: t,
                            author: t.author,
                            origin: t.id,
                            materials:
                              allTemplates.find((item) => item.id === t.id)
                                ?.sharedMaterials || [],
                          })
                        }
                      >
                        <MiniPreview template={t} />
                        <span className="template-category">{t.category}</span>
                      </button>
                      <div className="template-info">
                        <button
                          className="card-title"
                          onClick={() =>
                            setDialog({
                              kind: "detail",
                              template: t,
                              author: t.author,
                              origin: t.id,
                              materials:
                                allTemplates.find((item) => item.id === t.id)
                                  ?.sharedMaterials || [],
                            })
                          }
                        >
                          {t.title}
                        </button>
                        <span className="author">by {t.author}</span>
                        <p>{t.description}</p>
                        <footer>
                          <div className="template-card-actions">
                            <button
                              className="template-meta-button"
                              title="查看模板模块"
                              aria-label={`查看${t.title}的模块`}
                              onClick={() =>
                                setDialog({
                                  kind: "detail",
                                  template: t,
                                  author: t.author,
                                  origin: t.id,
                                  materials:
                                    allTemplates.find(
                                      (item) => item.id === t.id,
                                    )?.sharedMaterials || [],
                                })
                              }
                            >
                              <BookOpen size={13} />
                              {t.modules.length} 个模块
                            </button>
                            <button
                              className={`template-favorite ${favorites.includes(t.id) ? "active" : ""}`}
                              aria-label={`${favorites.includes(t.id) ? "取消收藏" : "收藏"}${t.title}`}
                              title="收藏到此设备"
                              aria-pressed={favorites.includes(t.id)}
                              onClick={() => toggleFavorite(t.id)}
                            >
                              <Heart size={15} />
                            </button>
                          </div>
                          <button
                            className="btn mini"
                            onClick={() =>
                              setDialog({
                                kind: "preview",
                                template: safeTemplate(fromTemplate(t)),
                                origin: t.id,
                                materials:
                                  allTemplates.find((item) => item.id === t.id)
                                    ?.sharedMaterials || [],
                              })
                            }
                          >
                            安装模板
                            <ArrowDownToLine size={13} />
                          </button>
                        </footer>
                      </div>
                    </article>
                  ))}
                </div>
                {!templates.length && (
                  <div className="no-results">
                    没有匹配的模板，试试其他关键词
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      ) : (
        current && (
          <div className="editor-shell">
            <header className="editor-header">
              <button
                className="back-button"
                title="返回工作台"
                onClick={() => {
                  setPage("home");
                  setMenu(null);
                }}
              >
                <ChevronLeft size={19} />
              </button>
              <a className="brand compact" onClick={() => setPage("home")}>
                <span className="brand-mark">
                  <PanelsTopLeft size={18} />
                </span>
                LearnSpace
              </a>
              <span className="header-divider" />
              <button
                className="workspace-name"
                onClick={() =>
                  setDialog({ kind: "rename", workspace: current })
                }
              >
                {current.title}
                <Pencil size={13} />
              </button>
              <span
                className={`save-label ${saveStatus === "保存失败" ? "error" : ""}`}
              >
                <span />
                {saveStatus}
              </span>
              <div className="editor-actions">
                <div className="mode-toggle">
                  <button
                    className={edit ? "selected" : ""}
                    onClick={() => setEdit(true)}
                  >
                    <Pencil size={13} />
                    编辑
                  </button>
                  <button
                    className={!edit ? "selected" : ""}
                    onClick={() => setEdit(false)}
                  >
                    <Play size={13} />
                    学习
                  </button>
                </div>
                {edit && (
                  <>
                    <button
                      className="icon-button"
                      title="撤销布局"
                      disabled={!history.length}
                      onClick={undo}
                    >
                      <Undo2 size={17} />
                    </button>
                    <button
                      className="icon-button"
                      title="重做布局"
                      disabled={!future.length}
                      onClick={redo}
                    >
                      <Redo2 size={17} />
                    </button>
                    <button
                      className="btn"
                      onClick={() => setDialog({ kind: "ai", adjust: true })}
                    >
                      <Sparkles size={15} />
                      AI 调整
                    </button>
                  </>
                )}
                <button
                  className="btn primary"
                  onClick={() => setDialog({ kind: "publish" })}
                >
                  <Upload size={14} />
                  分享模板
                </button>
                <button
                  className="icon-button"
                  title="更多工作台操作"
                  onClick={() => setMenu(menu === "editor" ? null : "editor")}
                >
                  <MoreHorizontal size={19} />
                </button>
                {menu === "editor" && (
                  <div className="dropdown editor-dropdown">
                    <button
                      onClick={() => {
                        exportTemplate(current);
                        setMenu(null);
                      }}
                    >
                      <Download size={14} />
                      导出工作台模板
                    </button>
                    <button
                      onClick={() => {
                        if (confirm("恢复默认布局？笔记与资料会保留。")) {
                          structure(arrange(current.modules, "双栏"));
                        }
                        setMenu(null);
                      }}
                    >
                      <RefreshCw size={14} />
                      恢复默认布局
                    </button>
                    <button
                      onClick={() => {
                        void store
                          .saveSnapshot(workspaces, notes)
                          .then(() => {
                            setSaveStatus("已保存");
                            notify("保存成功");
                          })
                          .catch(() => notify("重试保存失败"));
                      }}
                    >
                      <Check size={14} />
                      重试保存
                    </button>
                  </div>
                )}
              </div>
            </header>
            <WorkspaceEditor
              workspace={current}
              edit={edit}
              add={addModule}
              change={structure}
              duplicate={(m) => void duplicate(m)}
              notify={notify}
              ai={() => setDialog({ kind: "ai", adjust: true })}
              moduleProps={(m) => ({
                mod: m,
                bus,
                resources,
                notes,
                workspaceId: currentId,
                update: (p) => updateMod(m.id, p),
                upload: (f) => upload(m.id, f),
                saveResource,
                send,
                saveNote: (n) => void saveNote(n),
                deleteNote: (id) => void deleteNote(id),
                jump: (s) => bus.emit("source.navigate", s),
                notify,
              })}
            />
          </div>
        )
      )}
      <input
        ref={importInput}
        className="hidden-input"
        type="file"
        accept="application/json,.json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importTemplate(f);
          e.target.value = "";
        }}
      />
      {dialog && (
        <Modal
          dialog={dialog}
          close={() => setDialog(null)}
          published={() => {
            setCommunityRevision((r) => r + 1);
            setPersonalTemplateTab("published");
            setPage("community");
          }}
          create={create}
          current={current}
          workspaces={workspaces}
          resources={resources}
          notes={notes}
          session={session}
          notify={notify}
          setDialog={setDialog}
          rename={(w, title) => {
            setWorkspaces((ws) =>
              ws.map((x) =>
                x.id === w.id ? { ...x, title, updatedAt: Date.now() } : x,
              ),
            );
            setDialog(null);
          }}
          remove={async (w) => {
            try {
              await store.remove(w.id);
              setWorkspaces((ws) => ws.filter((x) => x.id !== w.id));
              setDialog(null);
              notify("工作台已删除，资料和笔记仍保留");
            } catch {
              notify("删除失败，请重试");
            }
          }}
          apply={(t, base) => {
            if (!current || JSON.stringify(safeTemplate(current)) !== base)
              return notify("工作台布局已改变，请重新生成方案");
            let modules: Mod[];
            try {
              modules = applyPlan(current.modules, t);
            } catch (e) {
              return notify((e as Error).message);
            }
            structure(modules);
            updateWorkspace({
              title: t.title,
              description: t.description,
              modules,
            });
            setDialog(null);
            notify("布局调整已应用，可通过撤销恢复");
          }}
          receive={receive}
        />
      )}{" "}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button onClick={() => setToast("")}>
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function Modal({
  dialog,
  close,
  published,
  create,
  current,
  workspaces,
  resources,
  notes,
  session,
  notify,
  setDialog,
  rename,
  remove,
  apply,
  receive,
}: {
  dialog: Dialog;
  close: () => void;
  published: () => void;
  create: (
    t: Template,
    origin?: string,
    materials?: SharedMaterial[],
  ) => Promise<void>;
  current?: Workspace;
  workspaces: Workspace[];
  resources: Resource[];
  notes: Note[];
  session: Session | null;
  notify: (s: string) => void;
  setDialog: (d: Dialog) => void;
  rename: (w: Workspace, title: string) => void;
  remove: (w: Workspace) => Promise<void>;
  apply: (t: Template, base?: string) => void;
  receive: (m: Mod, type: ModuleType, text: string, source?: Source) => void;
}) {
  const [title, setTitle] = useState(
      dialog.kind === "rename"
        ? dialog.workspace.title
        : dialog.kind === "publish"
          ? current?.title || workspaces[0]?.title || ""
          : "",
    ),
    [promptText, setPromptText] = useState(""),
    [email, setEmail] = useState(""),
    [loginMode, setLoginMode] = useState<"link" | "password">("password"),
    [password, setPassword] = useState(""),
    [authRetryDeadline, setAuthRetryDeadline] = useState(readAuthRetryDeadline),
    [authNow, setAuthNow] = useState(Date.now()),
    [emailSent, setEmailSent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [description, setDescription] = useState(
      current?.description ||
        (dialog.kind === "publish" ? workspaces[0]?.description : "") ||
        "",
    ),
    [category, setCategory] = useState("论文阅读"),
    [selectedMaterials, setSelectedMaterials] = useState<string[]>([]),
    [includeMaterials, setIncludeMaterials] = useState(true),
    [selectedWorkspace, setSelectedWorkspace] = useState(
      current?.id || workspaces[0]?.id || "",
    );
  const publishWorkspace = workspaces.find((w) => w.id === selectedWorkspace);
  const candidates = publishWorkspace
    ? materialCandidates(publishWorkspace, resources, notes)
    : [];
  const retrySeconds = Math.max(
    0,
    Math.ceil((authRetryDeadline - authNow) / 1000),
  );
  useEffect(() => {
    if (dialog.kind !== "login") return;
    const timer = setInterval(() => setAuthNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [dialog.kind]);
  useEffect(() => {
    if (session && dialog.kind === "login") close();
  }, [session, dialog.kind]);
  const heading = {
    create: "新建你的学习空间",
    ai:
      dialog.kind === "ai" && dialog.adjust
        ? "让布局更适合你"
        : "用一句话，开启学习",
    preview: "你的工作台，准备好了",
    delete: "删除这个工作台？",
    rename: "给工作台起个名字",
    settings: "设置与帮助",
    login: "登录 LearnSpace",
    resources: "我的学习资料",
    publish: "分享一种学习方式",
    detail: dialog.kind === "detail" ? dialog.template.title : "模板详情",
    target: "选择接收模块",
  }[dialog.kind];
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) close();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [busy]);
  const generate = async () => {
    if (!promptText.trim()) return;
    setBusy(true);
    setError("");
    try {
      const base = current ? safeTemplate(current) : undefined;
      const result = await ai("layout", {
        request: promptText,
        existing:
          dialog.kind === "ai" && dialog.adjust && current
            ? {
                ...base,
                modules: base!.modules.map((m, i) => ({
                  ...m,
                  instanceId: current.modules[i].id,
                })),
              }
            : undefined,
      });
      const { planning, ...template } = layoutResultSchema.parse(result);
      setDialog({
        kind: "preview",
        template,
        adjust: dialog.kind === "ai" && dialog.adjust,
        base: JSON.stringify(base),
        planning,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败，请重试");
    } finally {
      setBusy(false);
    }
  };
  const login = async () => {
    if (busy || (loginMode === "link" && Date.now() < readAuthRetryDeadline()))
      return;
    if (!supabase) {
      setError("尚未配置登录服务，请在 .env 中填写 Supabase 配置。");
      return;
    }
    setBusy(true);
    setError("");
    setEmailSent(false);
    try {
      if (loginMode === "password") {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) setError(authErrorMessage(error));
        else if (!data.session) setError("未取得登录会话，请重新登录。");
        else {
          setPassword("");
          notify("登录成功，可以开始使用 AI 与社区功能");
          close();
        }
        return;
      }
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: window.location.origin },
      });
      if (error) {
        setError(authErrorMessage(error));
        if (
          error.status === 429 ||
          error.code === "over_email_send_rate_limit"
        ) {
          const deadline = Date.now() + 60000;
          saveAuthRetryDeadline(deadline);
          setAuthRetryDeadline(deadline);
          setAuthNow(Date.now());
        }
      } else {
        const deadline = Date.now() + 60000;
        saveAuthRetryDeadline(deadline);
        setAuthRetryDeadline(deadline);
        setAuthNow(Date.now());
        setEmailSent(true);
        notify("登录链接已发送，请打开最新邮件中的链接");
      }
    } catch {
      setError("登录服务连接失败，请检查网络后重试。");
    } finally {
      setBusy(false);
    }
  };
  const publish = async () => {
    if (!supabase || !session) {
      setError("请先配置社区服务并登录后发布。");
      return;
    }
    const w = workspaces.find((w) => w.id === selectedWorkspace);
    if (!w) return;
    setBusy(true);
    setError("");
    const uploadedPaths: string[] = [];
    try {
      const template = templateSchema.parse({
        ...safeTemplate(w),
        title: title || w.title,
        description,
      });
      const templateId = uid();
      const materials = await uploadMaterials(
        supabase,
        session.user.id,
        templateId,
        template,
        candidates,
        selectedMaterials,
        uploadedPaths,
      );
      const { error } = await supabase.from("templates").insert({
        id: templateId,
        ...(materials.length ? { shared_materials: materials } : {}),
        author_id: session.user.id,
        author_name: session.user.email?.split("@")[0] || "学习者",
        title: template.title,
        description,
        category,
        template_config: template,
        origin_id:
          w.origin && !builtins.some((b) => b.id === w.origin)
            ? w.origin
            : null,
        publication_status: "published",
      });
      if (error) {
        if (
          materials.length &&
          (error.code === "PGRST204" || error.code === "42703")
        )
          throw Error(
            "请先在 Supabase SQL Editor 执行 server/migrations/004_shared_materials.sql，启用资料分享。",
          );
        if (error.code === "42501")
          throw Error(
            "数据库仍使用旧版发布权限，请在 Supabase SQL Editor 执行 server/migrations/003_direct_publication.sql 后重试。",
          );
        throw error;
      }
      notify(
        materials.length
          ? `模板及 ${materials.length} 项资料已发布到社区`
          : "模板已发布到社区",
      );
      close();
      published();
    } catch (e) {
      if (uploadedPaths.length) {
        const { error: cleanupError } = await supabase.storage
          .from(MATERIAL_BUCKET)
          .remove(uploadedPaths);
        if (cleanupError)
          notify("发布失败，未公开的上传文件暂未清理，请稍后检查 Storage。");
      }
      setError(e instanceof Error ? e.message : "发布失败，请检查服务配置");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-heading"
        className={`modal modal-${dialog.kind}`}
      >
        <button
          className="modal-close"
          title="关闭"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
        {["ai", "create", "preview"].includes(dialog.kind) && (
          <div className="modal-sparkle">
            <Sparkles size={26} />
          </div>
        )}
        <h2 id="dialog-heading">{heading}</h2>
        {dialog.kind === "create" && (
          <>
            <p className="modal-subtitle">一个空白画布，无限种可能。</p>
            <label className="form-label">
              工作台名称
              <input
                autoFocus
                maxLength={80}
                placeholder="例如：我的论文阅读空间"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim())
                    void create({
                      version: 1,
                      title: title.trim(),
                      description: "",
                      modules: [],
                    });
                }}
              />
            </label>
            <div className="create-options">
              <span>
                <Grid2X2 size={20} />
                空白工作台<small>自由组合16 种学习模块</small>
              </span>
              <button
                className="text-button"
                onClick={() => setDialog({ kind: "ai" })}
              >
                <Sparkles size={15} />
                使用 AI 创建
                <ArrowRight size={14} />
              </button>
            </div>
            <button
              className="btn primary full"
              disabled={!title.trim()}
              onClick={() =>
                void create({
                  version: 1,
                  title: title.trim(),
                  description: "",
                  modules: [],
                })
              }
            >
              创建工作台
              <ArrowRight size={16} />
            </button>
          </>
        )}
        {dialog.kind === "ai" && (
          <>
            <p className="modal-subtitle">
              告诉 AI 你想完成什么，它会帮你选择工具、安排学习步骤和空间。
            </p>
            <textarea
              className="ai-prompt"
              autoFocus
              maxLength={500}
              placeholder={
                dialog.adjust
                  ? "例如：这周要做组会汇报，想把读过的论文整理成清晰的讲解要点…"
                  : "下周组会我要讲一篇英文论文。我想先读懂核心方法，再整理出适合汇报的要点。"
              }
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
            />
            <div className="prompt-counter">{promptText.length}/500</div>
            <div className="prompt-suggestions">
              {[
                "下周组会要讲一篇英文论文，想先读懂再整理汇报要点",
                "想跟着视频学习摄影，并整理可以练习的方法",
                "准备期末考试，想梳理重点并检查自己是否掌握",
                "想学习日语，积累词汇并练习阅读",
              ].map((t) => (
                <button key={t} onClick={() => setPromptText(t)}>
                  {t}
                </button>
              ))}
            </div>
            {!session && (
              <div className="info-box">
                <LogIn size={16} />
                <span>AI 生成需要登录。你也可以直接预览内置推荐布局。</span>
                <button onClick={() => setDialog({ kind: "login" })}>
                  登录
                </button>
              </div>
            )}
            {error && <p className="inline-error">{error}</p>}
            <button
              className="btn primary full"
              disabled={busy || !promptText.trim() || !session}
              onClick={() => void generate()}
            >
              <Sparkles size={16} />
              {busy
                ? "正在为你搭建…"
                : dialog.adjust
                  ? "生成调整方案"
                  : "生成工作台"}
            </button>
            {!dialog.adjust && (
              <button
                className="text-button preset-link"
                disabled={!promptText.trim()}
                onClick={() =>
                  setDialog({ kind: "preview", template: suggest(promptText) })
                }
              >
                预览内置推荐布局（无需 AI）
                <ArrowRight size={14} />
              </button>
            )}
          </>
        )}
        {dialog.kind === "preview" && (
          <>
            <p className="modal-subtitle">
              {dialog.adjust
                ? "检查布局变化，确认后再应用。原有资料和笔记会保留。"
                : "先看看布局，之后你可以随时调整。"}
            </p>
            {dialog.planning && (
              <section className="ai-task-plan">
                <div className="ai-task-goal">
                  <Sparkles size={15} />
                  <div>
                    <span>我理解的目标</span>
                    <p>{dialog.planning.goal}</p>
                  </div>
                </div>
                <ol>
                  {dialog.planning.steps.map((step, i) => (
                    <li key={i}>
                      <span className="plan-step-number">{i + 1}</span>
                      <div>
                        <b>{step.title}</b>
                        <p>{step.description}</p>
                        <div className="plan-tools">
                          {step.moduleTypes.map((type) => (
                            <span key={type}>
                              <MIcon type={type} size={11} />
                              {labels[type]}
                            </span>
                          ))}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="plan-layout-reason">
                  <b>这样安排空间的原因</b>
                  {dialog.planning.layoutReason}
                </p>
                {!!dialog.planning.assumptions?.length && (
                  <details>
                    <summary>方案采用的假设，可随时调整</summary>
                    {dialog.planning.assumptions.map((a, i) => (
                      <p key={i}>{a}</p>
                    ))}
                  </details>
                )}
              </section>
            )}
            <div className="preview-layout">
              <MiniPreview template={dialog.template} large />
              <div>
                <h3>{dialog.template.title}</h3>
                <p>{dialog.template.description}</p>
                <ul>
                  {dialog.template.modules.map((m, i) => (
                    <li key={i}>
                      <MIcon type={m.type} />
                      {m.title}
                      <span>
                        {m.layout.w} × {m.layout.h}
                      </span>
                    </li>
                  ))}
                </ul>
                {dialog.adjust && current && (
                  <div className="layout-diff">
                    <b>调整前 → 调整后</b>
                    <p>
                      {current.modules.length} →{" "}
                      {dialog.template.modules.length} 个模块
                    </p>
                    {dialog.template.modules.map((m, i) => {
                      const old = current.modules.filter(
                        (x) => x.type === m.type,
                      )[
                        dialog.template.modules
                          .slice(0, i)
                          .filter((x) => x.type === m.type).length
                      ];
                      return (
                        <small key={i}>
                          {m.title}：
                          {old
                            ? `${old.layout.x},${old.layout.y} / ${old.layout.w}×${old.layout.h}`
                            : "新增"}{" "}
                          → {m.layout.x},{m.layout.y} / {m.layout.w}×
                          {m.layout.h}
                        </small>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="privacy-line">
              <ShieldCheck size={15} />
              {dialog.materials?.length
                ? "附带资料由发布者明确选择公开；未共享内容不会导入。"
                : "仅包含模块与布局，不会导入他人的私人内容"}
            </div>
            <SharedMaterialList materials={dialog.materials || []} />
            {!!dialog.materials?.length && (
              <label className="install-material-option">
                <input
                  type="checkbox"
                  checked={includeMaterials}
                  disabled={busy}
                  onChange={(e) => setIncludeMaterials(e.target.checked)}
                />
                同时安装附带资料和笔记
              </label>
            )}
            <div className="modal-actions">
              <button
                className="btn"
                disabled={busy}
                onClick={() => setDialog({ kind: "ai", adjust: dialog.adjust })}
              >
                <RefreshCw size={15} />
                重新设计
              </button>
              <button
                className="btn primary"
                disabled={busy}
                onClick={async () => {
                  if (dialog.adjust) {
                    apply(dialog.template, dialog.base);
                    return;
                  }
                  setBusy(true);
                  try {
                    await create(
                      dialog.template,
                      dialog.origin,
                      includeMaterials ? dialog.materials : [],
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy
                  ? "正在安装…"
                  : dialog.adjust
                    ? "应用调整"
                    : "应用到我的工作台"}
                <ArrowRight size={15} />
              </button>
            </div>
          </>
        )}
        {dialog.kind === "detail" && (
          <>
            <p className="modal-subtitle">
              by {dialog.author || "LearnSpace"} ·{" "}
              {dialog.template.modules.length} 个学习模块
            </p>
            <MiniPreview template={dialog.template} large />
            <p className="detail-description">{dialog.template.description}</p>
            <SharedMaterialList materials={dialog.materials || []} />
            <div className="detail-modules">
              {dialog.template.modules.map((m, i) => (
                <span key={i}>
                  <MIcon type={m.type} />
                  {m.title}
                </span>
              ))}
            </div>
            {!dialog.ownPublication && (
              <button
                className="btn primary full"
                onClick={() =>
                  setDialog({
                    kind: "preview",
                    template: safeTemplate(fromTemplate(dialog.template)),
                    origin: dialog.origin,
                    materials: dialog.materials,
                  })
                }
              >
                <Download size={16} />
                安装模板
              </button>
            )}
          </>
        )}
        {dialog.kind === "delete" && (
          <>
            <p className="modal-subtitle">
              即将删除「{dialog.workspace.title}
              」。工作台布局会被移除，已上传的资料和笔记将保留。
            </p>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                取消
              </button>
              <button
                className="btn danger-button"
                onClick={() => void remove(dialog.workspace)}
              >
                确认删除
              </button>
            </div>
          </>
        )}
        {dialog.kind === "rename" && (
          <>
            <label className="form-label">
              工作台名称
              <input
                autoFocus
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && title.trim())
                    rename(dialog.workspace, title.trim());
                }}
              />
            </label>
            <button
              className="btn primary full"
              disabled={!title.trim()}
              onClick={() => rename(dialog.workspace, title.trim())}
            >
              保存名称
            </button>
          </>
        )}
        {dialog.kind === "login" && (
          <>
            <p className="modal-subtitle">
              登录后使用 AI 和社区功能。本地资料不会自动上传。
            </p>
            <div className="info-box">
              <ShieldCheck size={17} />
              你的工作台与私人资料仍保存在此设备
            </div>
            <div className="login-mode-tabs" role="group" aria-label="登录方式">
              <button
                className={loginMode === "password" ? "selected" : ""}
                disabled={busy}
                onClick={() => {
                  setLoginMode("password");
                  setError("");
                }}
              >
                邮箱密码
              </button>
              <button
                className={loginMode === "link" ? "selected" : ""}
                disabled={busy}
                onClick={() => {
                  setLoginMode("link");
                  setError("");
                  setPassword("");
                }}
              >
                邮件链接
              </button>
            </div>
            <label className="form-label">
              邮箱地址
              <input
                autoFocus
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            {loginMode === "password" && (
              <label className="form-label">
                密码
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="输入已有账号的密码"
                  onKeyDown={(e) => {
                    if (
                      e.key === "Enter" &&
                      password &&
                      /^.+@.+\..+$/.test(email)
                    )
                      void login();
                  }}
                />
              </label>
            )}
            {emailSent && loginMode === "link" && (
              <div className="info-box">
                登录链接已发送。请查看收件箱或垃圾邮件，并打开最新一封邮件；较早的链接可能已失效。
              </div>
            )}
            {error && <p className="inline-error">{error}</p>}
            <button
              className="btn primary full"
              disabled={
                busy ||
                (loginMode === "link" && retrySeconds > 0) ||
                !/^.+@.+\..+$/.test(email) ||
                (loginMode === "password" && !password)
              }
              onClick={() => void login()}
            >
              {busy
                ? loginMode === "password"
                  ? "登录中…"
                  : "发送中…"
                : loginMode === "password"
                  ? "登录"
                  : retrySeconds > 0
                    ? `${retrySeconds} 秒后可重新发送`
                    : emailSent
                      ? "重新发送登录链接"
                      : "发送登录链接"}
              <ArrowRight size={15} />
            </button>
            <p className="small centered">
              {loginMode === "password"
                ? "使用已有邮箱密码账号登录，无需发送邮件。"
                : "无需密码，通过邮件中的链接安全登录"}
            </p>
          </>
        )}
        {dialog.kind === "settings" && (
          <>
            <p className="modal-subtitle">
              自由搭建你的学习空间，让 AI 成为你的学习助手。
            </p>
            <div className="setting-row">
              <span>
                <b>本地优先</b>
                <small>工作台、PDF 与笔记存储在浏览器 IndexedDB</small>
              </span>
              <span className="status-tag">已启用</span>
            </div>
            <div className="setting-row">
              <span>
                <b>AI 与社区服务</b>
                <small>
                  {supabase
                    ? "身份服务已配置，AI 需要服务端密钥"
                    : "尚未配置；本地学习与模板功能可正常使用"}
                </small>
              </span>
              <span className="status-tag">
                {supabase ? "已配置" : "待配置"}
              </span>
            </div>
            <div className="setting-row">
              <span>
                <b>模板导出</b>
                <small>仅导出布局，PDF、笔记、聊天内容不包含在内</small>
              </span>
              <ShieldCheck size={20} />
            </div>
            <div className="help-box">
              <h3>开始你的第一次学习</h3>
              <p>1. 新建工作台，点击或拖入16 种模块</p>
              <p>2. 上传 PDF，选择文字并发送到其他模块</p>
              <p>3. 切换「学习」模式，专注阅读与记录</p>
              <p>4. 布局与笔记自动保存；请勿清除浏览器站点数据</p>
            </div>
            {session ? (
              <button
                className="btn full"
                onClick={() => {
                  void supabase?.auth.signOut();
                  close();
                }}
              >
                退出登录
              </button>
            ) : (
              <button
                className="btn full"
                onClick={() => setDialog({ kind: "login" })}
              >
                <LogIn size={16} />
                登录账号
              </button>
            )}
          </>
        )}
        {dialog.kind === "resources" && (
          <>
            <p className="modal-subtitle">
              资料与笔记独立保存，移除工作台或模块不会让它们丢失。
            </p>
            <div className="resource-list">
              <h3>
                本地文件 <span>{resources.length}</span>
              </h3>
              {resources.length ? (
                resources.map((r) => (
                  <div className="resource-row" key={r.id}>
                    <MIcon
                      type={
                        r.file.type.startsWith("image/")
                          ? "image"
                          : r.file.type.startsWith("video/")
                            ? "video"
                            : "pdf"
                      }
                    />
                    <span>
                      <b>{r.name}</b>
                      <small>
                        {(r.file.size / 1024 / 1024).toFixed(2)} MB · 本地文件
                      </small>
                    </span>
                    <button
                      title="下载原始文件"
                      onClick={() => {
                        const url = URL.createObjectURL(r.file);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = r.name;
                        a.click();
                        setTimeout(() => URL.revokeObjectURL(url), 1000);
                      }}
                    >
                      <Download size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <p className="small">
                  还没有资料。在工作台中的 PDF 阅读器上传第一份文件。
                </p>
              )}
              <h3>
                已保存的笔记 <span>{notes.length}</span>
              </h3>
              {notes.map((n) => (
                <details key={n.id}>
                  <summary>
                    <NotebookPen size={15} />
                    {n.content.split("\n")[0].slice(0, 50) || "未命名笔记"}
                    <span>
                      {workspaces.find((w) => w.id === n.workspaceId)?.title ||
                        "归档笔记"}
                    </span>
                  </summary>
                  <pre>{n.content}</pre>
                  <button
                    className="text-button"
                    onClick={() => {
                      const url = URL.createObjectURL(
                        new Blob([n.content], { type: "text/markdown" }),
                      );
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "学习笔记.md";
                      a.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    }}
                  >
                    下载 Markdown
                  </button>
                </details>
              ))}
            </div>
          </>
        )}
        {dialog.kind === "publish" && (
          <>
            <p className="modal-subtitle">
              分享布局与学习思路，让更多人找到自己的节奏。
            </p>
            {!session && (
              <div className="info-box">
                <LogIn size={16} />
                发布需要登录
                <button onClick={() => setDialog({ kind: "login" })}>
                  去登录
                </button>
              </div>
            )}
            <label className="form-label">
              选择工作台
              <select
                value={selectedWorkspace}
                onChange={(e) => {
                  setSelectedWorkspace(e.target.value);
                  setSelectedMaterials([]);
                  const w = workspaces.find((x) => x.id === e.target.value);
                  setTitle(w?.title || "");
                  setDescription(w?.description || "");
                }}
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title}
                  </option>
                ))}
              </select>
            </label>
            {workspaces.find((w) => w.id === selectedWorkspace) && (
              <div className="publish-preview">
                <MiniPreview
                  template={workspaces.find((w) => w.id === selectedWorkspace)!}
                />
              </div>
            )}
            <label className="form-label">
              公开标题
              <input
                value={title}
                maxLength={80}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <label className="form-label">
              模板介绍
              <textarea
                value={description}
                maxLength={1000}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="这个工作台适合怎样的学习场景？"
              />
            </label>
            <label className="form-label">
              场景分类
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              >
                {["论文阅读", "课程复习", "技术学习", "通用学习"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <div className="privacy-line">
              <ShieldCheck size={15} />
              默认只公开标题、介绍、模块与布局；只有你勾选的资料和笔记会附带，聊天记录不公开。
            </div>
            <MaterialPicker
              candidates={candidates}
              selected={selectedMaterials}
              change={setSelectedMaterials}
              disabled={busy}
            />
            {error && <p className="inline-error">{error}</p>}
            <button
              className="btn primary full"
              disabled={busy || !selectedWorkspace || !title.trim() || !session}
              onClick={() => void publish()}
            >
              <Upload size={15} />
              {busy ? "提交中…" : "确认并发布"}
            </button>
          </>
        )}
        {dialog.kind === "target" && (
          <>
            <p className="modal-subtitle">只发送到你选择的模块。</p>
            {dialog.targets.map((m) => (
              <button
                key={m.id}
                className="target-choice"
                onClick={() =>
                  receive(m, dialog.type, dialog.text, dialog.source)
                }
              >
                <MIcon type={m.type} />
                {m.title}
                <ArrowRight size={16} />
              </button>
            ))}
          </>
        )}
      </section>
    </div>
  );
}
export default App;
