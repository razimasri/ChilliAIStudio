This directory contains a locally hosted WebAssembly SIMD build of **OpenCV 5.0.0**,
the same OpenCV release used by the scalar `@techstark/opencv-js` runtime.

Source: https://github.com/opencv/opencv/tree/40738fb16ceddb5fb3fea747585f7ce6abb0605b

Built with Emscripten **4.0.11**, `-O3`, `-msimd128`, C++17 and the `core`,
`imgproc` and `js` modules (plus required `geometry` and `flann` dependencies). Pthreads and relaxed SIMD are disabled. The ESM factory
supports both the browser window and module workers, without `eval` or external
CDN requests. The JavaScript and WASM are served from this application's origin.

Rebuild after installing and activating the pinned official Emscripten SDK, with
CMake, Make and Python 3 available:

```sh
./scripts/build-opencv-simd.sh /tmp/chillimark-opencv-simd-build
```

The script pins the source commit and compiler version. `scripts/patch-opencv-js.py`
removes an unused segmentation namespace import and preserves the scalar engine's
float32 addition order in vectorized affine coordinates. Upstream groups the
translation differently, producing small pixel changes; the patch retains SIMD
sampling with scalar-compatible rounding. The warp-specific WASM round operation
also uses nearest-even conversion, matching scalar `cvRound`, instead of the
upstream vector helper's half-up conversion. The float-to-uint8 conversion used
by adaptive thresholding receives the same nearest-even correction. Gaussian
filtering, thresholds and MCQ rules are unchanged. `SHA256SUMS` records the
shipped artifacts. Build timestamps can change artifact hashes on a rebuild.
Production `getCV()` always uses SIMD and tests a real SIMD WASM instruction
before loading this build. Unsupported browsers or failed runtime initialization
report an error; there is no automatic engine fallback. The explicit scalar/SIMD
selectors live in `tests/helpers/cvRuntimes.ts` for regression tests; production
has no scalar loader or runtime selector. Roll back the
change if the SIMD engine fails the required validation.

OpenCV is Apache-2.0 licensed; its license and copyright notices are included.
`THIRD_PARTY_NOTICES.txt` contains the linked dependencies and runtime notices.
