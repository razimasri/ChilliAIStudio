import type { CalibrationParams } from '../types';
import type { measureSelectedBox } from './calibrationSelection';
export interface PreparedCalibration {
  image: Blob;
  thumbnail: Blob;
  rect: [number, number, number, number];
  angle: number;
}
export interface MeasuredCalibration {
  box: ReturnType<typeof measureSelectedBox>;
}
type Area = { x1: number; y1: number; x2: number; y2: number };
type Request = { input?: Blob; params?: CalibrationParams; area?: Area };
/** One runtime and one aligned Mat per calibration screen, never per exam page. */
export class CalibrationClient {
  private worker?: Worker;
  private closed = false;
  private cached = false;
  private alignedInput?: Blob;
  private pending?: {
    resolve: (reply: any) => void;
    reject: (error: Error) => void;
    progress: (message: string) => void;
    cleanup: () => void;
  };
  private stop(error: Error) {
    this.worker?.terminate();
    this.worker = undefined;
    this.cached = false;
    const pending = this.pending;
    this.pending = undefined;
    pending?.cleanup();
    pending?.reject(error);
  }
  private request<T>(
    request: Request,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<T> {
    signal.throwIfAborted();
    if (this.closed)
      return Promise.reject(new Error('Calibration session is closed.'));
    if (this.pending)
      return Promise.reject(
        new Error('Calibration is already processing a selection.'),
      );
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        const worker = new Worker(
          new URL('./calibration.worker.ts', import.meta.url),
          { type: 'module' },
        );
        this.worker = worker;
        worker.onmessage = (event) => {
          if (this.worker !== worker || !this.pending) return;
          const reply = event.data;
          if (reply.type === 'progress') {
            this.pending.progress(reply.message);
            return;
          }
          const pending = this.pending;
          this.pending = undefined;
          pending.cleanup();
          if (reply.type === 'ready') pending.resolve(reply);
          else
            pending.reject(
              new Error(reply.message || 'Could not calibrate the page.'),
            );
        };
        worker.onerror = () => {
          if (this.worker === worker)
            this.stop(
              new Error('Could not initialize background calibration.'),
            );
        };
        worker.onmessageerror = () => {
          if (this.worker === worker)
            this.stop(
              new Error('Could not read background calibration output.'),
            );
        };
      }
      const abort = () =>
        this.stop(new DOMException('Cancelled', 'AbortError'));
      this.pending = {
        resolve,
        reject,
        progress,
        cleanup: () => signal.removeEventListener('abort', abort),
      };
      signal.addEventListener('abort', abort, { once: true });
      try {
        this.worker.postMessage(request);
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
  async prepare(
    input: Blob,
    signal: AbortSignal,
    progress: (message: string) => void,
  ): Promise<PreparedCalibration> {
    if (this.pending)
      throw new Error('Calibration is already processing a selection.');
    this.cached = false;
    this.alignedInput = undefined;
    const result = await this.request<PreparedCalibration>(
      { input },
      signal,
      progress,
    );
    signal.throwIfAborted();
    this.alignedInput = result.image;
    this.cached = true;
    return result;
  }
  async measure(
    params: CalibrationParams,
    area: Area,
    signal: AbortSignal,
  ): Promise<MeasuredCalibration> {
    if (!this.alignedInput)
      throw new Error(
        'Prepare the full-resolution page before measuring a box.',
      );
    const result = await this.request<MeasuredCalibration>(
      { params, area, input: this.cached ? undefined : this.alignedInput },
      signal,
      () => {},
    );
    signal.throwIfAborted();
    this.cached = true;
    return result;
  }
  dispose() {
    this.closed = true;
    this.stop(new DOMException('Cancelled', 'AbortError'));
    this.alignedInput = undefined;
  }
}
// Disposable preparation helper used by native calibration regression tests.
export async function prepareCalibration(
  input: Blob,
  signal: AbortSignal,
  progress: (message: string) => void,
) {
  const client = new CalibrationClient();
  try {
    return await client.prepare(input, signal, progress);
  } finally {
    client.dispose();
  }
}
