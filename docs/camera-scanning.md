# Phone camera scanning

Camera capture is an additional, browser-only input path. PDF and scanned-image upload, calibration, answer recognition, scoring, review, export and branding retain their existing implementations.

## Integration

`UploadAndInputStep` exposes **Scan with Camera** through a separate native file input (`accept="image/*"`, `capture="environment"`). Android/iOS browsers may offer the rear camera; desktop browsers can choose an existing photograph. The browser owns camera permissions. Cancelling the picker leaves the exam unchanged; the normal **Choose files** input remains available.

The scanner UI and processing runtime are loaded only after a photograph is selected. The scanner:

1. Uses the browser decoder to apply image orientation metadata. Unsupported formats produce a retry/JPEG-or-PNG message.
2. Retains one photograph, bounded to a 5000-pixel long edge and 16 megapixels to limit phone memory use. This preserves typical 12-megapixel captures; larger captures are reduced.
3. Detects a convex page quadrilateral at a maximum 1200-pixel edge, using blurred grayscale edges and a bright-paper threshold. Candidates must be sufficiently large, fully inside the image and have paper/background contrast on at least three sides. This reduces the risk of mistaking a printed table for the sheet boundary.
4. Transfers relative corner positions back to the retained photograph and applies a homography. The preview is a corrected 1200-pixel page, not the original photo. Corner editing explicitly switches to the original photo, with touch/pointer handles and arrow-key adjustment.
5. Suggests portrait orientation from the edge lengths. The user checks semantic orientation and can rotate by quarter turns; no OCR or template is used to infer which end is the top. Every corrected output uses the known portrait page dimensions, independent of foreshortening in the photograph. Check the preview is upright before confirming.
6. Checks source edge lengths and a preview sharpness heuristic. Clearly insufficient detail blocks confirmation; marginal detail produces warnings. Failed boundary detection opens manual corner adjustment. Crossed or degenerate quadrilaterals are rejected.
7. On confirmation, warps the retained photograph to **4800 × 6840**, encodes a lossless PNG and passes it to the existing `loadExamFile` function. The normal `ExamFile → calibration → marking` flow then handles it exactly as another image. Users still need their answer key and normal first-page calibration. Additional camera pages append in order; replacing a sample clears its names/key.

The normalized dimensions supply the engine's coordinate system; enlarging a photograph does not create 600-DPI detail. The existing engine still uses the printed alignment contour for deskew/registration, then crops the selected question area for detection. Camera preprocessing does not bypass those operations or change any grading rules.

Processing runs in a dedicated worker with the existing OpenCV runtime when worker canvas and bitmap decoding are supported. A main-thread compatibility path uses the same processing implementation. The photo is retained only within the camera session, so adjusting corners does not repeatedly decode it. Full-size perspective correction happens at confirmation. Worker termination, Mat deletion, bitmap closure, canvas clearing and URL revocation release resources on confirmation, retry and cancellation. Cancellation is also checked while the existing loader reads the corrected PNG, preventing a cancelled scan being appended later.

## Libraries

No dependencies were added. The implementation reuses the installed `@techstark/opencv-js` 5.0.0-release.1 (Apache-2.0), browser file capture, canvas and Web Workers.

jscanify (MIT) was inspected. Its DOM/global-OpenCV integration, Node-oriented package dependencies and missing capture-quality/boundary-confidence checks would need adaptation. This implementation uses the already installed OpenCV APIs directly rather than adding that wrapper or another runtime.

## Validation

- `CAMERA_TEST_BUILD=1 npm run test:camera`: production-built camera worker and fixture. Compare question count, every response and score with equivalent flatbed input for both IBDP and IGCSE overhead/oblique captures, plus rotated and unevenly lit IBDP captures. All six cases match; both flatbed baselines score 6 using the test's all-A key.
- `CAMERA_QUALITY_ONLY=1 npm run test:camera`: focused blank, clipped-page, low-resolution, blurred, crossed-corner and JPEG EXIF-orientation checks.
- `CAMERA_TEST_BUILD=1 npm run test:camera-interface`: built app at a 390 × 844 touch viewport. Checks lazy loading, capture attributes, corrected preview, keyboard and actual touch corner movement, confirmation through the normal loader, cancellation during processing and during insertion, worker cleanup and compatibility without OffscreenCanvas.
- `npm run test:interface`: existing upload/calibration/review/results workflow regression.
- `npm run test:grading`: existing UI/CSV/PNG grading consistency regression.
- `npm run build` and `npm run lint`.

The photographs in automated marking comparisons are controlled perspective projections of bundled scanned sheets, not physical phone captures. They verify geometry and downstream answer parity under those transformations; they do not establish equivalent performance on all camera images.

## Device validation still required

Test real Android Chrome and iOS Safari, including permissions/picker cancellation, EXIF variants, device formats such as HEIC, memory use and image export. Chromium touch emulation and the compatibility fallback have been tested; a WebKit executable was unavailable in this environment. Older phones may have canvas/memory limits below the engine's existing 32.8-megapixel canonical page size.

Use a flat sheet, steady focus, a contrasting background and even lighting. Manual corners are available for weak contrast or uncertain boundaries. Glare, motion blur, severe shadows, curved pages, lens distortion or missing paper edges cannot be repaired reliably by a planar homography. Quality thresholds are conservative heuristics, not a guarantee that every answer will be recognized. Check the preview and use the existing answer-review flow. No continuous capture, automatic shutter, OCR, AI, additional registration marks or blank template is introduced.

## Files

- `src/components/CameraScanner.tsx`: corrected preview, corner editing, rotation, progress/errors and cancellation.
- `src/components/UploadAndInputStep.tsx`, `src/components/HelpModal.tsx`: separate camera entry, normal-loader integration and instructions.
- `src/utils/camera/geometry.ts`, `scanner.ts`, `client.ts`, `camera.worker.ts`: relative quadrilateral validation, OpenCV preprocessing, worker/fallback lifecycle.
- `tests/cameraScanning.browser.mjs`, `tests/cameraInterface.browser.mjs`, `tests/fixtures/camera.html`: camera processing and UI coverage.
- `tests/interface.browser.mjs`: select the existing upload input by its label now that there are two file inputs.
- `package.json`: camera test commands.
- `docs/camera-scanning.md`: integration, validation and device limitations.
