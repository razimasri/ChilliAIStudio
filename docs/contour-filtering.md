# Filter small contours before sorting

`find_boxes` now discards parentless contours below the same bounding-rectangle area cutoff that previously stopped the sorted loop. It sorts the retained contours by the same descending area, preserving input order for equal areas. Blur, adaptive threshold, contour retrieval, box-size limits, erosion, splitting, row/column reconstruction and answer thresholds are unchanged.

Each bounding rectangle is cached rather than calculated again after sorting. Rejected contour handles are released immediately; retained handles are released in `finally`, including on errors. This replaces cleanup that created and deleted fresh handles instead of deleting the handles actually retained for processing.

The preceding isolated benchmark covered real IGCSE pages 1, 2 and 10 and IBDP pages 1, 7 and 10. Filtering saved approximately 0.7–6.3 ms of selection work per page, about 0.2–1.8% of the full detection time in that environment. Full detection timings were noisy, so these measurements do not establish a larger overall marking gain. No new performance measurements are needed for this implementation.

Validation: `npm run build` and `CHROMIUM_PATH=/usr/bin/chromium node tests/contourFiltering.browser.mjs`. The test compares production against a retained copy of the former sorted-cutoff algorithm on those six native-resolution pages, checking exact raw box coordinates/order, reconstructed questions, answer flags/responses, review flags and row/column centres. The reference uses the same current threshold and repair functions to isolate contour selection. No private exam files are included.
