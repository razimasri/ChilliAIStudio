// Original ChilliMark.py placement on the registered 4800 × 6840 scan.
const X = 4271, Y = 256, WIDTH = 273, HEIGHT = 256;
let imagePromise: Promise<HTMLImageElement> | null = null;

function loadPrintmark(): Promise<HTMLImageElement> {
  if (!imagePromise) imagePromise = new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => { imagePromise = null; reject(new Error('Could not load the ChilliMark print watermark.')); };
    image.src = '/icons/printmark.png';
  });
  return imagePromise;
}

/** Bake the original print logo into the exported image, not a UI overlay. */
export async function addWatermark(cv: any, scan: any): Promise<void> {
  if (scan.cols < X + WIDTH || scan.rows < Y + HEIGHT) {
    throw new Error('The print watermark requires a registered scan.');
  }
  const image = await loadPrintmark();
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH; canvas.height = HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not prepare the print watermark.');
  // Python imread discarded alpha; preserve its white printed background.
  context.fillStyle = 'white'; context.fillRect(0, 0, WIDTH, HEIGHT);
  context.drawImage(image, 0, 0, WIDTH, HEIGHT);
  const rgba = cv.imread(canvas);
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
