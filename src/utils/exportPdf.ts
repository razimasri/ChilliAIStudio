import type { StudentResult, QuestionStat } from '../types';
export interface PdfReport {
  students: Pick<StudentResult, 'name' | 'score' | 'total' | 'percentage' | 'responses' | 'annotatedDataUrl'>[];
  stats: QuestionStat[];
  answerKey: Record<number, string>;
}
/** Sequential image embedding in a disposable worker keeps export off the UI thread. */
export function exportAnnotatedPdf(report: PdfReport, progress: (percent: number) => void, signal?: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { signal?.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => { finish(); reject(new Error(event.message || 'Could not create PDF.')); };
    worker.onmessage = ({ data }) => {
      if (data.error) { finish(); reject(new Error(data.error)); }
      else if (data.blob) { finish(); resolve(data.blob); }
      else progress(data.percent);
    };
    worker.postMessage(report);
  });
}
