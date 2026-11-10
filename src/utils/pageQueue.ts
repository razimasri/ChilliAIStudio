// One raster operation at a time. Calibration/marking take priority over previews.
type Job = { run: () => Promise<void>; signal?: AbortSignal };
const urgent: Job[] = [],
  previews: Job[] = [];
let running = false;
export function queuePage<T>(
  task: () => Promise<T>,
  preview = false,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const job: Job = {
      signal,
      run: async () => {
        if (signal?.aborted) {
          reject(new DOMException("Cancelled", "AbortError"));
          return;
        }
        try {
          resolve(await task());
        } catch (error) {
          reject(error);
        }
      },
    };
    (preview ? previews : urgent).push(job);
    void drain();
  });
}
async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    while (urgent.length || previews.length) {
      await (urgent.shift() || previews.shift())!.run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    running = false;
  }
}
