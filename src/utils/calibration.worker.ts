/// <reference lib="webworker" />
import type { CalibrationParams } from '../types';
import { measureSelectedBox } from './calibrationSelection';
import { getCV } from './cvLoader';
import {
  renderToCanonicalMat,
  renderScanMat,
  rotation,
  decodeCVError,
} from './omrEngine';
import { imageUrl, canvasBlob, releaseAllImages } from './imageStore';
import { createRasterCanvas, drawMat, rasterContext } from './rasterIO';
import {
  CALIBRATION_PREVIEW_EDGE,
  CALIBRATION_PREVIEW_WIDTH,
} from './calibrationPreview';
let alignedImage: any;
self.onmessage = async (
  event: MessageEvent<{
    input?: Blob;
    params?: CalibrationParams;
    area?: { x1: number; y1: number; x2: number; y2: number };
  }>,
) => {
  let cv: any, rotated: any;
  const full = createRasterCanvas(),
    preview = createRasterCanvas();
  try {
    self.postMessage({
      type: 'progress',
      message: 'Loading the calibration engine…',
    });
    cv = await getCV();
    if (event.data.params && event.data.area) {
      const params = event.data.params,
        area = event.data.area;
      if (event.data.input) {
        const decoded = await renderScanMat(cv, imageUrl(event.data.input));
        alignedImage?.delete();
        alignedImage = decoded;
      }
      if (!alignedImage) throw new Error('The calibration image is not ready.');
      const box = measureSelectedBox(
        cv,
        alignedImage,
        area.x1,
        area.y1,
        area.x2,
        area.y2,
      );
      self.postMessage({ type: 'ready', box });
      return;
    }
    self.postMessage({
      type: 'progress',
      message: 'Aligning the full-resolution page…',
    });
    alignedImage?.delete();
    alignedImage = undefined;
    if (!event.data.input) throw new Error('No calibration page supplied.');
    const raw = await renderToCanonicalMat(cv, imageUrl(event.data.input));
    let result: ReturnType<typeof rotation>;
    try {
      result = rotation(cv, raw);
      rotated = result.rotated;
    } finally {
      raw.delete();
    }
    alignedImage = rotated;
    rotated = undefined;
    drawMat(cv, full, alignedImage);
    preview.width = CALIBRATION_PREVIEW_WIDTH;
    preview.height = CALIBRATION_PREVIEW_EDGE;
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
