# Marked sheet viewer

The viewer aligns to the top instead of stretching to the sidebar height and vertically centring the sheet. Student selection and previous/next controls sit directly above the image. The right column contains a compact student score/download summary and item breakdown. Document order follows the same viewer-first arrangement, including on mobile.

Desktop viewing stays below the sticky results tabs. Image height fits the viewport; zoomed content scrolls inside its own area. Previous/next edge buttons sit outside that scroll area so zooming cannot move them off-screen. They appear on hover or keyboard focus, remain visible on touch/coarse-pointer devices, and hide at the corresponding end of the roster. There is no wraparound. Left/right arrow keys navigate when the viewer region itself has focus; the select and the image scroll area retain their native keyboard behaviour.

Changing students resets image zoom and scroll position. Navigation shares existing result selection state and does not render annotations or modify scores.

Validation: production build and TypeScript check; `CHROMIUM_PATH=/usr/bin/chromium node tests/sheetNavigation.browser.mjs` checks desktop 1440×900, desktop 1280×720 and touch/mobile 390×844, including tall-sidebar independence, document order, hover/touch controls, edge navigation, keyboard, roster boundaries, zoom/scroll reset and overflow. Results PDF/ZIP integration and desktop calibration/results layout tests pass. Desktop and mobile screenshots were inspected.
