# Studio layout review and cleanup

Reviewed Studio commits `1277f57` and `58e4006` against the last tested merge (`5140722`, Auto Scan). The Studio commit changes the upload panel's presentation and deletes editor-generated media/plans; it does not alter camera processing, calibration, answer recognition, scoring or results logic. Its refreshed layout, click handlers and subsequent Camera Scan label rename are retained unchanged.

## Finding and fix

Studio removed Playwright from `bun.lock` while `package.json` and the browser tests still require it. Restored the previously locked Playwright/Playwright Core versions and integrity values. Removed `@types/jszip`, an obsolete stub whose own package states that JSZip supplies its types; JSZip itself remains a dependency. Compared every direct manifest dependency/version against the lockfile root and package entries. Bun is not installed in this environment, so this is a structural consistency check, not a claim of a fresh frozen Bun installation.

## Unused remnants removed

- Uncalled synthetic/random demo generation, obsolete sample names and hard-coded calibration defaults. The active configuration now contains only the filenames and answer keys that the upload screen actually reads. Programmatic before/after comparison confirms identical filenames and every answer-key character (27 IGCSE, 30 IBDP). Active sample names and calibration selections remain in the existing upload/calibration flow.
- Uncalled `loadImageFromUrl`, disposable `measureCalibration`, and its otherwise unused `useAlignedImage` compatibility hook. The actual `CalibrationClient` session and the preparation helper used by regression tests remain.
- Old `public/opencv.js`; the application uses the npm OpenCV runtime, including its worker bundles.
- Duplicate PDFs under `public/assets/aistudio`, obsolete Studio screenshot assets there, and two unused thumbnails. Both duplicate PDFs were SHA-256 identical to their retained copies under `public/samples`. Diagnostic scripts now read those canonical copies. The removed public files total **72,522,332 bytes (69.2 MiB)**; this reduces deployed/static-build size, not necessarily initial page download size.
- An unfinished `inspect_snippet.mjs` stub that only printed a message, the tracked generated TypeScript build-info file, and a false server-side Gemini capability declaration. Camera embedding permission is retained.
- Added ignores for dependencies, browser builds, local test artifacts and generated TypeScript build info.

The original Python implementation, original branding/graphics, README screenshots, active PDFs, existing algorithm helpers and useful legacy one-off diagnostic scripts are retained. Those diagnostic scripts are reference tools, not the maintained browser test suite. Internal uses, browser tests and diagnostic references were checked before removing exported helpers; an export with no external references is not automatically dead code.

## Checks passed

- TypeScript check, including `--noUnusedLocals --noUnusedParameters`, and production build.
- Existing desktop/tablet/phone setup, samples, upload replacement, focus/dialogs, touch/mouse/pen calibration, parallel marking, review/revision and CSV workflow.
- Desktop page-left/controls-right layout at 1440/1280/1024 pixels.
- Original logos/favicon/banner/guide and pixel-exact watermark positioning.
- Auto Scan gate and short real-OpenCV simulated-camera capture/removal/failure/pause/manual/handoff run.
- Manual batch capture, retakes/order/deletion, permissions, cancellation and normal-loader handoff.
- Single-page camera preview/corners/rotation/confirmation/cancellation and fallback without OffscreenCanvas.
- Calibration session reuse/cancellation/stale-message checks and full-resolution native preview/selection/worker measurement checks.
- Grading agreement across UI, CSV, print and downloaded PNG (4/27), with repeated rendering and corrections remaining state-preserving.

No new camera or recognition feature is introduced here. Physical-phone limitations documented in `camera-scanning.md` remain unchanged. Browser tests run in Chromium with touch emulation/simulated camera streams where applicable.
