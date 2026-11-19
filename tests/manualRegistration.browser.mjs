import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/manualAlignment.html');
  const result=await page.evaluate(async()=>{
    const {getCV}=await import('/src/utils/cvLoader.ts');
    const {registerManualPage}=await import('/src/utils/manualRegistration.ts');
    const cv=await getCV(),image=new cv.Mat(855,600,cv.CV_8UC4,new cv.Scalar(255,255,255,255));
    cv.rectangle(image,new cv.Point(240,290),new cv.Point(260,310),new cv.Scalar(200,20,20,255),-1);
    const output=registerManualPage(cv,image,[100,200,300,200],[800,1200,3000,1800]);
    const centre=Array.from(output.ucharPtr(2100,2300));
    const paper=Array.from(output.ucharPtr(0,0));output.delete();
    // A tiny manual selection must not allocate a page enlarged hundreds of times.
    const tiny=registerManualPage(cv,image,[10,10,6.25,6.25],[800,1200,3000,1800]);
    const dimensions=[tiny.cols,tiny.rows];tiny.delete();image.delete();
    return {centre,paper,dimensions};
  });
  assert.deepEqual(result.centre,[200,20,20,255]);assert.deepEqual(result.paper,[255,255,255,255]);assert.deepEqual(result.dimensions,[4800,6840]);
  console.log('Manual registration maps reference geometry correctly and bounds output for extreme selections.');
}finally{await browser.close();await server.close();}
