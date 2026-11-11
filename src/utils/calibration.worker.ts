/// <reference lib="webworker" />
import { getCV } from './cvLoader';
import { renderToCanonicalMat, rotation, decodeCVError } from './omrEngine';
import { imageUrl, canvasBlob, releaseAllImages } from './imageStore';
import { createRasterCanvas, drawMat, rasterContext } from './rasterIO';
import {
  CALIBRATION_PREVIEW_EDGE,
  CALIBRATION_PREVIEW_WIDTH,
} from './calibrationPreview';
self.onmessage = async (event: MessageEvent<{ input: Blob }>) => {
  let cv: any, rotated: any;
  const full = createRasterCanvas(),
    preview = createRasterCanvas(
      CALIBRATION_PREVIEW_WIDTH,
      CALIBRATION_PREVIEW_EDGE,
    );
  try {
    self.postMessage({
      type: 'progress',
      message: 'Loading the calibration engine…',
    });
    cv = await getCV();
    self.postMessage({
      type: 'progress',
      message: 'Aligning the full-resolution page…',
    });
    const raw = await renderToCanonicalMat(cv, imageUrl(event.data.input));
    let result: ReturnType<typeof rotation>;
    try {
      result = rotation(cv, raw);
      rotated = result.rotated;
    } finally {
      raw.delete();
    }
    drawMat(cv, full, rotated);
    rotated.delete();
    rotated = undefined;
    rasterContext(preview).drawImage(full, 0, 0, preview.width, preview.height);
    const [image, thumbnail] = await Promise.all([
      canvasBlob(full),
      canvasBlob(preview),
    ]);
    self.postMessage({
      type: 'ready',
      image,
      thumbnail,
      rect: result.rect,
      angle: result.angle,
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: decodeCVError(cv, error) });
  } finally {
    rotated?.delete();
    full.width = full.height = preview.width = preview.height = 0;
    releaseAllImages();
  }
};
