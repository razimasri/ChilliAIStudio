import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build, createServer, preview } from 'vite';
let server;
if (process.env.BATCH_TEST_DEV) {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } }); await server.listen();
} else {
  const outDir='work/batch-camera-dist';
  await build({ build: { outDir } });
  server=await preview({ build: { outDir }, preview: { host:'127.0.0.1',port:0 } });
}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  page.on('pageerror',error=>console.log('batch page error: '+error.message));
  await page.addInitScript(()=>{
    window.mediaCalls=0;window.scanTracks=[];window.scanWorkers=new Set();window.permissionFailure=false;
    const NativeWorker=Worker;
    window.Worker=class extends NativeWorker {
      constructor(...args){super(...args);window.scanWorkers.add(this);}
      terminate(){window.scanWorkers.delete(this);super.terminate();}
    };
    navigator.mediaDevices.getUserMedia=async()=>{
      window.mediaCalls++;
      if(window.permissionFailure)throw new DOMException('Denied','NotAllowedError');
      const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=3400;
      const context=canvas.getContext('2d');
      window.setSheet=(number,blank=false)=>{
        context.fillStyle='#253540';context.fillRect(0,0,2400,3400);
        if(!blank){
          context.fillStyle='white';context.fillRect(200,200,2000,3000);
          context.fillStyle=`rgb(${(number*37)%200},${(number*71)%200},${(number*113)%200})`;context.fillRect(350,350,1700,250);
          context.fillStyle='black';context.font='80px sans-serif';context.fillText(`Sheet ${number}`,400,750);
          context.lineWidth=6;
          for(let y=1000;y<2900;y+=90)for(let x=450;x<1900;x+=150)context.strokeRect(x,y,100,65);
        }
        window.currentScanTrack?.requestFrame();
      };
      window.setSheet(1);
      const stream=canvas.captureStream(0);window.currentScanTrack=stream.getVideoTracks()[0];
      window.scanTracks.push(...stream.getTracks());
      setTimeout(()=>window.currentScanTrack?.requestFrame(),100);
      if(window.delayCameraPermission)await new Promise(resolve=>setTimeout(resolve,300));
      return stream;
    };
    // Exercise the video-frame fallback used by iOS; real camera capture is device-tested separately.
    Object.defineProperty(window,'ImageCapture',{value:undefined});
  });
  await page.goto(server.resolvedUrls.local[0]);
  assert.match(await page.title(),/v2\.5 Birdseye/);
  await page.getByRole('button',{name:'Batch Scan',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await dialog.waitFor();
  const capture=dialog.getByRole('button',{name:'Capture',exact:true});
  const waitEnabled=async button=>page.waitForFunction(el=>!el.disabled,await button.elementHandle(),{timeout:120000});
  await waitEnabled(capture);console.log('batch: camera ready');
  const initialCalls=await page.evaluate(()=>window.mediaCalls);
  const setSheet=async(number,blank=false)=>{
    await page.evaluate(({number,blank})=>new Promise((resolve,reject)=>{
      const video=document.querySelector('video');
      const timer=setTimeout(()=>reject(new Error('Camera did not present the requested test frame')),5000);
      if(video.requestVideoFrameCallback)video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});
      else setTimeout(()=>{clearTimeout(timer);resolve();},100);
      window.setSheet(number,blank);
    }),{number,blank});
  };
  const take=async(number,expected)=>{
    await setSheet(number);await waitEnabled(capture);await capture.click();
    assert.equal(await dialog.getByRole('button',{name:'Finish Scanning',exact:true}).isDisabled(),true,'incomplete capture can be finished');
    await page.waitForFunction(expected=>{const dialog=document.querySelector('[role="dialog"]');const error=dialog?.querySelector('[role="alert"]');if(error)throw new Error(error.textContent);return dialog?.textContent.includes(`${expected} ${expected===1?'sheet':'sheets'} captured`);},expected,{timeout:120000});
    await waitEnabled(capture);
  };
  const count=Number(process.env.BATCH_TEST_COUNT || 30);
  for(let i=1;i<=count;i++){
    await take(i,i);
    if(i%5===0)console.log(`batch: ${i} real corrected captures`);
  }
  assert.equal(await page.evaluate(()=>window.mediaCalls),initialCalls,'camera reopened between captures');
  assert.equal(await page.evaluate(()=>window.scanWorkers.size),1,'one scanner worker should serve the entire batch');
  assert.equal(await page.getByRole('heading',{name:/Select question area/}).count(),0,'scanning must not calibrate');
  // A failed capture and failed last-sheet retake must preserve previous pages.
  await setSheet(100,true);await capture.click();
  await dialog.getByRole('alert').waitFor({timeout:120000});await waitEnabled(capture);
  await dialog.getByText(`${count} sheets captured`,{exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Retake Last Scan',exact:true}).click();
  const replacement=dialog.getByRole('button',{name:'Capture replacement',exact:true});
  await replacement.click();await dialog.getByRole('alert').waitFor();await waitEnabled(replacement);
  assert.equal(await dialog.getByText(`${count} sheets captured`,{exact:true}).count(),1);
  await setSheet(101);await replacement.click();await waitEnabled(capture);
  await dialog.getByRole('button',{name:'Finish Scanning',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Review scanned sheets',exact:true});await dialog.waitFor();
  await page.waitForFunction(()=>window.scanTracks.every(track=>track.readyState==='ended'));
  assert.equal(await page.evaluate(()=>window.scanWorkers.size),0,'scanner worker retained during review');
  assert.equal(await dialog.getByRole('article').count(),count);
  const colors=async()=>dialog.getByRole('article').evaluateAll(async cards=>{
    const output=[];
    for(const card of cards){
      const image=card.querySelector('img');image.loading='eager';await image.decode();
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
      const context=canvas.getContext('2d');context.drawImage(image,0,0);
      const pixel=context.getImageData(Math.round(canvas.width*.5),Math.round(canvas.height*.1),1,1).data;
      output.push(Array.from(pixel).slice(0,3));canvas.width=canvas.height=0;
    }return output;
  });
  const originalColors=await colors();
  for(let i=0;i<count;i++) {
    const number=i===count-1?101:i+1;
    const expected=[number*37%200,number*71%200,number*113%200];
    assert.ok(originalColors[i].every((value,c)=>Math.abs(value-expected[c])<8),`capture order changed at sheet ${i+1}: ${originalColors[i]} vs ${expected}`);
  }
  assert.notDeepEqual(originalColors[0],originalColors.at(-1),'retake did not replace last thumbnail');
  // Individual retake preserves its slot; no naming/answer-key step is involved.
  await dialog.getByRole('article',{name:'Scanned sheet 2',exact:true}).getByRole('button',{name:'Retake',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await dialog.waitFor();
  await setSheet(102);await waitEnabled(replacement);await replacement.click();await waitEnabled(capture);
  await dialog.getByRole('button',{name:'Retake Last Scan',exact:true}).click();
  await dialog.getByText(/Next capture replaces sheet 2/).waitFor();
  await dialog.getByRole('button',{name:'Keep previous scan',exact:true}).click();
  await dialog.getByRole('button',{name:'Finish Scanning',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Review scanned sheets',exact:true});await dialog.waitFor();
  const retakenColors=await colors();
  assert.deepEqual(retakenColors[0],originalColors[0]);assert.notDeepEqual(retakenColors[1],originalColors[1]);
  assert.deepEqual(retakenColors.slice(2),originalColors.slice(2));
  await dialog.getByRole('article',{name:'Scanned sheet 3',exact:true}).getByRole('button',{name:'Remove',exact:true}).click();
  assert.equal(await dialog.getByRole('article').count(),count-1);
  const afterRemoval=await colors();assert.deepEqual(afterRemoval,[...retakenColors.slice(0,2),...retakenColors.slice(3)]);
  await dialog.getByRole('button',{name:'Add more sheets',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await dialog.waitFor();
  await waitEnabled(capture);await take(103,count);
  await dialog.getByRole('button',{name:'Finish Scanning',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Review scanned sheets',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Confirm batch',exact:true}).click();
  await dialog.waitFor({state:'detached',timeout:180000});
  await page.getByRole('heading',{name:`Loaded pages (${count})`,exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Continue to calibration',exact:true}).isDisabled(),true,'batch acquisition must not require an answer key');
  assert.equal(await page.evaluate(()=>window.scanWorkers.size),0);
  assert.equal(await page.evaluate(()=>window.scanTracks.every(track=>track.readyState==='ended')),true);
  // Permission failure keeps the existing imported exam intact; retry is possible.
  await page.evaluate(()=>window.permissionFailure=true);
  await page.getByRole('button',{name:'Batch Scan',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await dialog.getByRole('alert').waitFor();
  assert.match(await dialog.getByRole('alert').innerText(),/Camera access was not allowed/);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.getByRole('heading',{name:`Loaded pages (${count})`,exact:true}).waitFor();
  // Cancel while a correction is running: no partial import.
  await page.evaluate(()=>window.permissionFailure=false);
  await page.getByRole('button',{name:'Batch Scan',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await waitEnabled(capture);await capture.click();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>window.scanTracks.every(track=>track.readyState==='ended')),true);
  assert.equal(await page.evaluate(()=>window.scanWorkers.size),0);
  // A permission result arriving after cancellation must release its new tracks.
  await page.evaluate(()=>window.delayCameraPermission=true);
  await page.getByRole('button',{name:'Batch Scan',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>window.scanTracks.every(track=>track.readyState==='ended')),true,'late permission result leaked camera');
  console.log(`Batch camera: ${count} independent CV corrections, one continuous stream, failure preservation, retakes, deletion/order, atomic import, permissions and cancellation passed.`);
} finally {await browser.close();await server.close();}
