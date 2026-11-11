/// <reference lib="webworker" />
import { CameraProcessor, ScanRequest } from './scanner';
const scanner = new CameraProcessor();
self.onmessage = async (event: MessageEvent<ScanRequest>) => {
  try {
    self.postMessage({ type: 'progress', message: event.data.type === 'prepare' ? 'Opening photograph and finding page edges…' : event.data.type === 'export' ? 'Preparing the full-resolution corrected page…' : 'Updating corrected preview…' });
    const request = event.data;
    const result = request.type === 'prepare' ? await scanner.prepare(request.input)
      : request.type === 'preview' ? await scanner.preview(request.corners, request.rotation)
      : await scanner.export(request.corners, request.rotation);
    self.postMessage({ type: 'ready', result });
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'The photograph could not be processed. Try a clearer image or adjust the page corners.' });
  }
};
