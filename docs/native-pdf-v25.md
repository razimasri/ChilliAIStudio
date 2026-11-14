# v2.5 Birdseye — native scanned-PDF preparation

Marking remains on the existing 4800 × 6840 reference canvas, with 5×5 blur, existing box/row recovery, fill thresholds and scores unchanged. This release changes only the preparation and deskew resolution of eligible scanned PDFs. No teacher-facing DPI or blur setting is added.

## Resolution policy

The renderer lazily inspects a page's PDF operators when a full page is requested; upload remains metadata-only. A page qualifies only when it contains one near-page-covering image with known pixel dimensions and no additional drawing/text content. Effective PPI is calculated from image pixels, its composed transformation, PDF userUnit and placement. It is not read from a possibly arbitrary DPI tag. X/Y resolution must agree within 1%; near-standard PPI values are snapped within 0.5% to absorb PDF dimension rounding.

- Verified 300–600-DPI image-only scans prepare at native resolution, capped at 600 DPI. Existing approximately 600-DPI scans retain their exact rendering settings/pixels.
- Below 300 DPI, preparation and alignment retain the existing 600-DPI path. Simulations found extra alignment-induced reviews at 200 DPI; this initial release deliberately does not change that path.
- Mixed/vector PDFs, multiple/partial images, anisotropic scans and unrecognised operator patterns use the established 600-DPI path. This is an explicit eligibility policy, not a retry after failed marking. Processing errors are still reported.
- Camera preprocessing and standalone image files retain their existing paths.

## Alignment and caches

Native rasters carry an explicit sourceScale through the renderer's compressed cache, marking lookahead, worker messages, ordinary marking and geometry-repair re-reads. Only the deskew border width (200 reference pixels) and minimum alignment contour area (4,000,000 reference square pixels) scale with the input: length linearly, area quadratically. Rotation and registration still use full-page geometry; no assumption about scanner placement or tightly cropped question selections is introduced.

After deskew, the existing registration maps the page onto the unchanged canonical canvas. Calibration still normalises the first template to that canvas. Review coordinates, native annotation output, names, scores, logos and exports retain the existing coordinate system. File metadata keeps conservative 600-DPI dimensions for memory planning; smaller input rasters do not increase worker limits. Source-profile caches are cleared with their PDF sources. Small previews keep their existing lazy path.

## Validation

- `npm run build`.
- `test:pdf-scan-profile`: 15 classification cases including 150/200/300/400/600/1200 DPI, vector/text overlays, partial and multiple images, anisotropy, rotated axes and userUnit.
- `test:native-pdf`: constructs real image-only PDFs from IGCSE pages 1, 2, 13 at 300 DPI and IBDP pages 1, 7 at 400 DPI. Compares real worker answers, review flags and scores with independent 600-DPI rendering; checks canonical 4800×6840 annotations, cached native rasters, manual rotation and source-scale transfer. A real markBatch check verifies the ordinary scheduler forwards the metadata. A mixed 600-DPI calibration/300-DPI student-PDF check exposed one visually verified improvement on IGCSE page 13 Q3: native preparation avoids counting the damaged C border and correctly reads the filled D. That case has an explicit expected-answer check; all other outcomes must match. `NATIVE_BATCH_ONLY=1` runs that focused integration alone.
- `test:loading`: preserves exact prepared pixels for 600-DPI inputs (including rotation), metadata-only upload, previews, priority/cancellation and source/URL cleanup.
- `test:results`: PDF Creator v2.5, report contents, ZIP reuse and navigation.
- `test:interface`: desktop/tablet/mobile setup and guide version, calibration, touch/mouse/pen selection, parallel marking, correction revisits and CSV flow.

The broader DPI simulations are exploratory; their lower-resolution native-marking variants are not enabled. No new throughput claim is made from the implementation checks, and no private exam files are committed.
