import * as pdfjsLib from "pdfjs-dist";
import { ExamFile } from "../types";
import { canvasBlob, imageUrl, releaseImage } from "./imageStore";
import { queuePage } from "./pageQueue";
import { PDF_POINTS_PER_INCH, SCAN_DPI } from "./pageGeometry";

// Set up worker
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
} catch {
  // fallback if worker URL resolution fails
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface PdfProgressInfo {
  stage: "reading" | "parsing" | "rendering" | "completed";
  fileName: string;
  currentPage: number;
  totalPages: number;
  percent: number;
  message: string;
}

const sources = new Map<File, Promise<pdfjsLib.PDFDocumentProxy>>();
const thumbnails = new Map<string, { file: File; blob: Blob }>();
let cached:
  { file: File; page: number; rotation: number; blob: Blob } | undefined;

function documentFor(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
  let promise = sources.get(file);
  if (!promise) {
    promise = file
      .arrayBuffer()
      .then((data) => pdfjsLib.getDocument({ data }).promise);
    sources.set(file, promise);
    void promise.catch(() => {
      if (sources.get(file) === promise) sources.delete(file);
    });
  }
  return promise;
}

const placeholder =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="340"><rect width="240" height="340" fill="#f4f4f4"/><text x="120" y="175" text-anchor="middle" fill="#666" font-size="18">Loading preview…</text></svg>',
  );

/** Read page metadata only. No page is rasterized during upload. */
export async function loadExamFile(
  file: File,
  onProgress?: (info: PdfProgressInfo) => void,
): Promise<ExamFile[]> {
  const isPdf =
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  onProgress?.({
    stage: "parsing",
    fileName: file.name,
    currentPage: 0,
    totalPages: 1,
    percent: 10,
    message: `Reading ${file.name}…`,
  });
  const pages: ExamFile[] = [];
  try {
    if (isPdf) {
      const pdf = await documentFor(file);
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({
          scale: SCAN_DPI / PDF_POINTS_PER_INCH,
        });
        pages.push({
          id: crypto.randomUUID(),
          name: `${file.name} (Page ${i})`,
          size: file.size,
          dataUrl: placeholder,
          sourceFile: file,
          sourceKind: "pdf",
          rotation: 0,
          pageIndex: i - 1,
          totalPages: pdf.numPages,
          width: Math.ceil(viewport.width - 1e-7),
          height: Math.ceil(viewport.height - 1e-7),
        });
        page.cleanup();
      }
    } else {
      const url = imageUrl(file);
      try {
        const image = await loadImage(url);
        pages.push({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          dataUrl: placeholder,
          sourceFile: file,
          sourceKind: "image",
          rotation: 0,
          pageIndex: 0,
          totalPages: 1,
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
      } finally {
        releaseImage(url);
      }
    }
    onProgress?.({
      stage: "completed",
      fileName: file.name,
      currentPage: pages.length,
      totalPages: pages.length,
      percent: 100,
      message: `Ready: ${pages.length} page${pages.length === 1 ? "" : "s"}. Previews load as needed.`,
    });
    return pages;
  } catch (error) {
    const source = sources.get(file);
    sources.delete(file);
    if (source) void source.then((pdf) => pdf.destroy()).catch(() => {});
    throw error;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read image."));
    image.src = url;
  });
}

export interface PageImage {
  url: string;
  release: () => void;
  bitmap?: ImageBitmap;
}
/** Return a disposable page image. Full rasters use exactly the existing 600-DPI render settings. */
export function getExamPage(
  file: ExamFile,
  previewEdge?: number,
  signal?: AbortSignal,
): Promise<PageImage> {
  return renderPage(file, previewEdge, signal, false);
}
/** Disposable native pixels for marking: no intermediate PNG encode/decode. */
export function getMarkingPage(
  file: ExamFile,
  signal?: AbortSignal,
): Promise<PageImage> {
  return renderPage(file, undefined, signal, true);
}
/** Speculation uses the same renderer/pixels, at lower priority than requested pages. */
export function prepareMarkingPage(file: ExamFile, signal?: AbortSignal): Promise<PageImage> {
  return renderPage(file, undefined, signal, true, true);
}
export async function warmExamPage(file: ExamFile, signal?: AbortSignal): Promise<void> {
  const page = await renderPage(file, undefined, signal, false, true);
  page.release(); // The existing one-page compressed cache retains the raster.
}
function renderPage(
  file: ExamFile,
  previewEdge: number | undefined,
  signal: AbortSignal | undefined,
  asBitmap: boolean,
  speculative = false,
): Promise<PageImage> {
  return queuePage(
    async () => {
      if (!file.sourceFile) {
        if (!asBitmap) return { url: file.dataUrl, release: () => {} };
        const response = await fetch(file.dataUrl, { signal });
        if (!response.ok) throw new Error("Could not read page image.");
        const bitmap = await createImageBitmap(await response.blob());
        if (signal?.aborted) {
          bitmap.close();
          signal.throwIfAborted();
        }
        return { url: file.dataUrl, bitmap, release: () => bitmap.close() };
      }
      const thumbnailKey = `${file.id}:${file.rotation}:${previewEdge}`;
      const thumbnail = previewEdge && thumbnails.get(thumbnailKey);
      if (thumbnail) {
        thumbnails.delete(thumbnailKey);
        thumbnails.set(thumbnailKey, thumbnail);
        const url = imageUrl(thumbnail.blob);
        return { url, release: () => releaseImage(url) };
      }
      if (
        !previewEdge &&
        cached?.file === file.sourceFile &&
        cached.page === file.pageIndex &&
        cached.rotation === file.rotation
      ) {
        if (asBitmap) {
          const bitmap = await createImageBitmap(cached.blob);
          if (signal?.aborted) {
            bitmap.close();
            signal.throwIfAborted();
          }
          return { url: file.dataUrl, bitmap, release: () => bitmap.close() };
        }
        const url = imageUrl(cached.blob);
        return { url, release: () => releaseImage(url) };
      }
      const canvas = document.createElement("canvas");
      let page: pdfjsLib.PDFPageProxy | undefined;
      let sourceUrl: string | undefined;
      let rotated: HTMLCanvasElement | undefined;
      const abort = () => renderTask?.cancel();
      let renderTask: pdfjsLib.RenderTask | undefined;
      try {
        signal?.throwIfAborted();
        if (file.sourceKind === "pdf") {
          const pdf = await documentFor(file.sourceFile);
          page = await pdf.getPage(file.pageIndex + 1);
          const native = page.getViewport({
            scale: SCAN_DPI / PDF_POINTS_PER_INCH,
          });
          const viewport = previewEdge
            ? page.getViewport({
                scale:
                  (SCAN_DPI / PDF_POINTS_PER_INCH) *
                  Math.min(
                    1,
                    previewEdge / Math.max(native.width, native.height),
                  ),
              })
            : native;
          canvas.width = Math.ceil(viewport.width - 1e-7);
          canvas.height = Math.ceil(viewport.height - 1e-7);
          const context = canvas.getContext("2d");
          if (!context) throw new Error("Could not create page canvas.");
          renderTask = page.render({ canvasContext: context, viewport });
          signal?.addEventListener("abort", abort, { once: true });
          if (signal?.aborted) renderTask.cancel();
          await renderTask.promise;
        } else {
          sourceUrl = imageUrl(file.sourceFile);
          const image = await loadImage(sourceUrl);
          const scale = previewEdge
            ? Math.min(
                1,
                previewEdge / Math.max(image.naturalWidth, image.naturalHeight),
              )
            : 1;
          canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
          canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
          canvas
            .getContext("2d")!
            .drawImage(image, 0, 0, canvas.width, canvas.height);
        }
        signal?.throwIfAborted();
        let output = canvas;
        if (file.rotation) {
          rotated = document.createElement("canvas");
          const quarter = file.rotation % 180 !== 0;
          rotated.width = quarter ? canvas.height : canvas.width;
          rotated.height = quarter ? canvas.width : canvas.height;
          const context = rotated.getContext("2d")!;
          context.translate(rotated.width / 2, rotated.height / 2);
          context.rotate((file.rotation * Math.PI) / 180);
          context.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
          output = rotated;
        }
        if (asBitmap) {
          const bitmap = await createImageBitmap(output);
          if (signal?.aborted) {
            bitmap.close();
            signal.throwIfAborted();
          }
          return { url: file.dataUrl, bitmap, release: () => bitmap.close() };
        }
        const blob = await canvasBlob(output);
        signal?.throwIfAborted();
        if (previewEdge && previewEdge <= 512) {
          thumbnails.set(thumbnailKey, { file: file.sourceFile, blob });
          while (thumbnails.size > 24)
            thumbnails.delete(thumbnails.keys().next().value!);
        }
        if (!previewEdge)
          cached = {
            file: file.sourceFile,
            page: file.pageIndex,
            rotation: file.rotation,
            blob,
          };
        const url = imageUrl(blob);
        return { url, release: () => releaseImage(url) };
      } finally {
        signal?.removeEventListener("abort", abort);
        page?.cleanup();
        releaseImage(sourceUrl);
        canvas.width = 0;
        canvas.height = 0;
        if (rotated) {
          rotated.width = 0;
          rotated.height = 0;
        }
      }
    },
    !!previewEdge || speculative,
    signal,
  );
}

/** Release PDF workers once no retained page uses their source file. */
export function releaseUnusedSources(
  previous: ExamFile[],
  next: ExamFile[],
): void {
  const retained = new Set(next.map((page) => page.sourceFile));
  for (const file of new Set(previous.map((page) => page.sourceFile))) {
    if (!file || retained.has(file)) continue;
    const source = sources.get(file);
    sources.delete(file);
    if (cached?.file === file) cached = undefined;
    for (const [key, entry] of thumbnails)
      if (entry.file === file) thumbnails.delete(key);
    if (source) void source.then((pdf) => pdf.destroy()).catch(() => {});
  }
}
