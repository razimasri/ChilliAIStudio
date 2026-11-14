/** PDF-only compression. Keep marking pixels and lossless PNG downloads untouched. */
export async function pdfPageJpeg(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
  let canvas: OffscreenCanvas | undefined;
  try {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not prepare the annotated PDF image.');
    // JPEG has no alpha channel. Transparent areas must print white.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    const jpeg = await canvas.convertToBlob({type: 'image/jpeg', quality: 0.9});
    if (jpeg.type !== 'image/jpeg') throw new Error('JPEG encoding is unavailable for PDF export.');
    return jpeg;
  } finally {
    bitmap.close();
    if (canvas) {canvas.width = 0; canvas.height = 0;}
  }
}
