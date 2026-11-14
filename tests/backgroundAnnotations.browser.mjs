import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page = await browser.newPage({acceptDownloads:true});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/results.html?pending');
  await page.getByText('Question Analysis', {exact:false}).first().waitFor();
  // Native annotations are deliberately blocked; the statistics screen must already work.
  await page.getByRole('tab', {name:'Annotated Marked Sheets'}).click();
  await page.getByRole('status').filter({hasText:'Preparing corrected sheet'}).waitFor();
  assert.equal(await page.getByAltText('Annotated sheet for Alice').count(),0,'Never show the stale pre-correction image');
  let downloaded=false;
  page.on('download',()=>downloaded=true);
  await page.getByRole('button',{name:/Download Sheet/}).first().click();
  assert.equal(downloaded,false,'A single PNG must wait for its corrected annotations');
  const download=page.waitForEvent('download');
  await page.evaluate(()=>window.releaseAnnotation());
  await page.getByAltText('Annotated sheet for Alice').waitFor();
  assert.match((await download).suggestedFilename(),/Alice.*Marked.png/);
  console.log({resultsBeforeAnnotations:true,noStalePreview:true,downloadWaited:true});
} finally {await browser.close();await server.close();}
