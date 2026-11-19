import type { StudentResult, QuestionStat } from '../types';
export interface PdfReport {
  students: Pick<StudentResult, 'name' | 'score' | 'total' | 'percentage' | 'responses' | 'annotatedDataUrl'>[];
  stats: QuestionStat[];
  answerKey: Record<number, string>;
}
export interface PreparedPdf { pdf: Blob; sheets: Blob[] }
/** Sequential image embedding in a disposable worker keeps export off the UI thread. */
function runPdf(report: PdfReport, progress: (percent: number) => void, signal: AbortSignal | undefined, includeSheets: boolean): Promise<PreparedPdf> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { signal?.removeEventListener('abort', cancel); worker.terminate(); };
    const cancel = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
    worker.onerror = event => { finish(); reject(new Error(event.message || 'Could not create PDF.')); };
    worker.onmessage = ({ data }) => {
      if (data.error) { finish(); reject(new Error(data.error)); }
      else if (data.blob) { finish(); resolve({ pdf: data.blob, sheets: data.sheets ?? [] }); }
      else progress(data.percent);
    };
    worker.postMessage({ ...report, includeSheets });
  });
}

export function exportAnnotatedPdf(report: PdfReport, progress: (percent: number) => void, signal?: AbortSignal): Promise<Blob> {
  return runPdf(report, progress, signal, false).then(result => result.pdf);
}

/** Reuse the PDF encoder's JPEGs for the archive without decoding the pages twice. */
export function prepareAnnotatedPdf(report: PdfReport, progress: (percent: number) => void, signal?: AbortSignal): Promise<PreparedPdf> {
  return runPdf(report, progress, signal, true);
}
