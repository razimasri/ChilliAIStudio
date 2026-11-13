/// <reference types="vite/client" />
export interface CVRuntimeInfo {
  runtime: 'simd';
  version: '5.0.0';
}
let instance: Promise<any> | null = null;
const info = new WeakMap<object, CVRuntimeInfo>();

/** Validate an actual v128 instruction, rather than inferring support from the browser. */
export function supportsWasmSimd(): boolean {
  try {
    return typeof WebAssembly !== 'undefined' && WebAssembly.validate(new Uint8Array([
      0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,
      10,9,1,7,0,65,0,253,15,26,11,
    ]));
  } catch { return false; }
}
export function getCVRuntimeInfo(cv: object): CVRuntimeInfo | undefined {
  return info.get(cv);
}
async function loadSimd(): Promise<any> {
  if (!supportsWasmSimd()) throw new Error('This browser does not support WebAssembly SIMD.');
  const base = new URL(`${import.meta.env.BASE_URL}opencv-simd/`, self.location.origin);
  const module = await import(/* @vite-ignore */ new URL('opencv-5.0.0-simd.mjs', base).href);
  const cv = await module.default({
    locateFile: (name: string) => new URL(name.endsWith('.wasm') ? 'opencv-5.0.0-simd.wasm' : name, base).href,
  });
  const build = cv?.getBuildInformation?.() || '';
  if (!cv?.Mat || !/OpenCV 5\.0\.0\b/.test(build) || !build.includes('-msimd128'))
    throw new Error('The SIMD OpenCV runtime failed validation.');
  info.set(cv, {runtime:'simd', version:'5.0.0'});
  return cv;
}
/** Production has one engine. Failed initialization is reported, never substituted. */
export function getCV(): Promise<any> {
  if (!instance) instance = loadSimd().catch(error => {instance = null; throw error;});
  return instance;
}
