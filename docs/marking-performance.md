# Full-resolution alignment and SIMD

Production uses the pinned local OpenCV 5.0.0 SIMD runtime. It does not switch
engines silently. Unsupported SIMD or runtime loading failures surface through
the existing error UI; roll back this change if the runtime causes problems.
The scalar npm runtime is pinned to 5.0.0-release.1 and remains an explicit
comparison option in `tests/helpers/cvRuntimes.ts` (`getCV('scalar')`).
Production has no scalar loader or runtime selector. The unreferenced legacy
`public/opencv.js` asset has also been removed.

The opt-in single-channel experiment (`{singleChannel: true}`) lets opaque
monochrome RGB/RGBA scans rotate one luminance channel, then restores the
original channel count before the existing registration and marking stages.
It is disabled by default: its conversion and border-preservation overhead
outweighed the faster warp once SIMD was enabled in warmed end-to-end tests.
Colour, transparency, non-contiguous matrices and other input formats use the
ordinary colour transform. Both paths preserve native scan resolution. The
border-alpha restoration follows the pinned OpenCV 5 float32 bilinear kernel;
it evaluates only conservative border strips. Changing OpenCV requires repeating
the pixel tests, including odd image dimensions and scalar/SIMD rounding.

The SIMD build preserves the scalar affine-coordinate addition order through a
small source patch. Upstream SIMD associates the translation differently, which
changed registered pixels in the initial experiment. Warp-specific SIMD float-to-byte
conversion and the float-to-uint8 conversion used by adaptive thresholding also
use scalar-compatible nearest-even rounding. No threshold, fill limit,
erosion rule, question grouping, grading or manual-correction rule changes.
Build provenance, licenses and artifact hashes are in `public/opencv-simd/`.

Run checks with Chromium installed (or set `CHROMIUM_PATH`):

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:cv-runtime
CHROMIUM_PATH=/usr/bin/chromium npm run test:alignment-performance
CHROMIUM_PATH=/usr/bin/chromium ALIGNMENT_FULL=1 npm run test:alignment-performance
CHROMIUM_PATH=/usr/bin/chromium MARKING_SPEED_REPORT=/tmp/marking-speed.json npm run test:marking-speed
```

The alignment test compares scalar colour, scalar single-channel, SIMD colour
and SIMD single-channel paths. It checks calibration, registered image bytes,
threshold masks, box positions/order, responses, review reasons, scores and manual
corrections. The speed test includes native input loading and final image output
(or clean images and review crops for ambiguous pages); PDF raster preparation
is excluded. Run timing tests without parallel builds or other heavy tests.

## Measured results

Chromium in this environment reported 3 CPU cores and 8 GB device memory.
These are medians of three warmed runs, rotating test order. Complete page
marking includes image loading, annotation and image encoding (or clean review
images/crops); it excludes PDF rasterization and human review.

| Sample page | Original scalar | SIMD colour (production) | Reduction |
| --- | ---: | ---: | ---: |
| IGCSE page 2 | 4.218 s | 2.286 s | 46% |
| IBDP page 7 | 6.246 s | 3.382 s | 46% |

The single-channel experiment took 2.750 s on the monochrome IGCSE page versus
2.286 s for SIMD colour, so it remains opt-in. The IBDP scan contains colour and
correctly retains the colour path. Faster luminance warping alone does not
compensate for the monochrome check, channel conversion and alpha restoration.

All 25 bundled sample pages passed exact scalar/SIMD comparisons of registered
pixels, adaptive/Otsu threshold masks, box coordinates/order, response/review
state, scores and manual corrections. Both sample calibrations also matched.
Ninety-six small-image rotation cases covered odd dimensions, near-zero angles,
large skew and border alpha. The timing measurements are local evidence, not a
prediction for another device or an entire concurrent batch.
