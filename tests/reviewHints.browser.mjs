import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:640}]){
    const page=await browser.newPage({viewport});await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/liveReview.html');
    await page.waitForFunction(()=>window.showReview);
    const cases=await page.evaluate(async()=>{
      const {reviewItem}=await import('/src/utils/reviewQueue.ts');
      const make=(reason,levels)=>reviewItem({index:0,name:'Review test',annotatedDataUrl:'',ambiguityCrops:{}},{number:0,response:false,response_box:null,reviewReason:reason,boxes:levels.map((count,i)=>({letter:String.fromCharCode(65+i),xy:[100+i*250,100],bool:count>0,inkCount:count,colour:null}))},{x1:0,choices:4});
      const blank=make('no-mark',[0,0,0,0]),equal=make('multiple-marks',[200,200,0,0]),boundary=make('multiple-marks',[200,180,0,0]),outside=make('multiple-marks',[200,179,0,0]),three=make('multiple-marks',[200,190,180,0]),unknown=make('multiple-marks',[200,190,0,0]);delete unknown.suggestedResponse;
      return {blank,equal,boundary,outside,three,unknown};
    });
    assert.equal(cases.blank.suggestedResponse,'Blank');
    assert.equal(cases.equal.suggestedResponse,'Unclear');
    assert.equal(cases.boundary.suggestedResponse,'Unclear','Exactly 10% difference qualifies');
    assert.equal(cases.outside.suggestedResponse,undefined);
    assert.equal(cases.three.suggestedResponse,undefined,'Three marks must not be presented as a close pair');
    const show=async item=>{
      await page.evaluate(item=>{const {cropDataUrl,...rest}=item;window.showReview(rest);},item);
      await page.waitForFunction(expected=>document.querySelector('#review-guidance')?.textContent.includes(expected),item.reviewReason==='no-mark'?'No mark detected':item.suggestedResponse==='Unclear'?'similar ink':'Multiple marks');
    };
    const snippet=page.getByLabel('Scanned answer snippet',{exact:true});
    const blank=page.getByRole('button',{name:'Blank (no mark)',exact:true}),unclear=page.getByRole('button',{name:'Unclear',exact:true});
    const isYellow=button=>button.evaluate(el=>{
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const ctx=canvas.getContext('2d');ctx.fillStyle=getComputedStyle(el).backgroundColor;ctx.fillRect(0,0,1,1);
      const [r,g,b]=ctx.getImageData(0,0,1,1).data;return r>200&&g>140&&b<130;
    });
    await show(cases.blank);const top=(await snippet.boundingBox()).y;
    assert.equal(await isYellow(blank),true);
    assert.equal(await blank.getAttribute('aria-pressed'),'false','Hint must not select an answer');
    await show(cases.boundary);assert.equal(await isYellow(unclear),true);
    assert.ok(Math.abs((await snippet.boundingBox()).y-top)<1,'Changing review reason must not move the snippet');
    await show(cases.outside);assert.equal(await isYellow(unclear),false);
    assert.ok(Math.abs((await snippet.boundingBox()).y-top)<1);
    assert.deepEqual(await page.evaluate(()=>window.selections),[],'Hints never submit answers');
    await show(cases.blank);await blank.click();assert.deepEqual(await page.evaluate(()=>window.selections),['Blank']);
    await page.evaluate(()=>window.showReview({reviewReason:'no-mark',suggestedResponse:'Blank',currentResponse:'A'}));
    await page.getByText('Answer saved.',{exact:false}).waitFor();
    assert.equal(await isYellow(blank),false,'Manual choices suppress the hint');
    await page.close();
  }
  console.log('Review hints: exact 10% boundary, blank/similar/unequal/three-mark cases, manual choices, no auto-selection and stable desktop/mobile snippet position passed.');
}finally{await browser.close();await server.close();}
