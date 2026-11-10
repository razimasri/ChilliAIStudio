export interface ArchiveEntry {
  name: string;
  data: Blob | string;
}
/** A bounded, disposable worker keeps ZIP assembly off the interface thread. */
export function exportArchive(
  entries: ArchiveEntry[],
  progress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./archive.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const cancel = () => {
      finish();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Archive worker failed."));
    };
    worker.onmessage = (event) => {
      if (event.data.error) {
        finish();
        reject(new Error(event.data.error));
      } else if (event.data.blob) {
        finish();
        resolve(event.data.blob);
      } else if (typeof event.data.percent === "number")
        progress(event.data.percent);
    };
    worker.postMessage({ entries });
  });
}
