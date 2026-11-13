import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  const page=await browser.newPage();
  page.on('console',message=>{if(message.text().startsWith('speed:'))console.log(message.text());});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/worker.html');
  const rounds=Number(process.env.MARKING_SPEED_ROUNDS || 3);
  const report=await page.evaluate(async({rounds})=>{
    const {setup}=await import('/tests/helpers/sampleCalibration.ts');
    const {getCV}=await import('/tests/helpers/cvRuntimes.ts');
    const engine=await import('/src/utils/omrEngine.ts');
    const {getMarkingPage}=await import('/src/utils/pdfProcessor.ts');
    const {releaseAllImages}=await import('/src/utils/imageStore.ts');
    const scalar=await getCV('scalar'),simd=await getCV('simd'),results=[];
    for(const [sample,index] of [['IGSample',1],['IBSample',6]]){
      const {pages,params}=await setup(sample,undefined,'scalar');
      let expected;
      const modes=['scalar-rgba','simd-rgba','simd-mono'];
      for(let round=-1;round<rounds;round++) {
      const order=round<0?modes.slice(0,2):[...modes.slice(round%3),...modes.slice(0,round%3)];
      for(const mode of order){
        const lease=await getMarkingPage(pages[index]);
        const phases=[];let previous='start',at=performance.now();
        const started=performance.now();
        const result=await engine.processStudentScan(mode==='scalar-rgba'?scalar:simd,lease.bitmap,'Speed test',index,params,message=>{
          phases.push({phase:previous,ms:performance.now()-at});previous=message;at=performance.now();
        },undefined,{singleChannel:mode==='simd-mono'});
        const ms=performance.now()-started;phases.push({phase:previous,ms:performance.now()-at});lease.release();
        const state=JSON.stringify({questions:result.questions,responses:result.responses,incomplete:result.incomplete,score:result.score});
        if(expected&&state!==expected)throw Error(`${sample}: full marking result changed`);
        expected=state;
        const entry={sample,page:index+1,mode,round,ms,phases,score:result.score,ambiguities:result.incomplete.length};
        if(round>=0)results.push(entry);console.log('speed: '+JSON.stringify(entry));releaseAllImages();
      }
    }
      }
    return {hardware:{cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory},results};
  },{rounds});
  assert.equal(report.results.length,6*rounds);
  if(process.env.MARKING_SPEED_REPORT)await writeFile(process.env.MARKING_SPEED_REPORT,JSON.stringify(report,null,2));
  console.log('Full per-page marking, including image loading, annotation/export or clean review images/crops, completed with identical marking state. PDF raster preparation excluded.');
}finally{await browser.close();await server.close();}
