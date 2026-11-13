import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer,build,preview} from 'vite';
const production=process.env.CV_RUNTIME_BUILD==='1';
let server;
if(production){
  const outDir='work/cv-runtime-dist';
  await build({build:{outDir,rollupOptions:{input:'tests/fixtures/cvRuntime.html'}}});
  server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0}});
}else{server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
  for(const scenario of ['simd','unsupported','blocked-wasm']){
    const context=await browser.newContext();
    if(scenario==='unsupported')await context.addInitScript(()=>{WebAssembly.validate=()=>false;});
    if(scenario==='blocked-wasm')await context.route('**/opencv-simd/*.wasm',route=>route.abort());
    const page=await context.newPage();
    await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/cvRuntime.html');
    await page.waitForFunction(()=>window.runtimeFixture);
    const result=await page.evaluate(async()=>{
      const fixture=window.runtimeFixture;
      let cv;
      try {cv=await fixture.getCV();}
      catch(error) {return {error:error instanceof Error?error.message:String(error)};}
      if(cv!==await fixture.getCV())throw Error('Runtime was not reused');
      const required=['Mat','MatVector','matFromImageData','imshow','exceptionFromPtr','warpAffine','warpPerspective','getPerspectiveTransform','medianBlur','adaptiveThreshold','findContours','morphologyEx','meanStdDev','Canny','Laplacian','putText'];
      for(const name of required)if(typeof cv[name]!=='function')throw Error('Missing API '+name);
      const worker=fixture.worker();
      try{
        const workerResult=await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(Error(e.message));worker.postMessage({});});
        return {info:fixture.getCVRuntimeInfo(cv),supported:fixture.supportsWasmSimd(),worker:workerResult};
      }finally{worker.terminate();}
    });
    if(scenario==='simd'){
      assert.equal(result.info.runtime,'simd');
      assert.equal(result.worker.info.runtime,'simd');
      assert.equal(result.worker.count,256);
      assert.deepEqual(result.worker.rounded,[0,2,2,4,4,6,6,8,128,130,130,132,252,254,254,255]);
    }else{
      assert.ok(result.error,'Unsupported or blocked SIMD must fail explicitly');
      assert.equal(result.info,undefined,'No silent scalar fallback');
      if(scenario==='unsupported')assert.match(result.error,/SIMD/i);
    }
    console.log('OpenCV runtime:',scenario,JSON.stringify(result));
    await context.close();
  }
}finally{await browser.close();await server.close();}
