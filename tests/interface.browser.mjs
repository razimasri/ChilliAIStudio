import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const server = await createServer({
  server: { host: '127.0.0.1', port: 0, hmr: false },
});
await server.listen();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const origin = server.resolvedUrls.local[0];
try {
  for (const [width, height] of [
    [1440, 900],
    [768, 1024],
    [390, 844],
    [844, 390],
  ]) {
    const page = await browser.newPage({
      viewport: { width, height },
      hasTouch: width < 1000,
      isMobile: width < 500,
    });
    await page.goto(origin);
    assert.match(await page.title(), /v2.0 Birdseye/);
    await page.getByRole('button', { name: 'Guide', exact: true }).click();
    const guide = page.getByRole('dialog', { name: 'ChilliMark Guide' });
    await guide.waitFor();
    await guide.getByText('v2.0 Birdseye', { exact: true }).waitFor();
    assert.equal(
      await guide
        .getByText(/fine-tuning handles|Load 10 Demo|Mark Threshold/)
        .count(),
      0,
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(
        () => !!document.activeElement.closest('[role="dialog"]'),
      ),
      true,
    );
    await guide.getByRole('button', { name: 'Got it', exact: true }).focus();
    const closeBounds = await guide
      .getByRole('button', { name: 'Got it', exact: true })
      .boundingBox();
    assert.ok(
      closeBounds.y >= 0 && closeBounds.y + closeBounds.height <= height,
      'Guide controls must be reachable on short screens',
    );
    await page.keyboard.press('Tab');
    assert.equal(
      await guide
        .getByRole('button', { name: 'Close guide', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
      'Tab must wrap within the dialog',
    );
    await page.keyboard.press('Escape');
    await guide.waitFor({ state: 'detached' });
    assert.equal(
      await page
        .getByRole('button', { name: 'Guide', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page
      .getByRole('button', { name: 'Load Cambridge IGCSE Sample' })
      .click();
    await page.getByTitle('Rotate 90°').first().waitFor();
    const proceed = page.getByRole('button', {
      name: 'Continue to calibration',
      exact: true,
    });
    await proceed.waitFor();
    assert.equal(await proceed.isEnabled(), true);
    assert.equal(
      await page
        .getByRole('region', { name: 'Names and answer key', exact: true })
        .evaluate((el) => el === document.activeElement),
      true,
      'Loading should move focus to setup',
    );
    const bounds = await proceed.boundingBox();
    assert.ok(
      bounds.y >= 0 && bounds.y + bounds.height <= height + 1,
      'Continue must stay visible',
    );
    assert.equal(
      await page
        .getByRole('heading', { name: 'Drag & Drop Exam Scans' })
        .count(),
      0,
    );
    assert.equal(
      (await page.getByLabel('Answer key', { exact: true }).inputValue())
        .length,
      27,
    );
    const originalNames = (
      await page.getByLabel('Student names', { exact: false }).inputValue()
    ).split('\n');
    await page
      .getByRole('button', { name: 'Remove page 2', exact: true })
      .click();
    const after = (
      await page.getByLabel('Student names', { exact: false }).inputValue()
    ).split('\n');
    assert.deepEqual(
      after,
      originalNames.filter((_, i) => i !== 1),
      'Removing a page must preserve name associations',
    );
    await page
      .getByLabel('Student names', { exact: false })
      .fill('Only One Name');
    assert.equal(await proceed.isDisabled(), true);
    await page.getByLabel('Student names', { exact: false }).fill('');
    assert.equal(await proceed.isEnabled(), true);
    await page.getByLabel('Answer key', { exact: true }).fill('');
    assert.equal(await proceed.isDisabled(), true);
    await page.getByLabel('Answer key', { exact: true }).fill('ABC');
    await page
      .getByRole('button', { name: 'Preview page 1', exact: true })
      .click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      `Upload overflows at ${width}px`,
    );
    await page.screenshot({
      path: `/workspace/work/birdseye-upload-${width}.png`,
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Clear pages & names' }).click();
    await page.getByText('Try a sample', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Load IBDP Sample' }).click();
    await page.getByTitle('Rotate 90°').first().waitFor();
    assert.equal(
      (await page.getByLabel('Answer key', { exact: true }).inputValue())
        .length,
      30,
    );
    await page.close();
  }
  console.log(
    'interface: desktop/tablet/phone setup, persistent action, readiness, name alignment, sample keys, guide/focus and preview dialogs passed',
  );
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    reducedMotion: 'reduce',
  });
  page.on('pageerror', (error) => console.error(error));
  await page.goto(origin);
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4800;
    canvas.height = 6840;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 4800, 6840);
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 4;
    ctx.strokeRect(300, 900, 4200, 5300);
    for (let block = 0; block < 2; block++)
      for (let c = 0; c < 4; c++)
        for (let r = 0; r < 6; r++)
          ctx.strokeRect(
            700 + block * 2000 + c * 300,
            1300 + r * 600,
            120,
            100,
          );
    ctx.fillStyle = 'black';
    ctx.fillRect(725, 1325, 65, 50);
    ctx.fillRect(725, 1925, 65, 50);
    ctx.fillRect(1025, 1925, 65, 50);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.locator('input[type="file"]').setInputFiles([
    {
      name: 'one.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    },
    {
      name: 'two.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    },
  ]);
  await page.getByTitle('Rotate 90°').first().waitFor();
  assert.equal(
    await page.getByTitle('Rotate 90°').count(),
    2,
    'Both selected image files must be loaded',
  );
  assert.equal(
    await page.getByLabel('Student names', { exact: false }).inputValue(),
    '',
    'Real uploads must not insert sample names',
  );
  await page.getByLabel('Answer key', { exact: true }).fill('AAAAAAAAAAAA');
  await page.getByRole('button', { name: 'Continue to calibration' }).click();
  const area = page.getByLabel('Question area selection', { exact: true });
  await area.waitFor({ timeout: 120000 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    'Calibration must fit a phone',
  );
  const cdp = await page.context().newCDPSession(page);
  const point = async (canvas, x, y) =>
    canvas.evaluate(
      (el, { x, y }) => {
        const r = el.getBoundingClientRect();
        return {
          x: r.x + (x / el.width) * r.width,
          y: r.y + (y / el.height) * r.height,
        };
      },
      { x, y },
    );
  const touchDrag = async (canvas, start, end, cancel = false) => {
    const a = await point(canvas, ...start),
      b = await point(canvas, ...end);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: a.x, y: a.y, id: 1 }],
    });
    for (let i = 1; i <= 8; i++)
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: a.x + ((b.x - a.x) * i) / 8,
            y: a.y + ((b.y - a.y) * i) / 8,
            id: 1,
          },
        ],
      });
    await cdp.send('Input.dispatchTouchEvent', {
      type: cancel ? 'touchCancel' : 'touchEnd',
      touchPoints: [],
    });
  };
  const next = page.getByRole('button', {
    name: 'Next: Select Box',
    exact: true,
  });
  await page.setViewportSize({ width: 844, height: 390 });
  const nextBounds = await next.boundingBox();
  assert.ok(
    nextBounds.x >= 0 &&
      nextBounds.x + nextBounds.width <= 844 &&
      nextBounds.y + nextBounds.height <= 390,
    'Calibration action must fit landscape',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await touchDrag(area, [500, 1100], [4300, 6000], true);
  assert.equal(
    await next.isDisabled(),
    true,
    'Cancelled touch must not commit',
  );
  await touchDrag(area, [500, 1100], [4300, 6000]);
  assert.equal(await next.isEnabled(), true);
  assert.equal(
    await page.getByLabel('Empty box selection', { exact: true }).count(),
    0,
    'Drawing must not advance automatically',
  );
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  const a = await point(area, 500, 1100),
    b = await point(area, 4300, 6000);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  assert.equal(await next.isEnabled(), true, 'Mouse selection failed');
  await page
    .getByRole('button', { name: 'Clear selection', exact: true })
    .click();
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: b.x,
    y: b.y,
    pointerType: 'pen',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: b.x,
    y: b.y,
    button: 'left',
    clickCount: 1,
    pointerType: 'pen',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: a.x,
    y: a.y,
    button: 'left',
    buttons: 1,
    pointerType: 'pen',
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: a.x,
    y: a.y,
    button: 'left',
    clickCount: 1,
    pointerType: 'pen',
  });
  assert.equal(await next.isEnabled(), true, 'Pen/reverse selection failed');
  await next.click();
  const box = page.getByLabel('Empty box selection', { exact: true });
  await box.waitFor();
  await page.getByRole('button', { name: 'Fit', exact: true }).click();
  for (let i = 0; i < 12; i++)
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await page.getByRole('button', { name: 'Pan', exact: true }).click();
  const canvasBox = await box.boundingBox();
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: canvasBox.x + 150, y: canvasBox.y + 150, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: canvasBox.x + 80, y: canvasBox.y + 80, id: 1 }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  });
  assert.ok(
    (await box.evaluate((el) => el.closest('[aria-busy]').scrollLeft)) > 0,
    'Pan must scroll the zoomed canvas',
  );
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  await box.evaluate((el) => {
    const viewport = el.closest('[aria-busy]');
    viewport.scrollLeft = 0;
    viewport.scrollTop = 0;
  });
  // Pick a clean box: first row, second column, using coordinates local to the selected crop.
  await touchDrag(box, [997 - 500, 1297 - 1100], [1123 - 500, 1403 - 1100]);
  const mark = page.getByRole('button', { name: 'Mark Exams', exact: true });
  await mark.waitFor();
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('button')].some(
        (b) => b.textContent === 'Mark Exams' && !b.disabled,
      ),
    null,
    { timeout: 120000 },
  );
  await page.screenshot({
    path: '/workspace/work/birdseye-calibration-touch.png',
  });
  await mark.click();
  const review = page.getByRole('dialog');
  await review
    .getByRole('heading', { name: /Student 01/ })
    .waitFor({ timeout: 120000 });
  await review.getByRole('button', { name: 'A', exact: true }).click();
  await review.getByRole('heading', { name: /Student 01/ }).waitFor();
  await review
    .getByRole('button', { name: 'Confirm & next', exact: true })
    .click();
  await review.getByRole('heading', { name: /Student 02/ }).waitFor();
  await review.getByRole('button', { name: 'Back', exact: true }).click();
  await review.getByRole('heading', { name: /Student 01/ }).waitFor();
  assert.equal(
    await review
      .getByRole('button', { name: 'A', exact: true })
      .getAttribute('aria-pressed'),
    'true',
    'Back must restore the saved decision',
  );
  await review
    .getByRole('button', { name: 'Blank (no mark)', exact: true })
    .click();
  await review
    .getByRole('button', { name: 'Confirm & next', exact: true })
    .click();
  await review.getByRole('button', { name: 'Unclear', exact: true }).click();
  await review
    .getByRole('button', { name: 'Confirm & finish', exact: true })
    .click();
  await page
    .getByRole('heading', { name: 'Class Overview & Question Analysis' })
    .waitFor({ timeout: 120000 });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Class Report CSV', exact: true }).click(),
  ]);
  const csv = await readFile(await download.path(), 'utf8');
  assert.match(csv, /Student 01/);
  assert.match(csv, /Student 02/);
  assert.ok(
    csv.includes('"Student 01","1","A","Blank"'),
    'Revising an earlier review decision must update the exported response and score',
  );
  assert.ok(
    csv.includes('"Student 02","1","A","Unclear"'),
    'Final Unclear decision must be exported',
  );
  await page
    .getByRole('tab', { name: 'Annotated Marked Sheets', exact: true })
    .click();
  const sheet = page.getByRole('img', { name: /Annotated sheet for/ });
  await sheet.waitFor();
  const breakdown = page.getByRole('heading', {
    name: 'Item Breakdown (Response Key)',
    exact: true,
  });
  assert.ok(
    (await sheet.boundingBox()).y < (await breakdown.boundingBox()).y,
    'Mobile sheet should precede the question breakdown',
  );
  assert.equal(
    await page
      .getByRole('button', { name: 'Download Sheet (PNG)', exact: true })
      .count(),
    1,
  );
  assert.equal(
    await page
      .getByRole('button', { name: /Download All Student Work/ })
      .count(),
    1,
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
    'Results overflow the phone',
  );
  await page.screenshot({
    path: '/workspace/work/birdseye-results-mobile.png',
    fullPage: true,
  });
  console.log(
    'interface: actual touch/mouse/pen selection, cancellation, Draw/Pan, empty-box calibration, parallel marking, review Back/revision, CSV and mobile sheet flow passed',
  );
} catch (error) {
  for (const context of browser.contexts())
    for (const page of context.pages())
      await page
        .screenshot({
          path: '/workspace/work/birdseye-interface-failure.png',
          fullPage: true,
        })
        .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await server.close();
}
