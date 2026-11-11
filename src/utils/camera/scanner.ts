import { getCV } from '../cvLoader';
import { canvasBlob } from '../imageStore';
import { createRasterCanvas, drawMat, rasterContext, readRaster } from '../rasterIO';
import { TEMPLATE_WIDTH, TEMPLATE_HEIGHT } from '../pageGeometry';
import { Corners, orderedCorners, pageSize, quadArea, validateCorners } from './geometry';
export interface ScanPreview {
  preview: Blob;
  corners: Corners;
  rotation: number;
  warnings: string[];
  error?: string;
}
export interface PreparedPhoto extends ScanPreview { original: Blob; width: number; height: number; needsCorners: boolean }
export type ScanRequest = { type: 'prepare'; input: Blob } | { type: 'preview' | 'export'; corners: Corners; rotation: number };
const DEFAULT_CORNERS: Corners = [{ x: .06, y: .06 }, { x: .94, y: .06 }, { x: .94, y: .94 }, { x: .06, y: .94 }];

/** Separate camera-only preprocessing; no changes to answer interpretation. */
export class CameraProcessor {
  private cv: any;
  private image: any;
  private width = 0;
  private height = 0;
  dispose() { this.image?.delete(); this.image = undefined; }
  private async encode(mat: any): Promise<Blob> {
    const canvas = createRasterCanvas();
    try { drawMat(this.cv, canvas, mat); return await canvasBlob(canvas); }
    finally { canvas.width = canvas.height = 0; }
  }
  private detect(small: any): Corners | undefined {
    const cv = this.cv, gray = new cv.Mat(), smooth = new cv.Mat(), edges = new cv.Mat(), light = new cv.Mat();
    const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
    let best: Corners | undefined, bestArea = .18;
    try {
      cv.cvtColor(small, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, smooth, new cv.Size(5, 5), 0);
      cv.Canny(smooth, edges, 40, 140);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      cv.threshold(smooth, light, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      for (const mask of [edges, light]) {
        const contours = new cv.MatVector(), hierarchy = new cv.Mat();
        try {
          cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
          for (let i = 0; i < contours.size(); i++) {
            const contour = contours.get(i), approx = new cv.Mat();
            try {
              if (cv.contourArea(contour) < bestArea * small.cols * small.rows) continue;
              for (const epsilon of [.012, .02, .035]) {
                cv.approxPolyDP(contour, approx, epsilon * cv.arcLength(contour, true), true);
                if (approx.rows !== 4 || !cv.isContourConvex(approx)) continue;
                const points = Array.from({ length: 4 }, (_, j) => ({ x: approx.data32S[j * 2] / (small.cols - 1), y: approx.data32S[j * 2 + 1] / (small.rows - 1) }));
                const corners = orderedCorners(points);
                // An edge touching the photo boundary can mean a clipped sheet.
                if (corners.some(p => p.x < .008 || p.y < .008 || p.x > .992 || p.y > .992)) continue;
                // Printed tables can also be quadrilaterals. Require paper/background
                // contrast on three sides before treating one as the outer sheet.
                const center = corners.reduce((s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }), { x: 0, y: 0 });
                const sample = (x: number, y: number) => {
                  let sum = 0;
                  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
                    const px = Math.max(0, Math.min(small.cols - 1, Math.round(x) + dx));
                    const py = Math.max(0, Math.min(small.rows - 1, Math.round(y) + dy));
                    sum += gray.data[py * small.cols + px];
                  }
                  return sum / 25;
                };
                let contrasted = 0;
                for (let side = 0; side < 4; side++) {
                  const a = corners[side], b = corners[(side + 1) % 4];
                  const mx = (a.x + b.x) * (small.cols - 1) / 2, my = (a.y + b.y) * (small.rows - 1) / 2;
                  const dx = center.x * (small.cols - 1) - mx, dy = center.y * (small.rows - 1) - my;
                  const length = Math.hypot(dx, dy), offset = Math.max(small.cols, small.rows) * .015;
                  const ox = dx / length * offset, oy = dy / length * offset;
                  if (sample(mx + ox, my + oy) - sample(mx - ox, my - oy) > 8) contrasted++;
                }
                if (contrasted < 3) continue;
                const area = quadArea(corners);
                if (area > bestArea) { bestArea = area; best = corners; }
              }
            } finally { contour.delete(); approx.delete(); }
          }
        } finally { contours.delete(); hierarchy.delete(); }
      }
      return best;
    } finally { gray.delete(); smooth.delete(); edges.delete(); light.delete(); kernel.delete(); }
  }
  async prepare(input: Blob): Promise<PreparedPhoto> {
    this.dispose();
    this.cv = await getCV();
    const cv = this.cv;
    const url = URL.createObjectURL(input);
    const canvas = createRasterCanvas();
    const small = new cv.Mat();
    try {
      let decoded;
      try { decoded = await readRaster(url); }
      catch { throw new Error('This photograph could not be opened. Try the camera again or choose a JPEG/PNG image instead.'); }
      try {
        // Bound retained pixels on high-megapixel phones; never enlarge the source.
        const scale = Math.min(1, 5000 / Math.max(decoded.width, decoded.height), Math.sqrt(16_000_000 / (decoded.width * decoded.height)));
        this.width = canvas.width = Math.round(decoded.width * scale);
        this.height = canvas.height = Math.round(decoded.height * scale);
        rasterContext(canvas).drawImage(decoded.image, 0, 0, this.width, this.height);
        this.image = cv.matFromImageData(rasterContext(canvas).getImageData(0, 0, this.width, this.height));
      } finally { decoded.release(); }
      const factor = Math.min(1, 1200 / Math.max(this.width, this.height));
      cv.resize(this.image, small, new cv.Size(Math.round(this.width * factor), Math.round(this.height * factor)), 0, 0, cv.INTER_AREA);
      const original = await this.encode(small);
      const detected = this.detect(small);
      const corners = detected || DEFAULT_CORNERS.map(p => ({ ...p })) as Corners;
      const size = pageSize(corners, this.width, this.height);
      const rotation = size.width > size.height ? 1 : 0;
      const result = await this.preview(corners, rotation);
      return { ...result, original, needsCorners: !detected, width: small.cols, height: small.rows,
        error: detected ? result.error : 'No complete page boundary detected. Keep the entire sheet visible on a contrasting surface, or adjust all four corners.' };
    } finally { URL.revokeObjectURL(url); canvas.width = canvas.height = 0; small.delete(); }
  }
  private warp(corners: Corners, rotation: number, edge?: number): any {
    if (!this.image) throw new Error('Choose a photograph first.');
    validateCorners(corners);
    if (!Number.isInteger(rotation) || rotation < 0 || rotation > 3) throw new Error('Choose a quarter-turn page rotation.');
    const cv = this.cv;
    // The sheet is portrait even when perspective foreshortens its projected height.
    // Corner order determines orientation; projected aspect must not constrain it.
    const nativeWidth = TEMPLATE_WIDTH;
    const nativeHeight = TEMPLATE_HEIGHT;
    const scale = edge ? edge / Math.max(nativeWidth, nativeHeight) : 1;
    const width = Math.round(nativeWidth * scale), height = Math.round(nativeHeight * scale);
    const points = corners.map((_, i) => corners[(i + rotation) % 4]);
    const source = cv.matFromArray(4, 1, cv.CV_32FC2, points.flatMap(p => [p.x * (this.width - 1), p.y * (this.height - 1)]));
    const destination = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
    let matrix: any;
    const output = new cv.Mat();
    try {
      matrix = cv.getPerspectiveTransform(source, destination);
      cv.warpPerspective(this.image, output, matrix, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
      return output;
    } catch { output.delete(); throw new Error('Perspective correction failed. Adjust the corners or retake the photograph.'); }
    finally { source.delete(); destination.delete(); matrix?.delete(); }
  }
  async preview(corners: Corners, rotation: number): Promise<ScanPreview> {
    const corrected = this.warp(corners, rotation, 1200);
    const cv = this.cv, gray = new cv.Mat(), lap = new cv.Mat(), mean = new cv.Mat(), std = new cv.Mat();
    try {
      const size = pageSize(corners, this.width, this.height);
      const short = Math.min(size.width, size.height), long = Math.max(size.width, size.height);
      cv.cvtColor(corrected, gray, cv.COLOR_RGBA2GRAY);
      cv.Laplacian(gray, lap, cv.CV_64F);
      cv.meanStdDev(lap, mean, std);
      const sharpness = std.data64F[0] ** 2;
      const warnings: string[] = [];
      let error: string | undefined;
      if (short < 1100 || long < 1550) error = 'The page has too little detail for reliable marking. Move closer and use the original full-resolution photograph.';
      else if (short < 1700) warnings.push('Page resolution is limited. A closer, sharper photograph may improve recognition.');
      if (sharpness < 8) error = 'The page appears blurry or has too little detail. Retake it with the camera steady and the answer boxes in focus.';
      else if (sharpness < 35) warnings.push('The page may be soft. Check the answer boxes carefully before continuing.');
      if (corners.some(p => p.x < .008 || p.y < .008 || p.x > .992 || p.y > .992))
        warnings.push('The page is close to the photograph edge. Confirm no part of the sheet is missing.');
      return { preview: await this.encode(corrected), corners, rotation, warnings, error };
    } finally { corrected.delete(); gray.delete(); lap.delete(); mean.delete(); std.delete(); }
  }
  async export(corners: Corners, rotation: number): Promise<Blob> {
    // Validate the same geometry/quality at confirmation; never silently export stale corners.
    const preview = await this.preview(corners, rotation);
    if (preview.error) throw new Error(preview.error);
    const corrected = this.warp(corners, rotation);
    try { return await this.encode(corrected); } finally { corrected.delete(); }
  }
}
