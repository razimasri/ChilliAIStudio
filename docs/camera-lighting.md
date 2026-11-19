# White-paper camera correction

Single, batch and automatic scanning share camera-only white-paper normalization after perspective correction. The original photograph used for corner editing and all flatbed/PDF inputs remain unchanged. Quality checks use the uncorrected capture so brightening cannot make a blurred photograph pass.

A reduced image (maximum edge 512 px) supplies a local, per-channel paper estimate. Morphological closing removes narrow dark marks from that estimate. Dividing each pixel by its local paper colour lifts grey paper, colour casts and broad phone shadows toward white while retaining continuous pencil contrast. There is no binary threshold or global brightness boost. Full-resolution application uses 128-row strips to avoid another full-page RGBA allocation. Preview, thumbnail and final export all use the same procedure, each starting from the original photo.

This assumes white paper. Coloured paper and broad dark graphics can be lightened; clipped detail and very sharp shadow edges cannot be reconstructed. Normalization does not change the MCQ marking algorithm or its blur size.

Validation includes synthetic coloured lighting and soft phone shadows at preview and 4800×6840 output sizes, with faint pencil and black print, plus the existing real sample camera/marking regressions. These simulations do not establish accuracy on every physical phone capture.
