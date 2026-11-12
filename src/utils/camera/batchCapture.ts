import { canvasBlob } from '../imageStore';
import type { CapturedPage } from './scanner';
export interface BatchPage { id: string; file: File; thumbnail: Blob; warnings: string[]; rotation: number }
/** Keep compressed files only. Existing upload/marking code owns decoding after handoff. */
export function collectedPage(captured: CapturedPage): BatchPage {
  return { id: crypto.randomUUID(), file: new File([captured.image], 'Camera-sheet.png', { type: 'image/png' }),
    thumbnail: captured.thumbnail, warnings: captured.warnings, rotation: 0 };
}
/** A failed retake never reaches this operation, so the previous page remains intact. */
export function placeCapture(pages: BatchPage[], page: BatchPage, replaceId?: string): BatchPage[] {
  if (!replaceId) return [...pages, page];
  if (!pages.some(p => p.id === replaceId)) throw new Error('The sheet selected for retake is no longer in this batch.');
  return pages.map(previous => previous.id === replaceId ? { ...page, id: previous.id } : previous);
}
export function cameraError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera access was not allowed. Enable camera access in your browser, then try again. You can also use Camera Scan or Choose files.';
    if (error.name === 'NotFoundError') return 'No camera was found. Use Camera Scan or Choose files instead.';
    if (error.name === 'NotReadableError') return 'The camera could not be opened. Close other apps using it, then try again.';
    if (error.name === 'OverconstrainedError') return 'This camera cannot provide the requested image. Try Camera Scan or Choose files.';
  }
  return error instanceof Error ? error.message : 'The scan could not be captured. Please try again.';
}
/** Prefer full-resolution still capture; use the displayed video frame where unavailable. */
export async function photograph(video: HTMLVideoElement, track: MediaStreamTrack): Promise<Blob> {
  if (track.readyState !== 'live') throw new Error('The camera stopped before this sheet was captured. Open the camera again and retry.');
  const ImageCapture = (globalThis as any).ImageCapture;
  if (ImageCapture) {
    try { return await new ImageCapture(track).takePhoto(); } catch { /* Safari and some camera drivers need video capture. */ }
  }
  if (track.readyState !== 'live') throw new Error('The camera stopped before this sheet was captured. Open the camera again and retry.');
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('The camera is not ready. Wait for the preview, then capture again.');
  const canvas = document.createElement('canvas');
  try {
    const scale = Math.min(1, 5000 / Math.max(video.videoWidth, video.videoHeight), Math.sqrt(16_000_000 / (video.videoWidth * video.videoHeight)));
    canvas.width = Math.round(video.videoWidth * scale); canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not capture this camera image. Try Camera Scan instead.');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally { canvas.width = canvas.height = 0; }
}

/** Only a tiny canvas is read back during automatic detection, never the full video. */
export function detectionFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): ImageData {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) throw new Error('Camera is not ready');
  const factor = Math.min(1, 480 / Math.max(video.videoWidth, video.videoHeight));
  canvas.width = Math.round(video.videoWidth * factor); canvas.height = Math.round(video.videoHeight * factor);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Camera preview analysis is unavailable');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
