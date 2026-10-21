export type WordWorker = Pick<
  Worker,
  "onmessage" | "onerror" | "postMessage" | "terminate"
>;
export async function readLocalWord(
  file: Blob,
  makeWorker: () => WordWorker = () =>
    new Worker(new URL("./wordReader.worker.ts", import.meta.url), {
      type: "module",
    }),
): Promise<string> {
  if (!file.size || file.size > 3 * 1024 * 1024)
    throw Error("Word 文件为空或超过 3 MB");
  const bytes = await file.arrayBuffer();
  let worker: WordWorker;
  try {
    worker = makeWorker();
  } catch {
    throw Error(
      "无法启动本地 Word 阅读器，请更新浏览器或刷新重试；文件不会上传",
    );
  }
  return new Promise<string>((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      worker.onmessage = null;
      worker.onerror = null;
    };
    const timer = setTimeout(() => {
      finish();
      reject(Error("Word 读取超时，请拆分文件或另存为 DOCX／TXT"));
    }, 10000);
    worker.onmessage = (event) => {
      finish();
      const result = event.data;
      if (typeof result?.text === "string" && result.text.length <= 1000000)
        resolve(result.text);
      else
        reject(
          Error(
            typeof result?.error === "string"
              ? result.error
              : "Word 读取结果无效",
          ),
        );
    };
    worker.onerror = () => {
      finish();
      reject(Error("本地 Word 阅读器加载或解析失败，请刷新重试；不会上传文件"));
    };
    try {
      worker.postMessage(bytes, [bytes]);
    } catch (error) {
      finish();
      reject(error);
    }
  });
}
