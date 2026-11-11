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

# Batch scanning — v2.2 Birdseye

**Batch Scan** opens a continuous rear-camera session using `getUserMedia`. Tap Capture for each sheet; a successful correction is added immediately, with a count and latest thumbnail. There is no per-sheet confirmation, answer-key requirement, calibration, recognition or marking during capture.

Finish Scanning stops the camera and processing worker, then opens review. Check full-page previews, remove unwanted pages, retake a particular page, rotate upside-down pages by 180°, or return to the camera to add more. Retakes keep the old scan until a replacement succeeds and preserve its position. Confirm batch loads the corrected files sequentially through the existing `loadExamFile` path and updates the normal image collection once. A cancelled/failed import adds no partial batch. Existing samples are replaced with their names/key cleared; personal pages are appended in capture order.

The rear camera is requested at high ideal resolution without making those dimensions mandatory. `ImageCapture.takePhoto()` is preferred when available, otherwise the current video frame is captured losslessly. Low-resolution frames still have to pass the existing camera quality checks. Live capture needs HTTPS (localhost for development), camera permission, and an embedding page that allows camera access. The app metadata now requests camera frame permission. Denial, unsupported APIs, camera loss and correction failures leave previous scans intact, with retry or the existing input alternatives available.

A single `CameraClient`/worker is reused while acquiring a stack. Each capture reuses the existing detection, homography and quality functions. Detection runs once, and the final page is warped once at full size. Missing-boundary/default-corner captures are refused. A canonical PNG and a 240-pixel thumbnail are produced, then the input Mat is released. Operations are serialized; Capture, retake and Finish are blocked while correction is incomplete. Only compressed corrected Files and tiny thumbnails are retained across the batch. Originals and full rasters are not kept for earlier pages. At confirmation, existing upload metadata loading is sequential; subsequent calibration/marking retains the existing deferred image-loading behavior. No second image store, IndexedDB database or marking pipeline is introduced. The session is in memory: reloading or cancelling discards unconfirmed captures.

Batch files:

- `src/components/BatchCameraScanner.tsx`: continuous capture and batch review UI; stream, cancellation and worker lifecycle.
- `src/utils/camera/batchCapture.ts`: still/video capture, error messages and ordered replacement of compressed batch pages.
- `src/utils/camera/scanner.ts`, `client.ts`, `camera.worker.ts`: batch command reusing the single-page correction implementation.
- `src/components/UploadAndInputStep.tsx`, `HelpModal.tsx`: entry, atomic normal-loader handoff and guide instructions.
- `src/utils/release.ts`, `index.html`, `package.json`, `ReadMe.md`: version 2.2 / 2.2.0; `metadata.json`: camera embedding permission.
- `tests/batchCamera.browser.mjs`: live simulated camera stream with real OpenCV correction, 30 captures, failure/retake/order/review/transfer/permission/cancellation checks. `tests/cameraScanning.browser.mjs` also exercises batch correction against the equivalent flatbed results; single-page UI tests remain in place. `tests/interface.browser.mjs` expects v2.2.

`npm run test:batch-camera` builds the app and runs a 30-sheet simulated-live-camera test at a phone touch viewport. The source canvas presents a different sheet marker for every capture. The test checks one continuous acquisition stream and one worker, full correction per page, capture order, failed captures/retakes, successful in-place replacement, deletion, add-more, stream/worker release and transfer to the normal collection without an answer key. `BATCH_TEST_COUNT=3` gives a shorter smoke test; `BATCH_TEST_DEV=1` uses the development server. Automated camera and stream tests do not replace physical Android/iOS testing: verify actual camera permissions, resolution negotiated by each phone, ImageCapture support/orientation, a full class-sized session, heat/memory limits and iframe camera policy on the deployed host. Desktop simulated 30-page stability does not establish that every phone will have sufficient memory.

The v2.2 implementation passed the production 30-sheet simulated-stream run and shorter lifecycle/order checks. The six sample marking comparisons, single-page camera UI/fallback regression, ordinary desktop/tablet/phone upload/calibration/review/CSV regression, TypeScript check and production build passed. After retaking an earlier page, the recent thumbnail and Retake Last Scan refer to that successful replacement while its original batch slot is retained.
