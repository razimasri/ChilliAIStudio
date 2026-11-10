// Use the same npm OpenCV runtime as marking, initialized once on demand.
let cvPromise: Promise<any> | null = null;
export function getCV(): Promise<any> {
  if (!cvPromise) {
    cvPromise = import("@techstark/opencv-js")
      .then(async (module) => {
        const cv = await ((module as any).default || module);
        if (!cv?.Mat) throw new Error("OpenCV did not initialize.");
        return cv;
      })
      .catch((error) => {
        cvPromise = null;
        throw error;
      });
  }
  return cvPromise;
}
