import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 await page.goto(server.resolvedUrls.local[0]);
 await page.getByRole('button',{name:'Load IBDP Sample',exact:true}).click();
 const proceed=page.getByRole('button',{name:'Continue to calibration',exact:true});await proceed.click({timeout:120000});
 const canvas=page.getByLabel('Question area selection',{exact:true});await canvas.waitFor({timeout:120000});
 const workspace=page.getByRole('region',{name:'Scan workspace',exact:true});
 const guide=page.locator('.mobile-selection-guide');await guide.waitFor();
 const next=page.getByRole('button',{name:'Next: Select Box',exact:true});
 for(const [width,height] of [[390,844],[360,740],[320,640]]){
  await page.setViewportSize({width,height});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const space=await workspace.boundingBox(), sheet=await canvas.boundingBox(), action=await next.boundingBox();
  assert.ok(space.height>=height*.6,`workspace too small at ${width}: ${space.height}`);
  assert.ok(sheet.width>=width*.8,`page too small at ${width}: ${sheet.width}`);
  assert.ok(action.y+action.height<=height+1,'Next must remain reachable');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal overflow');
 }
 await page.setViewportSize({width:390,height:844});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await mkdir('work',{recursive:true});
 const animation=guide.locator('svg');
 const start=await animation.evaluate(svg=>{svg.setCurrentTime(.2);return svg.querySelector('.guide-motion rect').width.animVal.value;});
 const endWidth=await animation.evaluate(svg=>{svg.setCurrentTime(2.5);return svg.querySelector('.guide-motion rect').width.animVal.value;});
 assert.ok(start<1 && endWidth>99,'bounding box must grow around the squares');
 await page.screenshot({path:'work/mobile-selection-guide.png'});
 const rect=await guide.boundingBox();
 const hit=await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.getAttribute('aria-label'),{x:rect.x+rect.width/2,y:rect.y+rect.height/2});
 assert.equal(hit,'Question area selection','guide must pass touches through to canvas');
 // Touch starts over the animation itself, then draws through it.
 const center={x:rect.x+rect.width*.45,y:rect.y+rect.height*.45};
 const end={x:rect.x+rect.width*.7,y:rect.y+rect.height*.7};
 const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{...center,id:1}]});
 await guide.waitFor({state:'detached'});
 for(let i=1;i<=6;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:center.x+(end.x-center.x)*i/6,y:center.y+(end.y-center.y)*i/6,id:1}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(element=>!element.disabled,await next.elementHandle());
 assert.equal(await guide.count(),0,'guide must stay hidden after selection');
 await page.getByRole('button',{name:'Clear selection',exact:true}).click();await guide.waitFor();
 await page.emulateMedia({reducedMotion:'reduce'});
 assert.equal(await guide.locator('.guide-motion').evaluate(el=>getComputedStyle(el).display),'none');
 assert.notEqual(await guide.locator('.guide-static').evaluate(el=>getComputedStyle(el).display),'none');
 console.log('Mobile selection: 60%+ workspace, large page, visible action, draw-through animated guide, first-touch dismissal, clear/reset and reduced motion passed.');
}finally{await browser.close();await server.close();}
