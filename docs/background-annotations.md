# Corrected sheets no longer block Results

Scores and review choices become final before rendering corrected sheets. Results opens immediately with the class statistics. Clean sheets keep their existing final PNG; corrected sheets retain the cleaned, registered scan and carry `annotationPending` until their native render finishes.

`PreparedAnnotations` owns one shared background finalization job. It uses the existing device-aware pool (up to two workers, one on constrained devices), exposes completion per student, and caches finished PNGs on the results. It does not change detection, alignment, scoring, or annotation pixels. Navigation never re-renders a finished sheet. A pending sheet shows an activity indicator instead of an outdated score or annotation.

Single-sheet PNG and print actions wait for that student's image. `PreparedDownloads` waits for the shared annotation job before constructing the PDF; ZIP then reuses that PDF and the same PNGs. This keeps annotation workers and export workers from overlapping their heavy jobs. Errors remain visible and retryable; Reset cancels workers and waiting actions before releasing images. React StrictMode cleanup cancels the old job before starting another.

This removes the end-of-review rendering barrier; it does not claim to reduce OpenCV marking time. Clean pages still encode their final PNG once. Corrected pages still need the retained clean scan and a final PNG, but that work now runs while the teacher can inspect statistics.

Validation: build, annotation pool/service tests (bounded concurrency, individual readiness, shared jobs, cancellation and failure), delayed-annotation Results test (immediate statistics, no stale preview, PNG waits for its image), grading/native annotation parity, and PDF/ZIP export tests.
