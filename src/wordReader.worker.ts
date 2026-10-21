import { extractLocalWord } from "./wordParser";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    self.postMessage({
      text: await extractLocalWord(new Uint8Array(event.data)),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "Word 读取失败",
    });
  }
};
