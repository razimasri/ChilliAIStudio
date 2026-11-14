import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
assert.deepEqual(JSON.parse(await readFile('metadata.json','utf8')).requestFramePermissions,[]);
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  for (const viewport of [{width:1440,height:900},{width:390,height:844}]) {
    const page=await browser.newPage({viewport});
    await page.addInitScript(()=>{
      window.cameraRequests=0;
      navigator.mediaDevices.getUserMedia=async()=>{window.cameraRequests++;throw new DOMException('Test permission denied','NotAllowedError');};
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('button',{name:'Batch Scan',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.cameraRequests),0,'Loading must not request camera access');
    await page.getByRole('button',{name:'Batch Scan',exact:true}).click();
    await page.waitForFunction(()=>window.cameraRequests>0);
    await page.getByText('Camera access was not allowed.',{exact:false}).waitFor();
    await page.close();
  }
  console.log('Desktop and mobile: no camera request on load; clicking Batch Scan requests access and handles denial. No Studio startup camera request.');
} finally {await browser.close();await server.close();}
