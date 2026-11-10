// Canvas/image boundary shared by the existing engine and background workers.
export type RasterCanvas = HTMLCanvasElement | OffscreenCanvas;
export function createRasterCanvas(width = 1, height = 1): RasterCanvas {
  if (typeof document === "undefined")
    return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
export function rasterContext(
  canvas: RasterCanvas,
): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not create image context.");
  return context as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}
export async function readRaster(
  url: string,
): Promise<{
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof document === "undefined") {
    const response = await fetch(url);
    if (!response.ok) throw new Error("Could not read scan image.");
    const image = await createImageBitmap(await response.blob());
    return {
      image,
      width: image.width,
      height: image.height,
      release: () => image.close(),
    };
  }
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read scan image."));
    img.src = url;
  });
  return {
    image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => {},
  };
}
/** OpenCV's DOM-only imshow adapter, with the same conversion for OffscreenCanvas. */
export function drawMat(cv: any, canvas: RasterCanvas, mat: any): void {
  if (typeof document !== "undefined") {
    cv.imshow(canvas, mat);
    return;
  }
  const image = new cv.Mat();
  try {
    const depth = mat.type() % 8;
    const scale = depth <= cv.CV_8S ? 1 : depth <= cv.CV_32S ? 1 / 256 : 255;
    const shift = depth === cv.CV_8S || depth === cv.CV_16S ? 128 : 0;
    mat.convertTo(image, cv.CV_8U, scale, shift);
    switch (image.type()) {
      case cv.CV_8UC1:
        cv.cvtColor(image, image, cv.COLOR_GRAY2RGBA);
        break;
      case cv.CV_8UC3:
        cv.cvtColor(image, image, cv.COLOR_RGB2RGBA);
        break;
      case cv.CV_8UC4:
        break;
      default:
        throw new Error("Unsupported image channels.");
    }
    const pixels = new ImageData(
      new Uint8ClampedArray(image.data),
      image.cols,
      image.rows,
    );
    canvas.width = image.cols;
    canvas.height = image.rows;
    rasterContext(canvas).putImageData(pixels, 0, 0);
  } finally {
    image.delete();
  }
}
