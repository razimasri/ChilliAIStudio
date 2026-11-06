// Lazy singleton loader for OpenCV.js
let cvInstance: any = null;
let cvPromise: Promise<any> | null = null;

export async function getCV(): Promise<any> {
  if (cvInstance) return cvInstance;
  if (cvPromise) return cvPromise;

  cvPromise = (async () => {
    // If window.cv is already initialized and has Mat
    if (typeof window !== 'undefined' && (window as any).cv && (window as any).cv.Mat) {
      cvInstance = (window as any).cv;
      return cvInstance;
    }

    try {
      // Dynamic import
      const module = await import('@techstark/opencv-js');
      const cvMod = (module as any).default || module;
      if (typeof cvMod.then === 'function') {
        cvInstance = await cvMod;
      } else {
        cvInstance = cvMod;
      }
      return cvInstance;
    } catch (err) {
      console.warn('Failed to load @techstark/opencv-js, checking window.cv fallback', err);
      if (typeof window !== 'undefined' && (window as any).cv) {
        cvInstance = (window as any).cv;
        return cvInstance;
      }
      throw err;
    }
  })();

  return cvPromise;
}
