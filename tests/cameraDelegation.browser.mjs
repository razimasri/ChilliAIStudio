import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const metadata=JSON.parse(await readFile('metadata.json','utf8'));
assert.ok(metadata.requestFramePermissions.includes('camera'),'Studio needs camera capability declared');
let appUrl;
const server=await createServer({plugins:[{name:'camera-embedding-test',configureServer(server){
  server.middlewares.use('/__camera-host',(req,res)=>{
    const allow=req.url.includes('denied') ? "camera 'none'" : metadata.requestFramePermissions.join('; ');
    res.setHeader('Content-Type','text/html');
    res.end(`<iframe title="Embedded app" src="${appUrl}" allow="${allow}" style="width:100%;height:100vh"></iframe>`);
  });
}}],server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
appUrl=server.resolvedUrls.local[0];
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});
try {
  const app=server.resolvedUrls.local[0],host=app.replace('127.0.0.1','localhost');
  for(const delegated of [true,false]){
    const page=await browser.newPage();
    await page.addInitScript(()=>{
      window.cameraRequests=0;
      if(!navigator.mediaDevices) return;
      const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia=(constraints)=>{window.cameraRequests++;return original(constraints);};
    });
    await page.goto(host+'__camera-host'+(delegated?'':'?denied'));
    const frame=page.frameLocator('iframe');
    await frame.getByRole('button',{name:'Batch Scan',exact:true}).waitFor({timeout:15000}).catch(async error=>{console.log(await Promise.all(page.frames().map(async f=>({url:f.url(),text:await f.locator('body').innerText().catch(()=>'?')}))));throw error;});
    const appFrame=page.frames().find(f=>f.url()===app);
    assert.equal(await appFrame.evaluate(()=>window.cameraRequests),0,'No stream request before click');
    await frame.getByRole('button',{name:'Batch Scan',exact:true}).click();
    if(delegated){
      await frame.getByRole('button',{name:'Capture',exact:true}).waitFor();
      await appFrame.waitForFunction(()=>{const v=document.querySelector('video');return v?.srcObject?.getVideoTracks().some(t=>t.readyState==='live')&&v.readyState>=2;});
      assert.equal(await frame.getByRole('button',{name:'Capture',exact:true}).isEnabled(),true);
    }else{
      await frame.getByText('Camera access was not allowed.',{exact:false}).waitFor();
    }
    await page.close();
  }
  console.log('Real Chromium getUserMedia: delegated cross-origin iframe streams after click; denied iframe cannot prompt or stream. Metadata declares camera.');
}finally{await browser.close();await server.close();}
