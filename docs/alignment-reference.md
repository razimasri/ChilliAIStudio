# Alignment contour consistency

The first calibration page still establishes the reference contour using the existing largest-contour rule. During marking, after deskew, large contours must agree with that reference before they can drive registration:

- Width and height must each be within 10% of the reference width and height.
- Horizontal and vertical centre positions must each be within 10% of the page width and height of the reference centre.

Comparisons use page-relative coordinates, so native PDF DPI and camera image dimensions do not change the thresholds. Candidate bounds are measured after the same contour approximation used by registration. The largest qualifying contour wins; larger unrelated shadows or page regions are excluded. If no contour qualifies, an explicit alignment error stops the batch and identifies the page through the existing error path, before resizing or scoring it. No silent unguarded retry is used.

Initial angle estimation and first-page reference selection retain the existing method. This check does not prove the first-page reference is correct, and very different framing or perspective can require recapture/setup. The 200-pixel border, contour-area cutoff, marking thresholds, blur and question interpretation are unchanged.

The regression covers a larger unrelated region, a same-sized region in the wrong location, tolerance boundaries and native-resolution normalization, plus alignment of every page in both bundled samples.
