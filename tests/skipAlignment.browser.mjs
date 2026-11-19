import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:1300,height:950}});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/manualAlignment.html');await page.waitForFunction(()=>window.showManual);
  const report=await page.evaluate(async()=>{
    const {getCV}=await import('/src/utils/cvLoader.ts');
    const e=await import('/src/utils/omrEngine.ts');
    const {setup}=await import('/tests/helpers/sampleCalibration.ts');
    const {getExamPage,loadExamFile,releaseUnusedSources}=await import('/src/utils/pdfProcessor.ts');
    const {CalibrationClient}=await import('/src/utils/calibrationClient.ts');
    const {MarkingClient}=await import('/src/utils/markingClient.ts');
    const {markBatch}=await import('/src/utils/markingBatch.ts');
    const {drawMat}=await import('/src/utils/rasterIO.ts');
    const {releaseResultImages}=await import('/src/utils/imageStore.ts');
    const check=(v,m)=>{if(!v)throw Error(m);};
    const cv=await getCV(),{pages,params}=await setup('IBSample');
    const lease=await getExamPage(pages[0]),raw=await e.renderToCanonicalMat(cv,lease.url);lease.release();
    const first=e.rotation(cv,raw);raw.delete();
    const c=document.createElement('canvas');drawMat(cv,c,first.rotated);first.rotated.delete();
    const blob=await new Promise(r=>c.toBlob(r));c.width=c.height=0;
    const url=URL.createObjectURL(blob),baseline=await e.processStudentScan(cv,url,'Baseline',0,params);URL.revokeObjectURL(url);
    const controller=new AbortController(),calibration=new CalibrationClient();
    const prepared=await calibration.prepare(blob,controller.signal,()=>{},'skip');calibration.dispose();
    check(prepared.angle===0&&JSON.stringify(prepared.rect)==='[0,0,4800,6840]','skip calibration must retain page placement');
    // Wrong reference deliberately verifies that skipping does not map page bounds onto it.
    const wrong={...params,rect:[50,50,100,100]};
    const client=new MarkingClient();
    const skipped=await client.mark(blob,'Skipped',0,{...wrong,alignmentMode:'skip'},()=>{});client.dispose();
    check(JSON.stringify(skipped.responses)===JSON.stringify(baseline.responses),'global skip must retain all answers');
    const files=await loadExamFile(new File([blob],'skip.png',{type:'image/png'}));
    let requested=0;
    const recovered=await markBatch(files,['Per page'],wrong,controller.signal,()=>{},1,undefined,async()=>{
      requested++;return {skip:true,angle:12,rect:[1000,1000,100,100]};
    });
    check(requested===1,'failed contour must request recovery');
    check(JSON.stringify(recovered[0].responses)===JSON.stringify(baseline.responses),'per-page skip must ignore manual angle and reference mapping');
    check(skipped.score===baseline.score&&recovered[0].score===baseline.score,'skip scores changed');
    window.showManual(files[0],wrong);
    releaseResultImages([baseline,skipped,...recovered]);releaseUnusedSources(pages,[]);
    return {answers:skipped.responses.length,score:skipped.score,requested};
  });
  assert.equal(report.requested,1);
  await page.waitForFunction(()=>document.querySelector('canvas')?.width===600);
  assert.equal(await page.getByRole('button',{name:'Use alignment and continue'}).isDisabled(),true);
  await page.getByRole('button',{name:'Skip alignment',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.confirmed),{skip:true,angle:0,rect:[0,0,4800,6840]});
  console.log('Skip calibration, global marking, per-page recovery and skip button passed: '+JSON.stringify(report));
}finally{await browser.close();await server.close();}
