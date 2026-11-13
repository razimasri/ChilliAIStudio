# Performance follow-ups

- Compare maintained prebuilt OpenCV SIMD packages with our pinned build and the
  same accuracy suite before committing to long-term custom runtime maintenance.
  User requested a reminder when revisiting runtime/dependency maintenance.
- Investigate a separate annotation/display layer and deferred native exports.
  PNG encoding remains a cost on clean pages; parallel finalization only shortens
  the corrected-sheet tail and does not eliminate per-page PNG work.
