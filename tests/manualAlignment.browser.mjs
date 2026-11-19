import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:1300,height:950}});
  page.on('console',m=>{if(m.text().startsWith('manual:'))console.log(m.text());});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/manualAlignment.html');
  await page.waitForFunction(()=>window.showManual);
  if (!process.env.MANUAL_UI_ONLY) {
  const report=await page.evaluate(async()=>{
    const {getCV}=await import('/src/utils/cvLoader.ts');
    const e=await import('/src/utils/omrEngine.ts');
    const {setup}=await import('/tests/helpers/sampleCalibration.ts');
    const {getExamPage,loadExamFile,releaseUnusedSources}=await import('/src/utils/pdfProcessor.ts');
    const {CalibrationClient}=await import('/src/utils/calibrationClient.ts');
    const {MarkingClient}=await import('/src/utils/markingClient.ts');
    const {markBatch}=await import('/src/utils/markingBatch.ts');
    const {AlignmentError}=await import('/src/utils/manualAlignment.ts');
    const {releaseResultImages}=await import('/src/utils/imageStore.ts');
    const {drawMat}=await import('/src/utils/rasterIO.ts');
    const check=(v,m)=>{if(!v)throw Error(m);};
    const cv=await getCV(),{pages,params}=await setup('IBSample');
    const lease=await getExamPage(pages[0]);
    const source=await e.renderToCanonicalMat(cv,lease.url);lease.release();
    const baselineUrl=URL.createObjectURL(await new Promise(resolve=>{const c=document.createElement('canvas');drawMat(cv,c,source);c.toBlob(resolve);}));
    const baseline=await e.processStudentScan(cv,baselineUrl,'Baseline',0,params);URL.revokeObjectURL(baselineUrl);
    const aligned=e.rotation(cv,source);source.delete();
    const clean=new cv.Mat(6840,4800,cv.CV_8UC4,new cv.Scalar(255,255,255,255));
    const bounds=new cv.Rect(params.x1,params.y1,params.x2-params.x1,params.y2-params.y1);
    const from=aligned.rotated.roi(bounds),to=clean.roi(bounds);from.copyTo(to);from.delete();to.delete();aligned.rotated.delete();
    let noContour=false;try{const c=e.largest_cnt(cv,clean);c.delete();}catch(error){noContour=error instanceof AlignmentError;}
    check(noContour,'fixture must have no large alignment contour');
    const c=document.createElement('canvas');drawMat(cv,c,clean);clean.delete();
    const blob=await new Promise(resolve=>c.toBlob(resolve));c.width=c.height=0;
    const controller=new AbortController(),calibration=new CalibrationClient();
    const prepared=await calibration.prepare(blob,controller.signal,()=>{},'page');calibration.dispose();
    check(JSON.stringify(prepared.rect)==='[0,0,4800,6840]','page-boundary calibration');
    const pageParams={...params,rect:prepared.rect,alignmentMode:'page',alignmentReferencePreview:prepared.thumbnail};
    const client=new MarkingClient();
    const direct=await client.mark(blob,'Page bounds',0,pageParams,()=>{});client.dispose();
    check(JSON.stringify(direct.responses)===JSON.stringify(baseline.responses),'no-contour page mode changed answers');
    check(direct.score===baseline.score,'no-contour page mode changed score');
    const files=await loadExamFile(new File([blob],'no-contour.png',{type:'image/png'}));
    let requested=0;
    const recovered=await markBatch(files,['Manual'],{...pageParams,alignmentMode:'contour'},controller.signal,()=>{},1,undefined,async(request,signal)=>{
      requested++;check(request.index===0&&!signal.aborted,'recovery metadata');
      return {angle:0,rect:[0,0,4800,6840]};
    });
    check(requested===1,'alignment failure must request manual recovery once');
    check(JSON.stringify(recovered[0].responses)===JSON.stringify(baseline.responses),'manual worker retry changed answers');
    const cancel=new AbortController();let cancelled=false;
    try{await markBatch(files,['Cancel'],{...pageParams,alignmentMode:'contour'},cancel.signal,()=>{},1,undefined,async()=>{cancel.abort();throw new DOMException('Cancelled','AbortError');});}
    catch(error){cancelled=error.name==='AbortError';}
    check(cancelled,'waiting recovery must cancel');
    window.manualFixture={file:files[0],params:pageParams};
    window.showManual(files[0],pageParams);
    releaseResultImages([baseline,direct,...recovered]);releaseUnusedSources(pages,[]);
    return {noContour,requested,cancelled,score:direct.score,answers:direct.responses.length};
  });
  assert.equal(report.requested,1);console.log('manual: '+JSON.stringify(report));
  } else {
    await page.evaluate(async()=>{
      const {loadExamFile}=await import('/src/utils/pdfProcessor.ts');
      const c=document.createElement('canvas');c.width=1200;c.height=1710;
      const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1200,1710);
      for(let y=600;y<1400;y+=80)for(let x=100;x<1000;x+=180)ctx.strokeRect(x,y,65,55);
      const blob=await new Promise(r=>c.toBlob(r)),files=await loadExamFile(new File([blob],'ui.png',{type:'image/png'}));
      const params={rect:[0,0,4800,6840],x1:200,y1:2000,x2:4400,y2:6000,w:100,h:100,outer:[],inner:[],key:{0:'A'},names:[],fill_limit:10,font_size:1,text_shift:[0,0],alignmentMode:'page',alignmentReferencePreview:blob};
      window.manualFixture={file:files[0],params};window.showManual(files[0],params);
    });
  }

  await page.waitForFunction(()=>document.querySelector('canvas[aria-label="Draw manual alignment rectangle"]')?.width===600);
  const confirm=page.getByRole('button',{name:'Use alignment and continue'});
  assert.equal(await confirm.isDisabled(),true);
  await page.getByRole('button',{name:'Use full image'}).click();
  await page.getByRole('button',{name:'Show first-page reference'}).click();
  await page.getByLabel('First-page alignment reference').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Draw',exact:true}).click();
  const box=await page.getByLabel('Draw manual alignment rectangle').boundingBox();
  await page.mouse.move(box.x+30,box.y+50);await page.mouse.down();await page.mouse.move(box.x+250,box.y+300,{steps:8});await page.mouse.up();
  assert.equal(await confirm.isEnabled(),true);await confirm.click();
  assert.ok((await page.evaluate(()=>window.confirmed.rect))[2]>50);
  const mobile=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  await mobile.goto(server.resolvedUrls.local[0]+'tests/fixtures/manualAlignment.html');
  await mobile.waitForFunction(()=>window.showManual);
  await mobile.evaluate(async()=>{
    const {loadExamFile}=await import('/src/utils/pdfProcessor.ts');
    const c=document.createElement('canvas');c.width=1200;c.height=1710;const ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
    const blob=await new Promise(r=>c.toBlob(r)),files=await loadExamFile(new File([blob],'touch.png',{type:'image/png'}));
    window.showManual(files[0],{rect:[0,0,4800,6840],x1:200,y1:200,x2:2000,y2:5000,alignmentMode:'page'});
  });
  await mobile.waitForFunction(()=>document.querySelector('canvas[aria-label="Draw manual alignment rectangle"]')?.width===600);
  const touch=await mobile.getByLabel('Draw manual alignment rectangle').boundingBox();
  const session=await mobile.context().newCDPSession(mobile);
  for(const [type,x,y]of [['touchStart',touch.x+25,touch.y+30],['touchMove',touch.x+200,touch.y+200],['touchEnd',0,0]])
    await session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
  assert.equal(await mobile.getByRole('button',{name:'Use alignment and continue'}).isEnabled(),true);
  await mobile.getByRole('button',{name:'Use alignment and continue'}).click();
  assert.ok(await mobile.evaluate(()=>window.confirmed.rect[2]>50));await mobile.close();
  await page.evaluate(()=>window.showCalibration(window.manualFixture.file,{...window.manualFixture.params,alignmentMode:'contour'}));
  await page.getByRole('alert').waitFor({timeout:120000});
  await page.getByLabel('Alignment reference',{exact:true}).selectOption('page');
  await page.waitForFunction(()=>window.calibrationParams.alignmentMode==='page'&&window.calibrationParams.rect[2]===4800&&window.calibrationParams.templateDataUrl,null,{timeout:120000});
  await page.getByLabel('Alignment settings',{exact:true}).click();
  await page.getByText('Use full, upright pages with similar framing.',{exact:false}).waitFor();
  assert.equal(await page.getByRole('alert').count(),0);
  console.log('Manual retry, no-contour calibration, cancellation, mouse and touchscreen selection passed.');
}finally{await browser.close();await server.close();}
