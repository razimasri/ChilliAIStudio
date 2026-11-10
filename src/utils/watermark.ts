import { createRasterCanvas, rasterContext, readRaster } from './rasterIO';
// Original ChilliMark.py placement on the registered 4800 × 6840 scan.
const X = 4271, Y = 256, WIDTH = 273, HEIGHT = 256;
let imagePromise: ReturnType<typeof readRaster> | null = null;
function loadPrintmark(): ReturnType<typeof readRaster> {
  if (!imagePromise) imagePromise = readRaster('/icons/printmark.png').catch(error=>{imagePromise=null;throw error;});
  return imagePromise;
}

/** Bake the original print logo into the exported image, not a UI overlay. */
export async function addWatermark(cv: any, scan: any): Promise<void> {
  if (scan.cols < X + WIDTH || scan.rows < Y + HEIGHT) {
    throw new Error('The print watermark requires a registered scan.');
  }
  const image = await loadPrintmark();
  const canvas = createRasterCanvas();
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = rasterContext(canvas);
  if (!context) throw new Error('Could not prepare the print watermark.');
  // Python imread discarded alpha; preserve its white printed background.
  context.fillStyle = 'white'; context.fillRect(0, 0, WIDTH, HEIGHT);
  context.drawImage(image.image, 0, 0, WIDTH, HEIGHT);
  const rgba = cv.matFromImageData(context.getImageData(0,0,WIDTH,HEIGHT));
  const mark = new cv.Mat();
  let destination: any = null;
  try {
    if (scan.channels() === 3) cv.cvtColor(rgba, mark, cv.COLOR_RGBA2RGB);
    else if (scan.channels() === 1) cv.cvtColor(rgba, mark, cv.COLOR_RGBA2GRAY);
    else rgba.copyTo(mark);
    destination = scan.roi(new cv.Rect(X, Y, WIDTH, HEIGHT));
    mark.copyTo(destination);
  } finally {
    destination?.delete(); mark.delete(); rgba.delete();
    canvas.width = 0; canvas.height = 0;
  }
}
