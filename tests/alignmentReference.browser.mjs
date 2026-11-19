import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}}); await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();
  page.on('console',m=>{if(m.text().startsWith('alignment:')) console.log(m.text());});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/camera.html');
  const report=await page.evaluate(async()=>{
    const {matchesAlignmentReference:matches}=await import('/src/utils/alignmentReference.ts');
    const e=await import('/src/utils/omrEngine.ts');
    const {getCV}=await import('/src/utils/cvLoader.ts');
    const {setup}=await import('/tests/helpers/sampleCalibration.ts');
    const {getExamPage,releaseUnusedSources}=await import('/src/utils/pdfProcessor.ts');
    const check=(v,m)=>{if(!v)throw Error(m);};
    const ref=[600,1200,3600,1600];
    check(matches(ref,ref,4800,6840),'identical');
    check(matches([300,600,1800,800],ref,2400,3420),'native 300 DPI');
    check(matches(ref.map(v=>v*2/3),ref,3200,4560),'native 400 DPI');
    check(matches([420,1120,3960,1760],ref,4800,6840),'inclusive 10% dimensions');
    check(!matches([402,1112,3996,1776],ref,4800,6840),'11% dimensions');
    check(matches([1080,1884,3600,1600],ref,4800,6840),'inclusive 10% location');
    check(!matches([1081,1200,3600,1600],ref,4800,6840),'x position');
    check(!matches([600,1885,3600,1600],ref,4800,6840),'y position');
    check(!matches([0,0,NaN,0],ref,4800,6840),'invalid geometry');
    const cv=await getCV();
    const image=new cv.Mat(6840,4800,cv.CV_8UC4,new cv.Scalar(255,255,255,255));
    const box=(r)=>cv.rectangle(image,new cv.Point(r[0],r[1]),new cv.Point(r[0]+r[2],r[1]+r[3]),new cv.Scalar(0,0,0,255),10);
    box(ref);
    const selected=e.largest_cnt(cv,image),b=cv.boundingRect(selected); selected.delete();
    const expected=[b.x,b.y,b.width,b.height];
    box([300,4000,4200,2200]); // Larger unrelated dark region must not win registration.
    const unguarded=e.largest_cnt(cv,image),wrong=cv.boundingRect(unguarded); unguarded.delete();
    check(wrong.y>3900,'fixture must defeat the old largest-contour rule');
    const guarded=e.rotation(cv,image,{referenceRect:expected});
    check(guarded.rect.every((v,i)=>Math.abs(v-expected[i])<=2),'must select matching smaller contour: '+JSON.stringify({actual:guarded.rect,expected,angle:guarded.angle}));
    guarded.rotated.delete();
    image.setTo(new cv.Scalar(255,255,255,255)); box([600,4000,3600,1600]);
    let rejected=false;
    try {const result=e.rotation(cv,image,{referenceRect:expected}); result.rotated.delete();}
    catch(error){rejected=/does not match the first page/.test(String(error));}
    check(rejected,'same-sized contour in wrong location must stop registration');
    image.delete();
    const checked=[];
    for(const name of ['IGSample','IBSample']) {
      const {pages,params}=await setup(name);
      for(const [index,p] of pages.entries()) {
        const lease=await getExamPage(p),mat=await e.renderScanMat(cv,lease.url); lease.release();
        const actual=e.rotation(cv,mat,{...lease.alignment,referenceRect:params.rect});
        check(matches(actual.rect,params.rect,mat.cols,mat.rows),`${name}/${index+1}`);
        actual.rotated.delete();
        if(index===0) {
          const small=new cv.Mat(); cv.resize(mat,small,new cv.Size(Math.round(mat.cols/2),Math.round(mat.rows/2)),0,0,cv.INTER_AREA);
          const native=e.rotation(cv,small,{sourceScale:.5,referenceRect:params.rect}); native.rotated.delete();small.delete();
        }
        mat.delete();
      }
      checked.push({name,pages:pages.length});
      console.log('alignment: '+JSON.stringify(checked.at(-1)));
      releaseUnusedSources(pages,[]);
    }
    return {checked,rejected,syntheticDistractor:true};
  });
  assert.equal(report.rejected,true); console.log(report);
} finally {await browser.close();await server.close();}
