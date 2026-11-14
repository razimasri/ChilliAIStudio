# PDF image compression

Annotated PDF pages now use JPEG at quality 0.90, keeping the native 4800 × 6840 dimensions and existing page placement. The conversion runs sequentially in the existing PDF worker, with each bitmap closed and canvas released before proceeding. Transparency is flattened onto white. Marking, cleaned scans, lossless PNG downloads, and vector report tables/text are unchanged. Download All reuses this same compressed PDF.

Previously `pdf-lib.embedPng` expanded each PNG into raw RGB and used lossless Flate compression in the PDF. That was unnecessarily expensive for scanned paper texture. `embedJpg` now retains the JPEG-compressed stream instead.

A single-page comparison used the first embedded image from the user's 2025 reference PDF, converted to the same PNG source for both paths with representative red/green annotations added. Native dimensions were 4800 × 6840. The old single-page lossless PDF was 10,496,572 bytes; the new PDF including three report pages was 1,573,490 bytes (about 85% smaller). The JPEG itself was 1,546,000 bytes. These are measurements for this page, not a guarantee for every batch. No marking benchmarks were rerun and no private exam files are committed.

JPEG is lossy; individual pixels can change slightly. Native resolution is retained, and tests check distinct annotation colours, white backgrounds and JPEG image dimensions/filter in the actual exported PDF. Lossless PNGs remain available when exact pixels are needed.

Validation: `npm run build`, Results PDF/ZIP integration, prepared-download sharing/cancellation, and `CHROMIUM_PATH=/usr/bin/chromium node tests/pdfCompression.browser.mjs`. Set `PDF_EXPORT_REFERENCE_JPEG` to a local JPEG to run the comparison with a real scanned page instead of the generated paper-texture fixture.
