import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer, build, preview } from 'vite';
let server;
if(process.env.AUTO_TEST_DEV){server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();}
else{const outDir='work/auto-camera-dist';await build({build:{outDir}});server=await preview({build:{outDir},preview:{host:'127.0.0.1',port:0}});}
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
let page;
try{
 page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
 page.on('pageerror',error=>console.log('auto page error: '+error.message));
 await page.addInitScript(()=>{
  window.mediaCalls=0;window.autoTracks=[];window.autoWorkers=new Set();window.inspectCount=0;window.captureCount=0;
  const NativeWorker=Worker;
  window.Worker=class extends NativeWorker{
   constructor(...args){super(...args);window.autoWorkers.add(this);}
   postMessage(request,...args){if(request.type==='inspect')window.inspectCount++;if(request.type==='capture')window.captureCount++;return super.postMessage(request,...args);}
   terminate(){window.autoWorkers.delete(this);super.terminate();}
  };
  navigator.mediaDevices.getUserMedia=async()=>{
   window.mediaCalls++;
   const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=3400;
   const context=canvas.getContext('2d');
   window.scene=(number=0,kind='page',shift=0)=>{
    context.fillStyle='#253540';context.fillRect(0,0,2400,3400);
    context.save();
    if(kind==='partial')context.translate(0,-500);
    if(number){
     const x=200+shift;
     context.fillStyle='white';context.fillRect(x,200,2000,3000);
     context.fillStyle=`rgb(${number*37%200},${number*71%200},${number*113%200})`;context.fillRect(x+150,350,1700,250);
     context.fillStyle='black';context.font='80px sans-serif';context.fillText(`Sheet ${number}`,x+200,750);
     context.lineWidth=6;
     for(let y=1000;y<2900;y+=90)for(let bx=x+250;bx<x+1700;bx+=150)context.strokeRect(bx,y,100,65);
     if(kind==='covered'){context.fillStyle='#b28262';context.fillRect(x,800,1250,1300);}
     if(kind==='blurred'){
      const scratch=document.createElement('canvas');scratch.width=2400;scratch.height=3400;scratch.getContext('2d').drawImage(canvas,0,0);
      context.filter='blur(25px)';context.drawImage(scratch,0,0);context.filter='none';scratch.width=scratch.height=0;
     }
    }
    context.restore();
    window.autoTrack?.requestFrame();
   };
   window.scene(0);
   const stream=canvas.captureStream(0);window.autoTrack=stream.getVideoTracks()[0];window.autoTracks.push(...stream.getTracks());
   setTimeout(()=>window.autoTrack.requestFrame(),100);
   return stream;
  };
  Object.defineProperty(window,'ImageCapture',{value:class {
   async takePhoto(){
    if(!window.failStill)throw new Error('Use video fallback');
    window.failStill=false;
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1800;
    const context=canvas.getContext('2d');context.fillStyle='#dddddd';context.fillRect(0,0,1200,1800);
    return await new Promise(resolve=>canvas.toBlob(resolve));
   }
  }});
 });
 await page.goto(server.resolvedUrls.local[0]);
 await page.getByRole('button',{name:'Auto Scan',exact:true}).click();
 let dialog=page.getByRole('dialog',{name:'Auto Scan',exact:true});await dialog.waitFor();
 await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
 const calls=await page.evaluate(()=>window.mediaCalls);
 const show=async(number=0,kind='page',shift=0)=>page.evaluate(({number,kind,shift})=>window.scene(number,kind,shift),{number,kind,shift});
 const count=async expected=>dialog.getByText(`${expected} ${expected===1?'sheet':'sheets'} captured`,{exact:true}).waitFor({timeout:120000});
 await show(1);await count(1);
 await dialog.getByRole('status').filter({hasText:'Captured — remove sheet'}).waitFor();
 await page.waitForTimeout(2200);assert.equal(await page.evaluate(()=>window.captureCount),1,'same stationary page duplicated');
 for(const [kind,shift] of [['page',70],['covered',0],['partial',0]]){
  await show(1,kind,shift);await page.waitForTimeout(1800);
  assert.equal(await page.evaluate(()=>window.captureCount),1,`${kind} unlocked a captured page`);
 }
 await dialog.getByRole('button',{name:'Pause',exact:true}).click();
 await dialog.getByRole('status').filter({hasText:'Paused'}).waitFor();
 await show(0);await page.waitForTimeout(1500);
 assert.equal(await page.evaluate(()=>window.captureCount),1,'pause captured');
 await dialog.getByRole('button',{name:'Resume',exact:true}).click();
 await dialog.getByRole('status').filter({hasText:'Ready for next sheet'}).waitFor({timeout:10000});
 await show(2,'partial');await page.waitForTimeout(1800);assert.equal(await page.evaluate(()=>window.captureCount),1,'partial page captured');
 for(let i=0;i<10;i++){await show(2,'page',i%2?70:0);await page.waitForTimeout(180);}
 assert.equal(await page.evaluate(()=>window.captureCount),1,'moving page captured');
 await show(2);await count(2);
 await dialog.getByRole('status').filter({hasText:'Captured — remove sheet'}).waitFor();
 // Pause does not disable manual fallback; its success still locks automatic capture.
 await dialog.getByRole('button',{name:'Pause',exact:true}).click();
 await show(0);await page.waitForTimeout(1200);await show(3);
 await dialog.getByRole('button',{name:'Capture',exact:true}).click();await count(3);
 await dialog.getByRole('button',{name:'Resume',exact:true}).click();await page.waitForTimeout(1700);
 assert.equal(await page.evaluate(()=>window.captureCount),3,'manual capture did not lock');
 const total=Number(process.env.AUTO_TEST_COUNT||30);
 for(let i=4;i<=total;i++){
  await show(0);await dialog.getByRole('status').filter({hasText:'Ready for next sheet'}).waitFor({timeout:15000});
  if(i===4)await page.evaluate(()=>window.failStill=true);
  await show(i);
  if(i===4){await dialog.getByRole('alert').waitFor({timeout:120000});assert.equal(await dialog.getByText('3 sheets captured',{exact:true}).count(),1,'failed capture incremented count');}
  await count(i);
  await dialog.getByRole('status').filter({hasText:'Captured — remove sheet'}).waitFor();
  if(i%5===0)console.log(`auto: ${i} corrected sheets without capture taps`);
 }
 assert.equal(await page.evaluate(()=>window.mediaCalls),calls,'camera reopened between automatic captures');
 assert.equal(await page.evaluate(()=>window.captureCount),total+1,'capture overlap or duplicates');
 assert.equal(await page.evaluate(()=>window.autoWorkers.size),1,'analysis created another worker');
 // Switching modes preserves both the batch and removal latch.
 await dialog.getByLabel('Automatic capture',{exact:true}).uncheck();
 dialog=page.getByRole('dialog',{name:'Batch Scan',exact:true});await dialog.waitFor();
 await dialog.getByLabel('Automatic capture',{exact:true}).check();
 dialog=page.getByRole('dialog',{name:'Auto Scan',exact:true});await dialog.waitFor();await page.waitForTimeout(1600);
 assert.equal(await page.evaluate(()=>window.captureCount),total+1,'switching modes dropped duplicate latch');
 await dialog.getByRole('button',{name:'Finish Scanning',exact:true}).click();
 dialog=page.getByRole('dialog',{name:'Review scanned sheets',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByRole('article').count(),total);
 assert.equal(await page.evaluate(()=>window.autoTracks.every(t=>t.readyState==='ended')),true);
 assert.equal(await page.evaluate(()=>window.autoWorkers.size),0);
 await dialog.getByRole('button',{name:'Confirm batch',exact:true}).click();await dialog.waitFor({state:'detached',timeout:180000});
 await page.getByRole('heading',{name:`Loaded pages (${total})`,exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Continue to calibration',exact:true}).isDisabled(),true,'capture requested an answer key or started marking');
 console.log(`Auto camera: ${total} captures; stable/moving/partial/occlusion, removal, pause/manual, switch-mode lock, one stream/worker and existing handoff passed.`);
}catch(error){if(page)console.log('auto failure state: '+await page.locator('body').innerText());throw error;}finally{await browser.close();await server.close();}
