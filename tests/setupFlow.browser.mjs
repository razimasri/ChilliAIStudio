import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  await mkdir('/workspace/work/benchmark-results/ui',{recursive:true});
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
    const page=await browser.newPage({viewport,reducedMotion:'reduce'});
    await page.goto(server.resolvedUrls.local[0]);
    const png=await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=800;c.height=1100;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,800,1100);ctx.fillStyle='black';ctx.font='40px sans-serif';ctx.fillText('Answer sheet',70,110);for(let y=300;y<950;y+=55)for(let x=150;x<600;x+=100)ctx.strokeRect(x,y,55,35);return c.toDataURL().split(',')[1];
    });
    const file={name:'scan.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
    const proceed=page.getByRole('button',{name:'Continue to calibration',exact:true});
    assert.equal(await proceed.isEnabled(),false);
    await page.getByLabel('Exam scan files',{exact:true}).setInputFiles(file);
    const pages=page.getByRole('region',{name:'Exam pages',exact:true});
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Exam pages');
    await page.getByRole('button',{name:'Preview page 1',exact:true}).waitFor();
    const preview=await page.getByRole('button',{name:'Preview page 1',exact:true}).boundingBox();
    const toggle=page.getByRole('button',{name:'Add or replace scans',exact:true});
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','Source panel collapses after loading');
    assert.equal(await page.getByRole('button',{name:'Camera Scan',exact:true}).count(),0,'Camera controls stay out of the way');
    const add=await toggle.boundingBox();
    assert.ok(preview.y<add.y,'Loaded previews must appear above Add files');
    const domOrder=await pages.evaluate(el=>{
      const preview=el.querySelector('[aria-label="Preview page 1"]');
      const add=Array.from(el.querySelectorAll('button')).find(b=>b.textContent==='Add files');
      return !!(preview.compareDocumentPosition(add)&Node.DOCUMENT_POSITION_FOLLOWING);
    });assert.equal(domOrder,true,'Keyboard order must match layout');
    assert.equal(await proceed.isEnabled(),false,'Answer key is still required');
    await page.getByLabel('Answer key',{exact:true}).fill('ABCD');
    assert.equal(await proceed.isEnabled(),true);
    assert.equal(await proceed.evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(8, 122, 72)');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No horizontal overflow');
    const bounds=await proceed.boundingBox();assert.ok(bounds.y+bounds.height<=viewport.height+1,'Progression stays visible');
    await page.getByRole('button',{name:'Preview page 1',exact:true}).click();
    const dialog=page.getByRole('dialog');await dialog.waitFor();
    await dialog.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Preview page 1',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByRole('button',{name:'Rotate page 1 90 degrees',exact:true}).click();
    assert.equal(await page.getByRole('button',{name:'Rotate page 1 90 degrees',exact:true}).evaluate(el=>el===document.activeElement),true,'Rotation must not move focus to the section');
    await toggle.click();
    assert.equal(await page.getByRole('button',{name:'Add files',exact:true}).isVisible(),true);
    assert.equal(await page.getByRole('button',{name:'Auto Scan',exact:true}).isVisible(),true);
    await page.getByLabel('Exam scan files',{exact:true}).setInputFiles({...file,name:'second-scan.png'});
    await page.getByRole('button',{name:'Preview page 2',exact:true}).waitFor();
    await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Exam pages');
    await page.waitForFunction(()=>document.querySelector('[aria-controls="scan-source-panel"]')?.getAttribute('aria-expanded')==='false');
    await page.getByRole('button',{name:'Clear pages & names',exact:true}).click();
    await page.getByRole('button',{name:'Choose files',exact:true}).waitFor();
    assert.equal(await toggle.count(),0,'Empty setup exposes sources without another click');
    await page.screenshot({path:`/workspace/work/benchmark-results/ui/setup-${viewport.width}.png`});
    await page.close();
  }
  console.log('Desktop/mobile setup: previews precede upload, new-page focus, append/rotate/preview, green progression, readiness and viewport checks passed.');
}finally{await browser.close();await server.close();}
