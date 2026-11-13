// Keep the old engine in test tooling, outside the production dependency graph.
import { getCV as getSimd } from '../../src/utils/cvLoader';
export type CVRuntime = 'scalar' | 'simd';
let scalar: Promise<any> | null = null;
export function getCV(runtime: CVRuntime = 'simd'): Promise<any> {
  if (runtime === 'simd') return getSimd();
  if (!scalar) scalar = import('@techstark/opencv-js').then(async module => {
    const cv = await ((module as any).default || module);
    if (!cv?.Mat) throw new Error('Scalar comparison runtime did not initialize.');
    return cv;
  }).catch(error => {scalar = null; throw error;});
  return scalar;
}
