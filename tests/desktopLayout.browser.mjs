import assert from 'node:assert/strict';
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
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    reducedMotion: 'reduce',
  });
  await page.goto(server.resolvedUrls.local[0]);
  await page
    .getByRole('button', { name: 'Load Cambridge IGCSE Sample' })
    .click();
  const proceed = page.getByRole('button', { name: 'Continue to calibration' });
  await proceed.waitFor();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('button')].some(
      (b) => b.textContent === 'Continue to calibration' && !b.disabled,
    ),
  );
  await proceed.click();
  const canvas = page.getByLabel('Question area selection', { exact: true });
  await canvas.waitFor({ timeout: 120000 });
  const workspace = page.getByRole('region', {
    name: 'Scan workspace',
    exact: true,
  });
  const controls = page.getByRole('complementary', {
    name: 'Calibration controls',
    exact: true,
  });
  const verify = async (width, height) => {
    await page.setViewportSize({ width, height });
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );
    const w = await workspace.boundingBox(),
      c = await controls.boundingBox();
    assert.ok(w.x + w.width <= c.x + 1, 'Page window must be left of controls');
    assert.ok(
      w.height >= height - 110,
      'Page window should use nearly all height below the header',
    );
    assert.ok(
      c.width >= 320 && c.width <= 400,
      'Controls should have a readable bounded width',
    );
    const next = await page
      .getByRole('button', { name: 'Next: Select Box', exact: true })
      .boundingBox();
    assert.ok(
      next.x >= c.x &&
        next.x + next.width <= width &&
        next.y + next.height <= height,
      'Next must stay inside the visible right panel',
    );
    if (height >= 720) {
      const zoom = await page
        .getByRole('button', { name: 'Zoom in', exact: true })
        .boundingBox();
      const actionTop = await page
        .getByRole('button', { name: 'Next: Select Box', exact: true })
        .evaluate((el) => el.parentElement.getBoundingClientRect().top);
      assert.ok(
        zoom.y + zoom.height <= actionTop,
        'Zoom tools must be visible above the fixed actions',
      );
    }
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
  };
  for (const [width, height] of [
    [1440, 900],
    [1280, 720],
    [1024, 600],
  ]) {
    await verify(width, height);
    const r = await canvas.boundingBox();
    assert.ok(
      r.height > height - 145,
      'Portrait page should retain its available height',
    );
    await page.screenshot({
      path: `/workspace/work/desktop-calibration-${width}.png`,
    });
  }
  await verify(1280, 720);
  const a = await canvas.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width * 0.2, y: r.y + r.height * 0.2 };
  });
  const b = await canvas.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width * 0.8, y: r.y + r.height * 0.8 };
  });
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.mouse.up();
  const next = page.getByRole('button', {
    name: 'Next: Select Box',
    exact: true,
  });
  assert.equal(await next.isEnabled(), true);
  await next.click();
  await page.getByLabel('Empty box selection', { exact: true }).waitFor();
  const mark = await page
    .getByRole('button', { name: 'Mark Exams', exact: true })
    .boundingBox();
  const sidebar = await controls.boundingBox();
  assert.ok(
    mark.x >= sidebar.x && mark.y + mark.height <= 720,
    'Mark action must stay in the right panel',
  );
  await page.screenshot({ path: '/workspace/work/desktop-empty-box.png' });
  await page.close();
  const results = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  await results.goto(
    server.resolvedUrls.local[0] + 'tests/fixtures/grading.html',
  );
  await results.waitForFunction(() => window.showGradingResults);
  await results.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 4800;
    canvas.height = 6840;
    const c = canvas.getContext('2d');
    c.fillStyle = 'white';
    c.fillRect(0, 0, 4800, 6840);
    c.fillStyle = 'black';
    c.font = '120px sans-serif';
    c.fillText('Portrait marked sheet', 250, 300);
    window.showGradingResults(
      {
        id: 'portrait',
        index: 0,
        name: 'Portrait test',
        responses: ['A'],
        questions: [],
        score: 1,
        total: 1,
        percentage: 100,
        annotatedDataUrl: canvas.toDataURL(),
        originalDataUrl: '',
        hasAmbiguity: false,
        incomplete: [],
      },
      { 0: 'A' },
    );
  });
  await results
    .getByRole('tab', { name: 'Annotated Marked Sheets', exact: true })
    .click();
  const image = results.getByRole('img', { name: /Annotated sheet for/ });
  const selector = results.getByRole('heading', {
    name: 'Select student',
    exact: true,
  });
  assert.ok(
    (await image.boundingBox()).x + (await image.boundingBox()).width <=
      (await selector.boundingBox()).x,
    'Marked sheet must be left of student controls',
  );
  const fitted = await image.boundingBox();
  assert.ok(
    fitted.height <= 800 * 0.71 && fitted.height > 500,
    'Default sheet view must fit the whole portrait page',
  );
  await results
    .getByRole('button', { name: 'Zoom sheet in', exact: true })
    .click();
  assert.ok(
    (await image.boundingBox()).width > fitted.width,
    'Sheet zoom should still enlarge the image',
  );
  await results.getByRole('button', { name: 'Fit', exact: true }).click();
  await results.screenshot({
    path: '/workspace/work/desktop-results-layout.png',
  });
  console.log(
    'Desktop page-left/control-right calibration at 1440/1280/1024px, full-height portrait, visible actions, mouse selection and matching marked-sheet layout passed',
  );
} finally {
  await browser.close();
  await server.close();
}
