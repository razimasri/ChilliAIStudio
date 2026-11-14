import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({optimizeDeps:{include:['pdf-lib']},server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
 const page=await browser.newPage();page.on('console',m=>{if(m.text().startsWith('native:'))console.log(m.text());});
 await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/worker.html');
 const batchOnly=process.env.NATIVE_BATCH_ONLY==='1',mixed=process.env.NATIVE_MIXED==='1',focus=process.env.NATIVE_MIXED_FOCUS==='1';
 const report=await page.evaluate(async ({batchOnly,mixed,focus})=>{
  const {PDFDocument}=await import('/tests/helpers/pdfInspection.ts');
  const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
  const {scanProfile}=await import('/src/utils/pdfScanProfile.ts');
  const {getExamPage,getMarkingPage,warmExamPage,loadExamFile,releaseUnusedSources}=await import('/src/utils/pdfProcessor.ts');
  const {getCV}=await import('/src/utils/cvLoader.ts');const e=await import('/src/utils/omrEngine.ts');
  const {setup}=await import('/tests/helpers/sampleCalibration.ts');const {MarkingClient}=await import('/src/utils/markingClient.ts');const {releaseResultImages}=await import('/src/utils/imageStore.ts');
  const cv=await getCV(),client=new MarkingClient(),checks=[];
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};
  for(const [sample,dpi,indices]of (batchOnly?[['IGSample',300,[0]]]:mixed?[['IGSample',300,focus?[0,12]:[0,1,12]]]:[['IGSample',300,[0,1,12]],['IBSample',400,[0,6]]])){
   const source=await pdfjs.getDocument({data:await(await fetch('/samples/'+sample+'.pdf')).arrayBuffer()}).promise;
   const out=await PDFDocument.create();
   for(const index of indices){const p=await source.getPage(index+1),v=p.getViewport({scale:(mixed&&index===indices[0]?600:dpi)/72}),c=document.createElement('canvas');c.width=Math.ceil(v.width-1e-7);c.height=Math.ceil(v.height-1e-7);await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
    const png=await new Promise(resolve=>c.toBlob(resolve));const image=await out.embedPng(await png.arrayBuffer()),physical=p.getViewport({scale:1});out.addPage([physical.width,physical.height]).drawImage(image,{x:0,y:0,width:physical.width,height:physical.height});await out.flush();c.width=c.height=0;p.cleanup();}
   await source.destroy();const file=new File([await out.save()],'native-test.pdf',{type:'application/pdf'});
   const {pages,params}=await setup(sample,file);const pdf=await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
   await warmExamPage(pages[0]); // The compressed cache must carry alignment metadata.
   for(let index=0;index<pages.length;index++){
    if(focus&&index===0)continue;
    const actualDpi=mixed&&index===0?600:dpi;
    const p=await pdf.getPage(index+1),profile=await scanProfile(p);check(profile.renderDpi===actualDpi,`Expected ${dpi} DPI, got ${JSON.stringify(profile)}`);
    const v=p.getViewport({scale:600/72}),c=document.createElement('canvas');c.width=Math.ceil(v.width-1e-7);c.height=Math.ceil(v.height-1e-7);await p.render({canvasContext:c.getContext('2d'),viewport:v}).promise;
    const bitmap=await createImageBitmap(c);c.width=c.height=0;const baseline=await e.processStudentScan(cv,bitmap,'Check',index,params);
    const raster=await getMarkingPage(pages[index]);check((raster.alignment?.sourceScale??1)===actualDpi/600,'Native render must retain alignment scale');check(raster.bitmap.width===Math.ceil(p.getViewport({scale:actualDpi/72}).width-1e-7),'Raster should remain native-sized');
    const candidate=await client.mark(raster.bitmap,'Check',index,params,()=>{},undefined,raster.alignment);raster.release();
    const state=s=>JSON.stringify({responses:s.responses,review:s.incomplete.map(q=>({n:q.number,reason:q.reviewReason})),score:s.score,total:s.total});
    const borderCase=mixed&&sample==='IGSample'&&indices[index]===12;
    if(borderCase){
      // Visually verified original: D is filled; C is empty with a damaged border.
      // The 600-DPI preparation counts the C border in its sampling rectangle.
      check(candidate.responses[2]==='D'&&!candidate.questions[2].boxes.find(b=>b.letter==='C').bool,'Damaged C border must not override the filled D');
      const expected={...baseline,responses:[...baseline.responses],incomplete:baseline.incomplete.filter(q=>q.number!==2)};
      expected.responses[2]='D';
      const {calculateScore}=await import('/src/utils/grading.ts');expected.score=calculateScore(expected.responses,params.key);
      check(state(candidate)===state(expected),'Only the validated Q3 border case may differ');
    }else check(state(candidate)===state(baseline),`${sample} source page ${indices[index]+1}: results changed`);
    if(sample==='IGSample' && index===0){
      const {markBatch}=await import('/src/utils/markingBatch.ts');
      const batch=await markBatch([pages[0]],['Check'],params,new AbortController().signal,()=>{},1);
      check(state(batch[0])===state(baseline),'Batch must propagate native alignment metadata');releaseResultImages(batch);
    }
    const image=await createImageBitmap(await(await fetch(candidate.annotatedDataUrl)).blob());check(image.width===4800&&image.height===6840,'Annotations must retain canonical dimensions');image.close();
    checks.push({sample,page:indices[index]+1,dpi:actualDpi,sameAnswers:!borderCase,validatedBorderCase:borderCase});console.log('native: '+JSON.stringify(checks.at(-1)));releaseResultImages([baseline,candidate]);p.cleanup();
   }
   // Manual orientation must keep the source scale, including cached URL rasters.
   const turned={...pages[0],rotation:90};const url=await getExamPage(turned);url.release();const raster=await getMarkingPage(turned);check((raster.alignment?.sourceScale??1)===(mixed?1:dpi/600),'Rotation/cache lost source scale');raster.release();
   await pdf.destroy();releaseUnusedSources(pages,[]);
  }
  client.dispose();return checks;
 },{batchOnly,mixed,focus});assert.equal(report.length,batchOnly||focus?1:mixed?3:5);console.log('Native raster/cache/orientation and real marking-worker validation passed.');
}finally{await browser.close();await server.close();}
