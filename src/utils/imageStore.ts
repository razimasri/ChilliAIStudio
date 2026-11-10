// Keep lossless images as Blobs. Owners release their URLs when no longer used.
const urls = new Set<string>();
export function imageUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  urls.add(url);
  return url;
}
export function releaseImage(url?: string): void {
  if (url && urls.delete(url)) URL.revokeObjectURL(url);
}
export function releaseAllImages(): void {
  for (const url of [...urls]) releaseImage(url);
}
export function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("Could not encode image.")),
      "image/png",
    ),
  );
}
export async function canvasImage(canvas: HTMLCanvasElement): Promise<string> {
  return imageUrl(await canvasBlob(canvas));
}

export function releaseResultImages(
  results: import("../types").StudentResult[],
): void {
  for (const result of results) {
    for (const url of [
      result.annotatedDataUrl,
      result.rawDeskewedDataUrl,
      result.originalDataUrl,
      ...Object.values(result.ambiguityCrops || {}),
    ])
      releaseImage(url);
  }
}
