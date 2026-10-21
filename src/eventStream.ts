// Shared SSE framing for provider and browser transports. Handles UTF-8/network boundaries.
export async function* eventData(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done
        ? decoder.decode()
        : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        if (frame.length > 200000) throw Error("流式数据格式异常");
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n");
        if (data) yield data;
      }
      if (buffer.length > 200000) throw Error("流式数据格式异常");
      if (done) break;
    }
    if (buffer.trim()) throw Error("流式响应意外中断，请重试");
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readTextStream(
  response: Response,
  onText: (text: string) => void,
  structured = false,
) {
  if (!response.body) throw Error("浏览器无法读取流式响应");
  let text = "";
  for await (const data of eventData(response.body)) {
    const event = JSON.parse(data);
    if (typeof event.error === "string") throw Error(event.error);
    if (typeof event.delta === "string") {
      text += event.delta;
      if (text.length > 100000) throw Error("模型返回内容过大");
      onText(text);
    }
    if (Object.hasOwn(event, "result")) {
      if (structured || typeof event.result === "string") return event.result;
      throw Error("AI 服务返回格式异常，请稍后重试");
    }
  }
  throw Error("回答传输中断，已显示内容尚未完成，请重试");
}
