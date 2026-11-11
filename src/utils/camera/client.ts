import type { CameraProcessor, ScanRequest } from './scanner';
function canUseCameraWorker(): boolean {
  try {
    return typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' &&
      typeof createImageBitmap !== 'undefined' && Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
  } catch { return false; }
}
/** Only instantiated after camera input. Termination releases the retained photo and CV heap. */
export class CameraClient {
  private worker?: Worker;
  private fallback?: CameraProcessor;
  private closed = false;
  private busy = false;
  private reject?: (error: Error) => void;
  async request<T>(request: ScanRequest, progress: (message: string) => void): Promise<T> {
    if (this.closed) throw new Error('Camera session closed.');
    if (this.busy) throw new Error('The photograph is still being processed.');
    this.busy = true;
    try {
      if (canUseCameraWorker()) {
        if (!this.worker) this.worker = new Worker(new URL('./camera.worker.ts', import.meta.url), { type: 'module' });
        const worker = this.worker;
        return await new Promise<T>((resolve, reject) => {
          this.reject = reject;
          worker.onmessage = event => {
            if (this.closed) return;
            const reply = event.data;
            if (reply.type === 'progress') { progress(reply.message); return; }
            this.reject = undefined;
            worker.onmessage = worker.onerror = worker.onmessageerror = null;
            if (reply.type === 'ready') resolve(reply.result);
            else reject(new Error(reply.message));
          };
          worker.onerror = worker.onmessageerror = () => {
            this.reject = undefined;
            worker.terminate(); this.worker = undefined;
            reject(new Error('Camera processing stopped. Retake the photograph or use Choose files.'));
          };
          worker.postMessage(request);
        });
      }
      // Compatibility fallback for browsers without worker canvas support.
      progress('Preparing photograph…');
      await new Promise(resolve => setTimeout(resolve, 0));
      const { CameraProcessor } = await import('./scanner');
      if (this.closed) throw new Error('Camera session closed.');
      this.fallback ||= new CameraProcessor();
      const scanner = this.fallback;
      const result = request.type === 'inspect' ? await scanner.inspect(request.frame)
        : request.type === 'capture' ? await scanner.capture(request.input, request.upright)
        : request.type === 'prepare' ? await scanner.prepare(request.input)
        : request.type === 'preview' ? await scanner.preview(request.corners, request.rotation)
        : await scanner.export(request.corners, request.rotation);
      if (this.closed) { scanner.dispose(); throw new Error('Camera session closed.'); }
      return result as T;
    } finally { this.busy = false; if (this.closed) this.fallback?.dispose(); }
  }
  dispose() {
    this.closed = true;
    this.worker?.terminate(); this.worker = undefined;
    this.reject?.(new Error('Camera session closed.')); this.reject = undefined;
    if (!this.busy) this.fallback?.dispose();
  }
}
