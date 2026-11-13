# PDF preparation and report exports

On devices reporting at least 4 GB RAM, with a native page no larger than
192 MiB in RGBA, setup begins preparing the first page after a short idle delay.
It uses the existing 600-DPI PDF renderer and one-page compressed cache. Both
calibration and marking reuse that raster; upload metadata loading itself still
rasterizes no pages. Changing/removing files cancels the old warmup.

During marking, `PageLookahead` prepares at most one upcoming native bitmap in
addition to inputs already owned by active marking jobs. The shared raster queue
still runs one render at a time, with requested pages ahead of speculative work.
Low/unknown-memory devices and unusually large pages retain on-demand loading.
Unused prepared bitmaps are closed on cancellation or completion. Geometry and
response detection are unchanged.

This reuses PDF.js's existing parsing/decoding worker. Canvas painting remains in
the existing main-thread renderer; it is not a new dedicated raster worker or a
reserved OpenCV marking worker. PDF drawing can overlap marking in its workers.

When Results opens, the PDF export worker begins preparing the annotated report.
After it finishes, the ZIP worker prepares Download All using that exact PDF,
existing student PNGs and CSVs. There is at most one export worker active. Button
clicks share in-progress jobs and reuse the resulting Blobs, with no automatic
browser download. Leaving Results or changing the result data cancels preparation.
Failures are reported and buttons can retry. React Strict Mode does not duplicate
export jobs. Prepared files are retained only for the current results.

Report pages follow the supplied PDF's print style: navy titles, blue table
headers, striped candidate rows, answer-key grid, green/red comparison cells,
totals, repeated column headings and page footers. The report also retains class
metrics, score distribution, per-question answer distributions and blank/unclear
counts from the app. Names wrap; large cohorts and option sets paginate.

Validation commands:

```sh
CHROMIUM_PATH=/usr/bin/chromium npm run test:page-lookahead
CHROMIUM_PATH=/usr/bin/chromium npm run test:prepared-downloads
CHROMIUM_PATH=/usr/bin/chromium npm run test:results
```

These check native pixel parity, shared warmup/cache use, bounded bitmap ownership,
cancellation/rotation, sequential export workers, shared jobs/retries, automatic
preparation and cache reuse under Strict Mode, ZIP/PDF byte equality, report
values, long/non-Latin names and a 30-student/40-question report.

A local 20-page IGCSE benchmark using two marking workers took 51.6 seconds with
lookahead and 54.7 seconds without it (one run per setting, 3 reported cores,
8 GB memory). Responses, scores, review reasons and box coordinates matched.
This is a modest batch-throughput improvement, separate from warming the first
page before clicking Continue. It does not make an individual CV operation faster.
Repeat with `npm run test:pdf-pipeline-speed`; set `PIPELINE_REPORT` to save timings.

Reports and Results contain no inferred pass rate, pass/fail verdict or fixed
50% score classification. Correct/incorrect answer colours compare responses
with the supplied key. Teacher workflow ideas for Version 3: Cayenne are tracked
separately in `docs/cayenne-roadmap.md`.
