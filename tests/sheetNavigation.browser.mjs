import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{include:['pdf-lib','jszip']},server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  await mkdir('/workspace/work/benchmark-results/ui',{recursive:true});
  for(const [width,height,touch] of [[1440,900,false],[1280,720,false],[390,844,true]]){
    const page=await browser.newPage({viewport:{width,height},hasTouch:touch,isMobile:touch,reducedMotion:'reduce'});
    await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/results.html?portrait');
    await page.getByRole('tab',{name:'Annotated Marked Sheets',exact:true}).click();
    const viewer=page.getByRole('region',{name:'Marked sheet viewer',exact:true});
    await viewer.getByAltText('Annotated sheet for Alice').waitFor();
    const next=viewer.getByRole('button',{name:'Next student on sheet',exact:true});
    const scroll=viewer.getByLabel('Sheet image, scroll to inspect',{exact:true});
    assert.equal(await viewer.evaluate(el=>!!(el.compareDocumentPosition(Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Download Sheet (PNG)')))&Node.DOCUMENT_POSITION_FOLLOWING)),true,'Viewer navigation precedes sheet actions in keyboard order');
    const box=await viewer.boundingBox(),select=await viewer.getByRole('combobox',{name:'Select student'}).boundingBox();
    assert.ok(select.y-box.y<20,'Navigation must sit at the top, without a blank spacer');
    if(!touch){
      // A long breakdown must not stretch or vertically centre the viewer.
      await page.getByRole('heading',{name:'Item Breakdown (Response Key)'}).evaluate(el=>el.parentElement.style.minHeight='1200px');
      const after=await viewer.boundingBox();assert.ok(Math.abs(after.height-box.height)<2,'Sidebar height must not create viewer whitespace');
      await page.mouse.move(0,0);
      assert.equal(await next.evaluate(el=>getComputedStyle(el).opacity),'0');
      await viewer.hover();assert.equal(await next.evaluate(el=>getComputedStyle(el).opacity),'1');
    }else assert.ok(Number(await next.evaluate(el=>getComputedStyle(el).opacity))>0,'Touch arrows must be visible');
    await next.click();await viewer.getByAltText('Annotated sheet for Bob').waitFor();
    const previous=viewer.getByRole('button',{name:'Previous student on sheet',exact:true});
    await previous.click();await viewer.getByAltText('Annotated sheet for Alice').waitFor();
    await viewer.getByRole('button',{name:'Zoom sheet in',exact:true}).click();
    await scroll.evaluate(el=>el.scrollTo({top:300,left:200}));
    await next.click();await viewer.getByAltText('Annotated sheet for Bob').waitFor();
    await page.waitForFunction(()=>{const el=document.querySelector('[aria-label="Sheet image, scroll to inspect"]');return el.scrollTop===0&&el.scrollLeft===0;});
    assert.equal(await viewer.getByRole('button',{name:'Zoom sheet out',exact:true}).isDisabled(),true,'Student changes reset zoom');
    await viewer.focus();await page.keyboard.press('ArrowRight');
    await viewer.getByAltText(/Annotated sheet for Zoë/).waitFor();
    assert.equal(await viewer.locator('[aria-label="Next student on sheet"]').isDisabled(),true);
    await page.keyboard.press('ArrowLeft');await viewer.getByAltText('Annotated sheet for Bob').waitFor();
    const edge=await next.boundingBox();assert.ok(edge.y>=0&&edge.y+edge.height<=height,'Sheet-edge navigation must be reachable while viewing the sheet');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
    await page.screenshot({path:`/workspace/work/benchmark-results/ui/marked-sheet-${width}.png`});
    await page.close();
  }
  console.log('Marked-sheet navigation: top alignment, tall-sidebar independence, hover/touch edge controls, previous/next, keyboard, zoom reset and viewport checks passed.');
}finally{await browser.close();await server.close();}
