# Keyed questions with no detected mark

A global ink threshold can miss very light pencil. Rather than lowering thresholds (and risking printed letters/noise being counted as answers), send every apparent blank with a valid answer-key entry to the existing answer-review queue. The key determines whether the question needs review; it never supplies the student's answer.

After the unchanged ink-counting pass, a keyed no-mark question becomes an unresolved response (`false`) with `reviewReason: 'no-mark'`. Its clean native-resolution crop is retained and the normal correction window explains that no mark was detected and asks the teacher to check for light pencil or choose Blank. Multiple-mark detection retains its existing behavior, with a separate reason. Unkeyed apparent blanks stay Blank and do not create reviews. Missing keys are also tolerated.

Teacher choices use the existing correction/grading/annotation path. Blank explicitly confirms a genuinely unanswered question; selecting a letter updates the canonical response, score and green/red outline. Other pending reviews remain pending. Manual choices, including Blank, are preserved on geometry re-read. Results still wait for required reviews to complete. No threshold, fill limit, box positioning, answer-key interpretation or drawing/scoring formula is changed, and no dependency is added.

Trade-off: genuinely unanswered questions inside the answer key now need confirmation too. Limit the key to the actual exam questions; unused printed rows beyond it stay excluded. This protects no-mark detections, not every possible single-answer misclassification.

## Reported physics PDF

The private eight-page document's last sheet reproduces the missed Q6 mark. Q10 is borderline: the exact selection/calibration can read its B automatically. A second test with a 5% higher fill limit exercises both Q6 and Q10 falling below detection, without changing any production threshold. Both then enter review. Confirming D for Q6 and B for Q10 produces **16/25**, a green Q6 outline, a red Q10 outline and the same score in CSV. The PNG test samples expected outline coordinates, excluding the green key letter at the cell centre.

The original PDF and its answer key are not committed. `test:blank-review` runs synthetic checks by default. Set `FAINT_MARKS_PDF` and `FAINT_MARKS_KEY` locally to repeat this particular private-file regression. The test helper accepts a supplied File, and the test selects all 14 rows of this document's blocks rather than assuming the bundled sample's shorter bounds.

## Files and validation

- `omrEngine.ts`: route keyed no-mark detections into review after existing classification.
- `types.ts`, `reviewQueue.ts`, `AmbiguityModal.tsx`: carry/display the reason without suggesting the key's answer.
- `grading.ts`: clear the reason when a teacher resolves the question; preserve existing score logic.
- `HelpModal.tsx`, `ReadMe.md`: explain keyed-blank review.
- `blankReview.browser.mjs`, `sampleCalibration.ts`, `package.json`: synthetic/private-PDF regression support.
- Existing interface and worker tests now expect keyed blanks to need review. The interface test confirms the genuine blanks, exercises Previous/revision across students, and reaches automatic results/CSV only after all reviews finish.

Passed: private PDF/outline/CSV check, synthetic keyed/unkeyed/missing-key and manual-preservation checks, full interface review flow, native worker/main pixel and recognition parity with the four-worker pool, grading UI/CSV/print/PNG consistency, native geometry re-read/manual preservation, TypeScript and production build.
