import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/grading.html');
  await page.waitForFunction(()=>window.showGradingResults,null,{timeout:120000});
  const report=await page.evaluate(async()=>{
    const { getCV } = await import('/src/utils/cvLoader.ts');
    const cv=await getCV();window.cv=cv;
    const e=await import('/src/utils/omrEngine.ts');
    const g=await import('/src/utils/grading.ts');
    const key=Object.fromEntries(Array.from({length:27},(_,i)=>[i,'A']));
    const responses=Array.from({length:27},(_,i)=>i<4?'A':'B');
    const questions=responses.map((response,number)=>{
      const boxes=['A','B','C','D'].map((letter,c)=>({letter,xy:[100+c*300,100+number*180],bool:letter===response,colour:letter===response?'red':null}));
      return {number,response,boxes,response_box:boxes.find(b=>b.bool)};
    });
    const canvas=document.createElement('canvas');canvas.width=4800;canvas.height=6840;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,4800,6840);
    const raw=canvas.toDataURL('image/png');canvas.width=0;canvas.height=0;
    const params={key,x1:500,y1:1000,x2:2200,y2:6200,w:80,h:60,outer:[{x:-40,y:-30},{x:40,y:-30},{x:40,y:30},{x:-40,y:30}],inner:[],font_size:1,text_shift:[0,0]};
    const student=g.gradeStudent({id:'1',index:0,name:'Tanner Moore',responses,questions,score:999,total:27,percentage:999,
      annotatedDataUrl:raw,originalDataUrl:raw,rawDeskewedDataUrl:raw,hasAmbiguity:false,incomplete:[]},key);
    if(student.score!==4||student.percentage!==15)throw new Error('Canonical grade must be 4/27 (15%)');
    const printed=[];
    const tracked=new Proxy(cv,{get(target,property){return property==='putText'?(...args)=>{if(String(args[1]).startsWith('Score ='))printed.push(args[1]);return target.putText(...args);}:target[property];}});
    // Reproduce final rendering of an already scored student after another student's correction.
    const before=JSON.stringify(student);
    const first=await e.renderStudentFinalAnnotation(tracked,student,params);
    const second=await e.renderStudentFinalAnnotation(tracked,student,params);
    if(first!==second)throw new Error('Repeated final rendering changed the output pixels');
    if(before!==JSON.stringify(student))throw new Error('Drawing mutated student state');
    if(printed.length!==4||printed.some(text=>text!=='Score = 4 / 27'))throw new Error('Printed score disagrees: '+printed);
    const ambiguous=structuredClone(student);ambiguous.responses[3]=false;ambiguous.questions[3].response=false;
    ambiguous.questions[3].boxes[0].bool=true;ambiguous.questions[3].boxes[1].bool=true;
    ambiguous.incomplete=[ambiguous.questions[3]];ambiguous.hasAmbiguity=true;
    const corrected=g.resolveStudentResponse(ambiguous,3,'A',key);
    const repeated=g.resolveStudentResponse(corrected,3,'A',key);
    const wrong=g.resolveStudentResponse(corrected,3,'B',key);
    const blank=g.resolveStudentResponse(corrected,3,'Blank',key);
    const unclear=g.resolveStudentResponse(ambiguous,3,'Unclear',key);
    if(corrected.score!==4||repeated.score!==4||wrong.score!==3||blank.score!==3||unclear.score!==3)throw new Error('Correction scores are not recomputed from responses');
    if(corrected.hasAmbiguity||corrected.incomplete.length||corrected.questions[3].boxes.filter(b=>b.bool).length!==1)throw new Error('Correction state is inconsistent');
    const csv=e.exportStudentScoresCsv([student],key);
    if(!csv.includes('"Tanner Moore","4"'))throw new Error('CSV score differs');
    window.showGradingResults({...student,annotatedDataUrl:first},key);
    window.gradingPng=first;
    return {printed,score:student.score,total:student.total,percentage:student.percentage};
  });
  assert.equal(report.score,4);assert.equal(report.total,27);assert.equal(report.percentage,15);
  await page.getByRole('button',{name:/Annotated Marked Sheets/}).click();
  await page.getByText('4 / 27 (15%)',{exact:true}).waitFor();
  const [file]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Download Sheet (PNG)',exact:true}).last().click()]);
  assert.match(file.suggestedFilename(),/4of27/);
  const bytes=await readFile(await file.path());
  const expected=await page.evaluate(()=>window.gradingPng.split(',')[1]);
  assert.equal(bytes.toString('base64'),expected,'Downloaded PNG differs from the verified annotation');
  const [csvFile]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/^(Scores CSV|Class Report CSV)$/}).click()]);
  assert.ok((await readFile(await csvFile.path(),'utf8')).includes('"Tanner Moore","4"'),'Downloaded CSV must report 4');
  await page.screenshot({path:'/workspace/work/grading-consistency.png'});
  console.log('4/27 UI, CSV, printed annotation and downloaded PNG agree; repeated rendering is pixel-identical and state-preserving; correct/wrong/blank/unclear corrections do not accumulate points');
} finally {await browser.close();await server.close();}
