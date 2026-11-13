import type {CalibrationParams, StudentResult} from '../types';
import {MarkingClient} from './markingClient';
import {workerPlan} from './workerPolicy';
import {releaseImage} from './imageStore';
import {TEMPLATE_WIDTH, TEMPLATE_HEIGHT} from './pageGeometry';

/** Finalize each corrected sheet once, with the same device memory limits as marking. */
export async function finalizeAnnotations(
  students: StudentResult[],
  params: CalibrationParams,
  signal: AbortSignal,
  progress: (student: StudentResult, completed: number, total: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  const pending = students.filter(student => student.rawDeskewedDataUrl);
  if (!pending.length) return;
  const count = workerPlan(pending.map(() => ({width:TEMPLATE_WIDTH,height:TEMPLATE_HEIGHT}))).initial;
  const clients: MarkingClient[] = [];
  const cancel = () => clients.forEach(client => client.dispose());
  signal.addEventListener('abort', cancel, {once:true});
  let next = 0, completed = 0, failed = false, failure: unknown;
  try {
    for (let i=0;i<count;i++) clients.push(new MarkingClient());
    const settled = await Promise.allSettled(clients.map(async client => {
      try {
        while(next < pending.length) {
          signal.throwIfAborted();
          const student = pending[next++];
          progress(student, completed, pending.length);
          const image = await client.annotate(student, params);
          if(signal.aborted || failed) {
            releaseImage(image);
            signal.throwIfAborted();
            throw failure;
          }
          const previous = student.annotatedDataUrl;
          student.annotatedDataUrl = image;
          if(previous !== student.rawDeskewedDataUrl) releaseImage(previous);
          completed++;
          progress(student, completed, pending.length);
        }
      } catch(error) {
        if(!failed) {failed = true; failure = error;}
        cancel();
        throw error;
      }
    }));
    signal.throwIfAborted();
    if(failed) throw failure;
    const rejected = settled.find(result => result.status === 'rejected');
    if(rejected?.status === 'rejected') throw rejected.reason;
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
  }
}
