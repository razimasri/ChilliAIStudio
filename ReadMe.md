![ChilliMark Logo](/icons/Banner.png)
# ChilliMark — v2.0 Birdseye


ChilliMark Heuristical Identification of Landmark-Less Input Multiple-choice Answer Recognition Kernel

ChilliMark is able to mark some multiple choice sheets without the use of QR code or other landmarks and predefined templates 

It was developed against the multiple choice sheets for the IBDP and IGCSE exams boards. Specifically it was developed for the science version of the multiple choice sheets.

It was designed to match the work flow of teachers who should have ready access to auto-feed scanners. Note: Due to this is does not do any deskewing, only rotation and scaling.

## Birdseye browser workflow

Load PDF, PNG or JPEG scans, then check the names and answer key. The upload
area collapses after loading and Continue stays visible at the bottom. Names
are optional: blank names produce Student 01, Student 02, and so on. If names
are supplied, enter exactly one per page. Removing a page removes its matching
name when the counts agree. Real uploads never insert the sample names.
Samples include 27 IGCSE or 30 IBDP answers.

Calibration supports mouse, finger and pen. Use Draw to frame the answer grid,
review it, then choose Next: Select Box. Use Pan to move a zoomed page and the
zoom buttons/Fit to change its display scale. Draw around one clean empty box,
wait for Empty box ready, then choose Mark Exams. These controls change display
and selection only; MCQ detection and grading are unchanged.

For ambiguous answers, click/tap the answer on the snippet or choose its letter,
Blank or Unclear. The choice saves and advances immediately; Previous revisits
a decision. Review starts as completed pages become available while marking
continues. Final results keep input order. When all pages and corrections are ready, choose View
results. Cancel review returns to setup. Snippet zoom helps inspect marks. Results open on Overall statistics. Student scores
and Marked sheets are separate tabs; per-student PNG/print controls are in the
student card, and ZIP/CSV exports are in the results header. Marked sheets appear
before the question breakdown on narrow screens and include zoom/Fit controls.
The in-app Guide describes the same workflow. The desktop screenshots below
are retained as historical documentation.

`npm run test:interface` checks desktop, tablet, phone and landscape layouts,
readiness/name alignment, multi-file selection, dialog focus/scroll behavior,
actual touch/mouse/pen gestures, cancellation/panning, empty-box calibration,
worker marking, review Back/revision, CSV output, and the mobile result flow.
Set `CHROMIUM_PATH` to use a system Chromium. Touch tests use Chromium device
emulation; they do not substitute for testing physical iOS/Android hardware.

## Branding

The web interface uses the original banner and icon assets. Marked sheets include
`icons/printmark.png` at the original registered-page position (x=4271, y=256,
273 × 256 pixels), with the original white print background. The logo is baked
into the image for both first-pass marking and final correction rendering, so
previews, PNG downloads, ZIP archives, and printing share the same watermark.
Raw scans used for detection and correction crops remain free of added branding.

Run `npm run test:branding` to check logo loading, mobile layout, and exact
watermark placement/pixels. `npm run test:grading` also verifies the watermark in
the actual exported PNG while checking score consistency.

## Features

### No template
Use your own worksheets. You do not need to use any special template. It only works with square boxes for now because it was developed against thh IBDP and Cambridge IGCSE papers. It does technically require one large box on the page that it uses to determine rotation and scale.

### Annotations
Generate annotated pages with the student name, test score, Detected responses, and Correct Answer Key.

![Snippet from IGCSE Cambridge Test](/RDimages/image-7.png)		![Snippet from IBDP Test](/RDimages/image-2.png)

### Output data
Generate a CSV with both each students score and individual question response rates for further processing.

### Clear up ambiguous choices
If two boxes are detected with answers the user can choose the correct questions

## Original desktop workflow
1. Scan your completed exams using 600 DPI. 

2. Load your PDF - Drag and drop is supported


3. Enter Students names and answer key and hit continue 

![Load Pages](/RDimages/image-3.png)

4. Select the question area and define one empty box. This needs to be quite tightly around the box for the best results. Since this is the box used to detect and understand the image it is worth find the best one free of any scanning artifacts

![Highlight key area](/RDimages/image-4.png)

5. Enter corrections

![Clear up ambiguities](/RDimages/image-5.png)

6. Finished. Review the output for any mistakes. Run again is there are issue. I hope to allow finer corrections in future updates

## Original desktop roadmap
1. Round bubbles
1. Full Manual Mode
1. Resizable Gui
1. Web app
1. Detection realignment
1. Page reordering
1. Multi regions marking
1. JPEG in put
1. Phone and Tablet version
1. IOS Version
1. Appends statistics to a report page

## Known Issues
1. Sometimes the detected boxes do not line up with the real boxes. 
1. Boxes that seem perfectly fine visually are processed differently resulting in errors and rejections.










## Score consistency

Scoring is calculated from finalized responses and the answer key, independently
of annotation drawing. Corrections refresh that score; rendering cannot award
additional points. Final rendering starts from the clean registered scan and
leaves the student record unchanged.

Run `npm run test:grading` with `CHROMIUM_PATH` when using a system Chromium.
The regression uses 27 questions with exactly four correct responses and checks
4/27 in the scorecard, CSV, printed annotation text, and downloaded PNG. It also
checks identical pixels on repeated rendering, immutable student state, and
correct/wrong/blank/unclear correction outcomes. Existing marked images must be
regenerated after updating; previously downloaded files are not rewritten.


## Web port: page geometry

PDFs are rendered at 600 DPI. Only the first-page calibration template is
resized to 4800 × 6840 before rotation. Each student page keeps its own raster
dimensions through rotation, then is scaled and translated using the detected
alignment rectangle into the template's coordinate space. Question areas, box
contours, correction crops, and final annotations use that registered space.
Intermediate scans are stored losslessly as PNGs.

For the browser geometry regression check:

```sh
npm install
npx playwright install chromium
npm run test:geometry
```

To use an existing Chromium installation, set `CHROMIUM_PATH` to its executable.
The check reads both complete sample PDFs, checks every page's native 600-DPI
size, and renders/detects/corrects two full-resolution pages from each sample.
This requires more time and memory than low-resolution previews; it checks the
coordinate pipeline, not recognition accuracy against a manually verified key.

The calibration parity check runs the original Python `Parameters.set_box` and
`find_responses` methods against the same pixels and box centers used in Chromium.
It covers rounded empty boxes, crosses, shading, multiple marks, faint marks,
erasure residue, and the first IB and IGCSE sample pages. Row reconstruction is
shared test input, so its separate port differences do not affect this comparison.

```sh
python3 -m venv .venv
.venv/bin/pip install numpy opencv-python-headless
PYTHON=.venv/bin/python npm run test:calibration
```

`CHROMIUM_PATH` is supported as for the geometry check. Invalid box selections
are rejected instead of being replaced with fabricated contours. The browser
limits contour expansion to 128 attempts and reports failure if it cannot
stabilize; valid selections use the original area-stability rule and threshold.

## Results and exports

Results open on Overall Statistics, with class score summaries, a score
histogram, and question response distributions. Student scores and annotated
sheets remain available in their own tabs.

Class Report CSV includes the answer key, every student's score and per-question
responses, followed by correct/option/blank/unclear counts. Missing responses are
padded as Blank so rows keep the same question columns. Item Stats CSV includes
counts and percentages for every option, including options beyond D. The ZIP
includes both reports alongside the annotated sheets.

Run `npm run test:results` (with `CHROMIUM_PATH` if needed) to check the results
navigation and actual CSV/ZIP downloads. This test uses Python's standard CSV
reader to validate quoted, Unicode, comma-containing, and multiline names.

## Deferred page preparation and exports

Upload reads PDF page metadata without rendering every page. Visible thumbnails
use small rasters (360 pixels on the longest edge); the enlarged preview uses
1400 pixels. Calibration and marking request the original 600-DPI pixels through
a single raster queue, ahead of waiting thumbnails. Manual rotation is applied
when a raster is requested. One full page and at most 24 small previews are
cached. Removing the last page from a document releases its PDF worker and
cached images. Clearing/resetting also revokes owned image URLs.

PNG output uses asynchronous Blob encoding rather than retained base64 strings.
Only ambiguous pages retain a clean registered raster for final correction
rendering, and only corrected students are rendered again after review. ZIP
assembly runs in one disposable worker per export; leaving results cancels it.
OpenCV initializes on demand using the same npm runtime as before. PDF.js
already parses documents in its own worker. MCQ detection, thresholds, row logic,
response reading and scoring are unchanged; marking runs in the background as
described below.

A local Chromium comparison on the 14-page IGCSE sample measured metadata load
at approximately 0.5–1.7 seconds, compared with 24 seconds for the previous eager
load/render/encode path. First full-page preparation took approximately 1.4–2.1
seconds when requested. These are individual local runs, not a cross-device
benchmark or an end-to-end marking speed claim. The old upload retained about
217 million base64 characters; the new upload retains source files and metadata,
then renders small previews. No browser resident-memory peak was measured.

Run `npm run test:loading` (with `CHROMIUM_PATH` if needed). It compares more than
68 million full-resolution pixels against the previous PDF viewport/render
settings, including rotation; checks metadata-only loading, preview/cache bounds,
queue priority, cancellation, URL cleanup, and the actual upload/rotate/remove/
clear workflow. Existing geometry, calibration, grading, branding and export
regressions remain applicable. Rendering/recognition errors halt marking for
review instead of producing a fabricated zero score.


## Background marking and bounded parallelism

Marking and final correction rendering run in dedicated module workers using the
same engine functions and OpenCV version. The canvas boundary supports
OffscreenCanvas; scan pixels, thresholding, grouping, response reading, scoring,
annotation commands and watermark placement keep their existing behavior.

Up to two pages run concurrently when the browser reports at least 8 GiB device
memory and four logical processors. Lower or unknown memory/core information
uses one background marking worker. One-page batches use one worker. This is a
conservative cap: each worker owns an independent OpenCV/WASM heap plus large
600-DPI image buffers, so increasing workers can exhaust memory or slow devices.
Calibration remains on the interface thread. Full PDF rasterization remains
serial, and supplies only the next input for each available marking worker.

Results keep input/student order even when pages finish out of order. Review
prompts arrive as completed pages become available; their history stays stable. Progress counts completed pages and displays each page's actual state.
Cancel marking, navigation, and page failures terminate the pool, including
synchronous native CV work, and discard partial result images. A failed page is
reported rather than assigned an invented score. Workers are released after the
batch; corrected annotations use a disposable worker. The browser needs module
workers, OffscreenCanvas and createImageBitmap; unsupported browsers receive a
clear error instead of silently reverting to interface-blocking marking.

Run `npm run test:workers` with `CHROMIUM_PATH` as needed. It checks exact response
and output-pixel parity for normal/ambiguous/corrected scans, actual two-worker
overlap, an interface heartbeat during native processing, stable student order,
worker/URL cleanup on completion/cancellation/failure, hardware caps, and parallel
progress states. `WORKER_TEST_BUILD=1 npm run test:workers` builds and tests the
production worker/chunk URLs as well. `test:geometry` also compares worker versus
main-thread recognition on the first real IB and IGCSE sample pages. Startup and
memory overhead can outweigh parallelism for small batches; this is not a claim
of a fixed speed multiplier on every device.


### Birdseye live-review refinements

Calibration preparation shows an activity spinner and the current stage. A small
animated rectangle demonstrates question-area dragging. Empty-box selection
opens close up; Box view restores that scale and Fit shows the whole crop. Roomy
selections snap to a detected box before the original set_box measurement runs;
no fabricated contours or grading thresholds are used. Blank selections and
multiple boxes without a unique centred target are rejected.

Personal files replace a loaded sample and clear its names and answer key.
Adding more files to an existing personal exam preserves its entered key.
Mark Another Exam starts a fresh setup with empty names/key. ZIP/CSV output is
still generated from finalized responses, after all marking and review finish.


### Desktop page workspace

At widths of 1024 pixels and above, calibration uses a full-height page window
on the left and a bounded controls panel on the right. Instructions, tools and
steps share that panel; Next/Mark Exams stay visible at its bottom. The panel
can scroll on short screens. Smaller viewports retain the stacked touch layout.
Marked sheets use the same page-left/student-controls-right arrangement on
desktop, and Fit shows the entire portrait image. Zoom and Pan retain native
selection coordinates; the marking engine is unchanged.

Run `npm run test:desktop` (with `CHROMIUM_PATH` as needed) for the 1440×900,
1280×720 and 1024×600 desktop layout checks, portrait fit, visible controls,
selection and the marked-sheet layout. `test:interface` covers the smaller
screen/touch workflow.
