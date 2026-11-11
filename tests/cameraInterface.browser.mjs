import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build, createServer, preview } from 'vite';
let server;
if (process.env.CAMERA_TEST_BUILD) {
  const outDir='work/camera-ui-dist';
  await build({ build: { outDir } });
  server=await preview({ build: { outDir }, preview: { host:'127.0.0.1',port:0 } });
} else { server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}}); await server.listen(); }
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await page.addInitScript(() => {
    window.cameraWorkers = new Set();
    const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);window.cameraWorkers.add(this);}
      terminate(){window.cameraWorkers.delete(this);super.terminate();}
    };
  });
  await page.goto(server.resolvedUrls.local[0]);
  const capture=page.getByLabel('Camera photograph',{exact:true});
  assert.equal(await capture.getAttribute('capture'),'environment');
  assert.equal(await capture.getAttribute('accept'),'image/*');
  assert.equal(await page.getByLabel('Exam scan files',{exact:true}).getAttribute('capture'),null);
  assert.equal(await page.evaluate(()=>window.cameraWorkers.size),0,'camera must be lazy');
  await page.getByRole('button',{name:'Scan with Camera',exact:true}).waitFor();
  const png=await page.evaluate(() => {
    const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=3400;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#253540';ctx.fillRect(0,0,2400,3400);
    ctx.fillStyle='white';ctx.fillRect(200,200,2000,3000);
    ctx.fillStyle='black';ctx.font='70px sans-serif';ctx.fillText('ChilliMark camera preview',300,440);
    ctx.lineWidth=6;
    for(let y=900;y<2900;y+=90)for(let x=450;x<1900;x+=150){ctx.strokeRect(x,y,100,65);ctx.font='35px sans-serif';ctx.fillText('A',x+30,y+45);}
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const upload={name:'phone.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  await capture.setInputFiles(upload);
  const dialog=page.getByRole('dialog',{name:'Preview camera scan'});
  await dialog.waitFor();
  const confirm=dialog.getByRole('button',{name:'Confirm scan',exact:true});
  await page.waitForFunction(el=>!el.disabled,await confirm.elementHandle(),{timeout:120000});
  assert.equal(await dialog.getByRole('img',{name:'Perspective-corrected answer sheet'}).count(),1);
  await dialog.getByRole('button',{name:'Adjust corners',exact:true}).click();
  const handle=dialog.getByRole('slider',{name:'Page corner 1'});
  const before=await handle.getAttribute('aria-valuetext');
  await handle.focus();await page.keyboard.press('Shift+ArrowRight');
  assert.notEqual(await handle.getAttribute('aria-valuetext'),before);
  // Touch-compatible pointer events use the SVG coordinate transform.
  const bounds=await handle.boundingBox(), x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-3,y}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await cdp.detach();
  await dialog.getByRole('button',{name:'Update preview'}).click();
  await confirm.waitFor();
  await page.waitForFunction(el=>!el.disabled,await confirm.elementHandle(),{timeout:120000});
  // Every quarter turn remains usable; four turns restore the initial orientation.
  for(let turn=0;turn<4;turn++) {
    const previous=await dialog.getByRole('img',{name:'Perspective-corrected answer sheet'}).getAttribute('src');
    await dialog.getByRole('button',{name:'Rotate 90°',exact:true}).click();
    await page.waitForFunction(previous=>document.querySelector('img[alt="Perspective-corrected answer sheet"]')?.getAttribute('src')!==previous,previous);
    await page.waitForFunction(el=>!el.disabled,await confirm.elementHandle(),{timeout:120000});
  }
  await confirm.click();
  await dialog.waitFor({state:'detached',timeout:120000});
  await page.getByRole('heading',{name:'Loaded pages (1)',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.cameraWorkers.size),0,'worker released after confirmation');
  assert.equal(await page.getByRole('button',{name:'Continue to calibration',exact:true}).isDisabled(),true,'answer key still required');
  // Cancel a second scan while processing; no extra page should be added.
  await capture.setInputFiles(upload);await dialog.waitFor();
  await dialog.getByRole('button',{name:'Close camera scanner'}).click();
  await dialog.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.cameraWorkers.size),0,'cancel terminates worker');
  assert.equal(await page.getByRole('heading',{name:'Loaded pages (1)',exact:true}).count(),1);
  // Closing while the normal loader reads the corrected PNG must also cancel insertion.
  await page.evaluate(()=>{
    const NativeImage=window.Image;
    window.Image=function(...args){
      const image=new NativeImage(...args);
      Object.defineProperty(image,'onload',{set(callback){image.addEventListener('load',event=>{
        window.cameraMetadataLoading=true;setTimeout(()=>callback(event),1500);
      });}});
      return image;
    };
    window.Image.prototype=NativeImage.prototype;
  });
  await capture.setInputFiles(upload);await dialog.waitFor();
  await page.waitForFunction(el=>!el.disabled,await confirm.elementHandle(),{timeout:120000});
  await confirm.click();
  await page.waitForFunction(()=>window.cameraMetadataLoading,{},{timeout:120000});
  await dialog.getByRole('button',{name:'Close camera scanner'}).click();
  await page.waitForTimeout(1800);
  assert.equal(await page.getByRole('heading',{name:'Loaded pages (1)',exact:true}).count(),1,'cancelled confirmation added a page');
  assert.equal(await page.evaluate(()=>window.cameraWorkers.size),0);
  // Older browsers can use the same preprocessing on the main thread.
  const fallback=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await fallback.addInitScript(()=>Object.defineProperty(window,'OffscreenCanvas',{value:undefined}));
  await fallback.goto(server.resolvedUrls.local[0]);
  await fallback.getByLabel('Camera photograph',{exact:true}).setInputFiles(upload);
  const fallbackDialog=fallback.getByRole('dialog',{name:'Preview camera scan'});
  await fallbackDialog.waitFor();
  const fallbackConfirm=fallbackDialog.getByRole('button',{name:'Confirm scan',exact:true});
  await fallback.waitForFunction(el=>!el.disabled,await fallbackConfirm.elementHandle(),{timeout:120000});
  await fallbackConfirm.click();
  await fallbackDialog.waitFor({state:'detached',timeout:120000});
  await fallback.getByRole('heading',{name:'Loaded pages (1)',exact:true}).waitFor();
  await fallback.close();
  console.log('Camera compatibility fallback without OffscreenCanvas passed.');
  console.log('Camera mobile UI: lazy entry, corrected preview, keyboard/touch corners, confirm, original setup and cancellation passed.');
} finally {await browser.close();await server.close();}
