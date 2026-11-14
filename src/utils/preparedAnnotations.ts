import type { CalibrationParams, StudentResult } from '../types';
import { finalizeAnnotations } from './finalizeAnnotations';

/** Shared native renders: a preview can finish before the rest of the class. */
export class PreparedAnnotations {
  readonly controller = new AbortController();
  private job?: Promise<void>;
  private waiters = new Map<StudentResult, {resolve: () => void; reject: (error: unknown) => void; promise: Promise<void>}>();
  onReady?: (student: StudentResult) => void;
  constructor(private students: StudentResult[], private params?: CalibrationParams) {}

  all(): Promise<void> {
    this.controller.signal.throwIfAborted();
    if (this.job) return this.job;
    const pending = this.students.filter(student => student.annotationPending);
    if (!pending.length) return Promise.resolve();
    if (pending.some(student => !student.rawDeskewedDataUrl)) return Promise.reject(Error('Cleaned scan is missing for a corrected sheet'));
    if (!this.params) return Promise.reject(Error('Calibration is required to prepare corrected sheets'));
    for (const student of pending) {
      let resolve!: () => void, reject!: (error: unknown) => void;
      const promise = new Promise<void>((yes, no) => {resolve = yes; reject = no;});
      // Some sheets are only consumed by the batch, rather than an individual preview.
      void promise.catch(() => {});
      this.waiters.set(student, {resolve, reject, promise});
    }
    const job = finalizeAnnotations(pending, this.params, this.controller.signal, student => {
      if (!student.annotationPending) {
        this.waiters.get(student)?.resolve();
        this.onReady?.(student);
      }
    });
    this.job = job;
    void job.catch(error => {
      for (const waiter of this.waiters.values()) waiter.reject(error);
      if (this.job === job) this.job = undefined;
    });
    return job;
  }

  sheet(student: StudentResult): Promise<void> {
    if (!student.annotationPending) return Promise.resolve();
    const all = this.all();
    // Observe batch errors even when only one sheet is requested.
    void all.catch(() => {});
    return this.waiters.get(student)?.promise ?? all;
  }

  dispose(): void {
    this.controller.abort();
    this.onReady = undefined;
  }
}
