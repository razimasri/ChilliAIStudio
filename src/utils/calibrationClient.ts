export interface PreparedCalibration {
  image: Blob;
  thumbnail: Blob;
  rect: [number, number, number, number];
  angle: number;
}
/** Keep full-resolution alignment off the selection UI thread; cancel on navigation. */
export function prepareCalibration(
  input: Blob,
  signal: AbortSignal,
  progress: (message: string) => void,
): Promise<PreparedCalibration> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./calibration.worker.ts', import.meta.url),
      { type: 'module' },
    );
    let settled = false;
    const finish = (
      error?: Error | DOMException,
      result?: PreparedCalibration,
    ) => {
      if (settled) return;
      settled = true;
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event) => {
      if (settled) return;
      const reply = event.data;
      if (reply.type === 'progress') progress(reply.message);
      else if (reply.type === 'ready') finish(undefined, reply);
      else finish(new Error(reply.message || 'Could not align page.'));
    };
    worker.onerror = () =>
      finish(new Error('Could not initialize background calibration.'));
    worker.onmessageerror = () =>
      finish(new Error('Could not read background calibration output.'));
    try {
      worker.postMessage({ input });
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
