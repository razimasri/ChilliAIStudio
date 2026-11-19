# Alignment contour consistency

The first calibration page still establishes the reference contour using the existing largest-contour rule. During marking, after deskew, large contours must agree with that reference before they can drive registration:

- Width and height must each be within 10% of the reference width and height.
- Horizontal and vertical centre positions must each be within 10% of the page width and height of the reference centre.

Comparisons use page-relative coordinates, so native PDF DPI and camera image dimensions do not change the thresholds. Candidate bounds are measured after the same contour approximation used by registration. The largest qualifying contour wins; larger unrelated shadows or page regions are excluded. If no contour qualifies, an explicit alignment error requests teacher-assisted alignment before resizing or scoring that page. Without an interactive recovery handler (for example in direct engine calls), the error still stops processing. No silent unguarded retry is used.

Initial angle estimation and first-page reference selection retain the existing method. This check does not prove the first-page reference is correct, and very different framing or perspective can require recapture/setup. The 200-pixel border, contour-area cutoff, marking thresholds, blur and question interpretation are unchanged.

The regression covers a larger unrelated region, a same-sized region in the wrong location, tolerance boundaries and native-resolution normalization, plus alignment of every page in both bundled samples.


## Manual recovery and contour-free sheets

During marking, a page that fails alignment waits for teacher input while other workers can continue. Recovery requests are queued, not shown over one another. The dialog shows the original page and the first-page reference (retained as a small Blob independently of revoked preview URLs). The teacher can fine-rotate, zoom/pan and draw the matching reference rectangle, then inspect the registered preview with its answer-area overlay before continuing. Manual registration writes directly to a fixed 4800×6840 canvas rather than allocating an oversized resized page for a small selection. This manual path uses an affine warp with the resize pixel-centre convention; normal automatic registration is unchanged. Cancel marking aborts pending requests and workers through the existing cancellation path. Each correction is reused if geometry consensus later re-reads that page; manual answers remain preserved by the existing merge logic.

For sheets without a significant large printed contour, choose **Whole page — no alignment contour** in calibration. Both calibration and marking use the page bounds explicitly, with no contour detection or automatic deskew. This assumes full, upright pages with consistent framing (camera perspective correction is already performed before marking); it does not add support for a different answer-box shape or change answer interpretation. This is an explicit teacher choice, not a silent fallback.

Validation: a real IBDP sample with its non-grid content removed has no qualifying large contour. Whole-page worker calibration and marking retain its 30 responses and score; an automatic attempt triggers typed recovery, obtains fresh page pixels and produces the same answers after a manual transform. Cancellation, the calibration-mode switch after a no-contour error, and mouse/touch rectangle selection are covered by the browser regression.
