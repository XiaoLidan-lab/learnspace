import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  connectionLayout,
  graphInputs,
  graphOutputs,
} from "../src/connectionLayout";
import { directConnection } from "../src/connectionGraph";
import { ConnectionCanvas } from "../src/ConnectionCanvas";
import { FlowInputs } from "../src/FlowInputs";
import { ModuleBody } from "../src/ModuleBody";
import { WorkspaceBus } from "../src/events";
import type { ModuleProps } from "../src/moduleProps";
import { types, dataFlowRole } from "../src/definitions";
import { defaultCustomConfig } from "../src/customAI";
import type { Mod, Workspace } from "../src/model";
const modules: Mod[] = types.map((type, i) => ({
  id: type,
  type,
  title: `工具${i}`,
  layout: { x: 0, y: i, w: 6, h: 8 },
  input: "PRIVATE_BODY",
  ...(type === "custom-ai" ? { customConfig: defaultCustomConfig() } : {}),
}));
test("learning module bodies omit connection management while graph cards retain access", () => {
  const source = modules.find((m) => m.type === "summary")!;
  const target = modules.find((m) => m.type === "translate")!;
  const workspace = {
    id: "synthetic-panel",
    modules: [source, target],
    connections: [
      directConnection(
        [source, target],
        [],
        source.id,
        "output",
        target.id,
        "input",
        "synthetic-edge",
      ),
    ],
  } as Workspace;
  const bus = new WorkspaceBus(workspace.id);
  const moduleProps = (mod: Mod) =>
    ({
      mod,
      workspace,
      bus,
      workspaceId: workspace.id,
      resources: [],
      notes: [],
      update: () => {},
      notify: () => {},
      setConnections: () => {},
    }) as unknown as ModuleProps;
  const body = renderToStaticMarkup(
    createElement(ModuleBody, moduleProps(target)),
  );
  assert(!body.includes('aria-label="连接资料与取用记录"'));
  assert(!body.includes("获取全部内容"));
  const graph = renderToStaticMarkup(
    createElement(ConnectionCanvas, {
      workspace,
      notes: [],
      moduleProps,
      save: () => {},
      notify: () => {},
      navigate: () => {},
    }),
  );
  assert(graph.includes(`查看连接：${source.title}到${target.title}`));
  assert(!graph.includes("已有连接列表"));
  assert(!graph.includes("connection-inline-detail"));
  const compact = renderToStaticMarkup(
    createElement(FlowInputs, {
      ...moduleProps(target),
      compact: true,
      connectionId: "synthetic-edge",
    }),
  );
  assert(compact.includes("传递内容"));
  assert(!compact.includes("获取全部内容"));
  assert(!compact.includes('aria-label="连接资料与取用记录"'));
});
test("compact graph packs every tool without overlap, follows edges, leaves learning layout untouched", () => {
  const before = JSON.stringify(modules);
  const edges = [
    directConnection(modules, [], "text", "text", "summary", "input", "edge-1"),
  ];
  const { boxes, size } = connectionLayout(modules, edges);
  assert.equal(
    Object.keys(boxes).length,
    types.filter((t) => dataFlowRole(t) !== "辅助工具").length,
  );
  assert(boxes.text.x < boxes.summary.x);
  for (const [id, a] of Object.entries(boxes)) {
    assert(a.x >= 0 && a.y >= 0 && a.x + a.w <= size.w && a.y + a.h <= size.h);
    for (const [other, b] of Object.entries(boxes))
      if (id !== other)
        assert(
          a.x + a.w <= b.x ||
            b.x + b.w <= a.x ||
            a.y + a.h <= b.y ||
            b.y + b.h <= a.y,
        );
  }
  assert.equal(JSON.stringify(modules), before);
  assert.deepEqual(connectionLayout([], []).boxes, {});
  // Malformed legacy cycles cannot hang the view.
  assert(
    Object.keys(
      connectionLayout(modules, [
        ...edges,
        {
          ...edges[0],
          id: "bad",
          source: { ...edges[0].source, moduleId: "summary" },
          target: { moduleId: "text", field: "append" },
        },
      ]).boxes,
    ).length === types.filter((t) => dataFlowRole(t) !== "辅助工具").length,
  );
});
test("compact graph renders named ports and all instances, without learning body", () => {
  const html = renderToStaticMarkup(
    createElement(ConnectionCanvas, {
      workspace: {
        id: "synthetic",
        modules,
        connections: [],
      } as unknown as Workspace,
      notes: [],
      save: () => {},
      notify: () => {},
      navigate: () => {},
    }),
  );
  assert(html.includes('aria-label="模块关系图"'));
  assert(html.includes("选择输出：工具3"));
  assert(html.includes("连接到 工具4 的 参考资料"));
  assert(!html.includes("PRIVATE_BODY"));
  assert(!html.includes('role="dialog"'));
});

test("PDF defaults to selected excerpt only and retains endpoints used by saved connections", () => {
  const pdf = modules.find((m) => m.type === "pdf")!;
  assert.deepEqual(graphOutputs(pdf, []), ["selection"]);
  assert.deepEqual(graphInputs(pdf, []), []);
  const legacy = directConnection(
    modules,
    [],
    "pdf",
    "retrieval",
    "summary",
    "input",
    "legacy",
  );
  assert.deepEqual(graphOutputs(pdf, [legacy]), ["selection", "retrieval"]);
  assert.equal(connectionLayout([pdf], []).boxes.pdf.h, 146);
});

test("all graph cards use one primary content output and retain custom named inputs and legacy ports", () => {
  for (const m of modules) {
    assert.equal(
      graphOutputs(m, []).length,
      ["内容来源", "理解与整理"].includes(dataFlowRole(m.type)) ? 1 : 0,
      m.type,
    );
    if (dataFlowRole(m.type) === "内容来源")
      assert.equal(graphInputs(m, []).length, 0);
    assert(graphInputs(m, []).length <= 1 || m.type === "custom-ai");
  }
  const custom = modules.find((m) => m.type === "custom-ai")!;
  assert.equal(
    graphInputs(custom, []).length,
    custom.customConfig!.fields.length,
  );
  const edge = directConnection(
    modules,
    [],
    "text",
    "text",
    "cards",
    "input",
    "saved",
  );
  assert.deepEqual(
    graphOutputs(modules.find((m) => m.type === "text")!, [edge]),
    ["text", "selection"],
  );
  const imported = directConnection(
    modules,
    [],
    "summary",
    "output",
    "mindmap",
    "input",
    "saved2",
  );
  assert.equal(
    graphInputs(modules.find((m) => m.type === "mindmap")!, [imported]).length,
    1,
  );
});

test("role columns separate content, processing and final results; utilities stay outside graph", () => {
  const { boxes } = connectionLayout(modules, []);
  assert(boxes.pdf.x < boxes.chat.x && boxes.chat.x < boxes.cards.x);
  for (const type of ["todo", "calendar", "pomodoro"] as const)
    assert.equal(boxes[type], undefined);
  for (const type of ["cards", "quiz"] as const)
    assert.deepEqual(
      graphOutputs(modules.find((m) => m.type === type)!, []),
      [],
    );
  const saved = directConnection(
    modules,
    [],
    "cards",
    "cards",
    "summary",
    "input",
    "old",
  );
  assert.deepEqual(
    graphOutputs(modules.find((m) => m.type === "cards")!, [saved]),
    ["cards"],
  );
});
