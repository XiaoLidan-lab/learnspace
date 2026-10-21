declare module "word-extractor/lib/word-ole-extractor.js" {
  export default class WordOleExtractor {
    extract(reader: unknown): Promise<{ getBody(): string }>;
  }
}
declare module "word-extractor/lib/buffer-reader.js" {
  export default class BufferReader {
    constructor(buffer: Uint8Array);
    close(): Promise<void>;
  }
}
declare module "process/browser.js" {
  const process: unknown;
  export default process;
}
declare module "buffer/index.js" {
  export { Buffer } from "buffer";
}
