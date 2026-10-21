import * as pdfjs from "pdfjs-dist";
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
pdfjs.GlobalWorkerOptions.workerSrc = worker;
export { pdfjs };

// Let PDF.js request document bytes in ranges where the browser supports it.
// Page text is extracted separately, one page at a time.
export function openPdf(file: Blob) {
  const url = URL.createObjectURL(file);
  const task = pdfjs.getDocument({
    url,
    rangeChunkSize: 65536,
    disableAutoFetch: true,
    disableStream: true,
  });
  let released = false;
  return {
    promise: task.promise,
    destroy: async () => {
      if (released) return;
      released = true;
      try {
        await task.destroy();
      } finally {
        URL.revokeObjectURL(url);
      }
    },
  };
}
