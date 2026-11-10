import * as pdfjsLib from 'pdfjs-dist';
import { ExamFile } from '../types';
import { PDF_POINTS_PER_INCH, SCAN_DPI } from './pageGeometry';

// Set up worker
try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString();
} catch {
  // fallback if worker URL resolution fails
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;
}

export interface PdfProgressInfo {
  stage: 'reading' | 'parsing' | 'rendering' | 'completed';
  fileName: string;
  currentPage: number;
  totalPages: number;
  percent: number;
  message: string;
}

/**
 * Load an uploaded file (either PDF or Image) and extract pages as ExamFile array
 */
export async function loadExamFile(
  file: File,
  onProgress?: (info: PdfProgressInfo) => void
): Promise<ExamFile[]> {
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    onProgress?.({
      stage: 'reading',
      fileName: file.name,
      currentPage: 0,
      totalPages: 1,
      percent: 5,
      message: `Reading document ${file.name}...`,
    });

    const arrayBuffer = await file.arrayBuffer();

    onProgress?.({
      stage: 'parsing',
      fileName: file.name,
      currentPage: 0,
      totalPages: 1,
      percent: 15,
      message: 'Parsing PDF document structure...',
    });

    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pages: ExamFile[] = [];
    const numPages = pdf.numPages;

    try {
      for (let i = 1; i <= numPages; i++) {
        const pageStartPercent = Math.round(15 + ((i - 1) / numPages) * 80);
        onProgress?.({
          stage: 'rendering',
          fileName: file.name,
          currentPage: i,
          totalPages: numPages,
          percent: pageStartPercent,
          message: `Rasterizing page ${i} of ${numPages} at 600 DPI...`,
        });

        // Give event loop time to render the loading animation and state
        await new Promise((resolve) => setTimeout(resolve, 40));

        const page = await pdf.getPage(i);
        // PDF coordinates use 72 points per inch. Match PyMuPDF's dpi=600;
        // do not resize student pages to the template before registration.
        const viewport = page.getViewport({ scale: SCAN_DPI / PDF_POINTS_PER_INCH });
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error(`Could not create canvas for page ${i}`);

        // Avoid adding a pixel for floating-point noise at exact integers
        // (e.g. an 819pt page can become 6825.000000000001px at 600 DPI).
        canvas.width = Math.ceil(viewport.width - 1e-7);
        canvas.height = Math.ceil(viewport.height - 1e-7);

        await page.render({ canvasContext: ctx, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/png');

        pages.push({
          id: `${file.name}-page-${i}-${Date.now()}`,
          name: `${file.name} (Page ${i})`,
          size: file.size,
          dataUrl,
          rotation: 0,
          pageIndex: i - 1,
          totalPages: pdf.numPages,
          width: canvas.width,
          height: canvas.height,
        });

        const pageEndPercent = Math.round(15 + (i / numPages) * 80);
        onProgress?.({
          stage: 'rendering',
          fileName: file.name,
          currentPage: i,
          totalPages: numPages,
          percent: pageEndPercent,
          message: `Extracted page ${i} of ${numPages} (${canvas.width}×${canvas.height}px)`,
        });
        // Release large raster buffers between pages at the restored resolution.
        canvas.width = 0;
        canvas.height = 0;
        page.cleanup();
      }
    } finally {
      await pdf.destroy();
    }

    onProgress?.({
      stage: 'completed',
      fileName: file.name,
      currentPage: numPages,
      totalPages: numPages,
      percent: 100,
      message: `Successfully loaded all ${numPages} pages!`,
    });

    return pages;
  } else {
    // Image file
    onProgress?.({
      stage: 'reading',
      fileName: file.name,
      currentPage: 1,
      totalPages: 1,
      percent: 30,
      message: `Reading image ${file.name}...`,
    });

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        const img = new Image();
        img.onload = () => {
          onProgress?.({
            stage: 'completed',
            fileName: file.name,
            currentPage: 1,
            totalPages: 1,
            percent: 100,
            message: `Loaded image ${file.name} (${img.naturalWidth}×${img.naturalHeight}px)`,
          });
          resolve([
            {
              id: `${file.name}-${Date.now()}`,
              name: file.name,
              size: file.size,
              dataUrl,
              rotation: 0,
              pageIndex: 0,
              totalPages: 1,
              width: img.naturalWidth || 1200,
              height: img.naturalHeight || 1600,
            },
          ]);
        };
        img.onerror = () => reject(new Error('Failed to load image file'));
        img.src = dataUrl;
      };
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}

/**
 * Load image from URL (e.g. sample images in public/RDimages)
 */
export async function loadImageFromUrl(url: string, name: string): Promise<ExamFile> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context error'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');

      resolve({
        id: `sample-${name}`,
        name,
        size: 250000,
        dataUrl,
        rotation: 0,
        pageIndex: 0,
        totalPages: 1,
        width: canvas.width,
        height: canvas.height,
      });
    };
    img.onerror = () => reject(new Error(`Failed to load sample image from ${url}`));
    img.src = url;
  });
}
