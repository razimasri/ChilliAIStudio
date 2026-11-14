import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  for (const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});
    await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/liveReview.html');
    const dialog=page.getByRole('dialog');
    const open=dialog.getByRole('button',{name:'Show full page',exact:true});
    await open.click();
    const image=dialog.getByAltText('Full answer sheet for Review test');await image.waitFor();
    assert.equal(await dialog.getByRole('button',{name:'Hide full page',exact:true}).getAttribute('aria-expanded'),'true');
    const original=await image.boundingBox();
    await dialog.getByRole('button',{name:'Zoom full page in',exact:true}).click();
    const enlarged=await image.boundingBox();assert.ok(enlarged.width>original.width,'Zoom should enlarge the full page');
    await dialog.getByRole('button',{name:'Fit full page',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.selections.length),0,'Inspecting the page must not submit an answer');
    assert.ok(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Dialog must fit the viewport');
    await dialog.getByRole('button',{name:'Choose B on scan',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.selections),['B'],'Snippet correction must remain available beside full page');
    await dialog.getByRole('button',{name:'Hide full page',exact:true}).click();
    assert.equal(await image.count(),0);
    await open.click();await image.waitFor();
    await page.keyboard.press('C');assert.deepEqual(await page.evaluate(()=>window.selections),['B','C']);
    await page.close();
  }
  console.log('Desktop and mobile full-page review: show/hide, zoom/fit, responsive layout, snippet and keyboard choices passed.');
} finally {await browser.close();await server.close();}
