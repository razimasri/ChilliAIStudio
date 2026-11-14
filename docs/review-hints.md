# Stable review guidance and yellow hints

The no-mark message no longer inserts a banner above the answer snippet. A fixed-height guidance area below the Blank/Unclear controls uses short messages for every review state. Switching between blank, multiple-mark and other reviews therefore keeps the snippet and controls in the same position, including on small phones.

For unresolved reviews, Blank is yellow when the existing no-mark detector flags the question. Unclear is yellow only when exactly two detected filled boxes have finite, positive ink counts and the weaker count is at least 90% of the stronger count (inclusive). Other multiple-mark cases remain reviewable without the near-equal hint. A teacher's saved choice takes precedence, and a hint never changes aria-pressed, submits a response or affects scoring.

The engine retains each box's already calculated countNonZero value as optional inkCount metadata; there is no new threshold pass, changed fill limit or altered answer detection. Blur remains 5×5, without a teacher-facing blur choice. These cosmetic hints do not address camera-image quality or alter camera processing.

Validation: production build; desktop/mobile review tests at 1440×900, 390×844 and 320×640 covering stationary snippet position, yellow presentation, exact 10% boundary, unequal/three-mark cases, no auto-selection and manual-choice precedence; native blank-review tests with actual 100/90 ink counts and manual correction preservation; grading checks for score/CSV/annotation consistency.
