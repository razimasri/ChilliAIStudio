import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(server.resolvedUrls.local[0]);
  for (const src of ['/icons/printmark.png']) {
    await page.waitForFunction(src=>[...document.images].some(img=>img.getAttribute('src')===src&&img.complete&&img.naturalWidth>0),src);
  }
  assert.equal(await page.locator('link[rel="icon"]').getAttribute('href'),'/icons/Icon16.png');
  await page.getByRole('button',{name:'Guide',exact:true}).click();
  const guide=page.locator('.fixed.inset-0.z-50');
  await guide.getByRole('img',{name:'ChilliMark logo'}).waitFor();
  await guide.locator('button').first().click();
  await page.screenshot({path:'/workspace/work/branding-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'Branding must fit a phone screen');
  await page.screenshot({path:'/workspace/work/branding-mobile.png'});
  const watermark=await page.evaluate(async()=>{
    const {getCV}=await import('/src/utils/cvLoader.ts');
    const {addWatermark}=await import('/src/utils/watermark.ts');
    const cv=await getCV();
    const scan=new cv.Mat(6840,4800,cv.CV_8UC4,new cv.Scalar(225,230,235,255));
    await addWatermark(cv,scan);
    const image=await new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src='/icons/printmark.png';});
    const canvas=document.createElement('canvas');canvas.width=273;canvas.height=256;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,273,256);ctx.drawImage(image,0,0);
    const expected=ctx.getImageData(0,0,273,256).data;
    const roi=scan.roi(new cv.Rect(4271,256,273,256));
    const actual=new cv.Mat();roi.copyTo(actual);roi.delete();
    const exact=expected.every((value,i)=>value===actual.data[i]);
    await addWatermark(cv,scan);
    const repeated=scan.roi(new cv.Rect(4271,256,273,256));
    const repeatedCopy=new cv.Mat();repeated.copyTo(repeatedCopy);repeated.delete();
    const stable=expected.every((value,i)=>value===repeatedCopy.data[i]);
    const outside=[...scan.ucharPtr(256,4270)].slice(0,4);
    actual.delete();repeatedCopy.delete();scan.delete();
    return {exact,stable,outside};
  });
  assert.deepEqual(watermark,{exact:true,stable:true,outside:[225,230,235,255]});
  const firstPass=await page.evaluate(async()=>{
    const e=await import('/src/utils/omrEngine.ts');
    const {getCV}=await import('/src/utils/cvLoader.ts');const cv=await getCV();
    const canvas=document.createElement('canvas');canvas.width=4800;canvas.height=6840;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,4800,6840);
    ctx.strokeStyle='black';ctx.lineWidth=4;ctx.strokeRect(300,900,4200,5300);
    for(let block=0;block<2;block++)for(let c=0;c<4;c++)for(let r=0;r<6;r++)ctx.strokeRect(700+block*2000+c*300,1300+r*600,120,100);
    const raw=canvas.toDataURL('image/png');
    const mat=await e.renderToCanonicalMat(cv,raw);const {rotated,rect}=e.rotation(cv,mat);mat.delete();
    const box=e.set_box(cv,rotated,697,1297,823,1403);rotated.delete();
    const params={...box,rect,x1:500,y1:1100,x2:4300,y2:6000,key:Object.fromEntries(Array.from({length:12},(_,i)=>[i,'A'])),names:[]};
    const result=await e.processStudentScan(cv,raw,'Blank test',0,params);
    if(result.hasAmbiguity||result.questions.length!==12)throw new Error('Synthetic first-pass scan did not produce 12 blank questions');
    const exported=await e.renderScanMat(cv,result.annotatedDataUrl);
    const roi=exported.roi(new cv.Rect(4271,256,273,256)),packed=new cv.Mat();roi.copyTo(packed);
    const logo=await e.loadImageElement('/icons/printmark.png');canvas.width=273;canvas.height=256;
    const context=canvas.getContext('2d');context.fillStyle='white';context.fillRect(0,0,273,256);context.drawImage(logo,0,0);
    const expected=context.getImageData(0,0,273,256).data;
    const exact=expected.every((value,i)=>value===packed.data[i]);packed.delete();roi.delete();exported.delete();return exact;
  });
  assert.equal(firstPass,true,'First-pass annotated PNG must contain the original watermark');
  console.log('Original header/banner/guide/favicon assets load; mobile layout fits; watermark exactly matches original asset at [4271,256,273,256], is repeatable, and leaves adjacent pixels unchanged');
} finally {await browser.close();await server.close();}
