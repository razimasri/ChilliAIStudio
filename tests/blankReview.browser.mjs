import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/worker.html');
 const supplied=process.env.FAINT_MARKS_PDF? (await readFile(process.env.FAINT_MARKS_PDF)).toString('base64'):null;
 const privateKey=(process.env.FAINT_MARKS_KEY || '').replace(/[^A-Za-z]/g,'').toUpperCase();
 if(supplied&&!privateKey)throw new Error('Provide FAINT_MARKS_KEY with the private PDF. Neither input is committed.');
 const report=await page.evaluate(async ({supplied,privateKey})=>{
  const e=await import('/src/utils/omrEngine.ts');const {getCV}=await import('/src/utils/cvLoader.ts');
  const {resolveStudentResponse,preserveManualResponses}=await import('/src/utils/grading.ts');
  const {reviewItem}=await import('/src/utils/reviewQueue.ts');
  const {releaseResultImages,releaseAllImages}=await import('/src/utils/imageStore.ts');
  const cv=await getCV();const check=(condition,message)=>{if(!condition)throw Error(message);};
  const params={inner:[{x:-10,y:-10},{x:10,y:-10},{x:10,y:10},{x:-10,y:10}],fill_limit:80,key:{0:'A',1:'B',2:'C'}};
  const image=new cv.Mat(180,200,cv.CV_8UC4,new cv.Scalar(255,255,255,255));
  const make=number=>({number,response:'Blank',response_box:null,boxes:['A','B','C','D'].map((letter,i)=>({letter,xy:[30+i*40,30+number*30],bool:false,colour:null}))});
  const student={questions:[0,1,2,3].map(make),incomplete:[]};
  e.find_responses(cv,student,image,params);
  const noKey={questions:[make(0)],incomplete:[]};
  e.find_responses(cv,noKey,image,{...params,key:undefined});
  check(noKey.questions[0].response==='Blank'&&!noKey.incomplete.length,'missing key must not introduce review');
  check(student.questions.every(q=>q.boxes.every(box=>box.inkCount===0)),'blank ink counts must be retained');
  cv.rectangle(image,new cv.Point(20,20),new cv.Point(29,29),new cv.Scalar(0,0,0,255),-1);
  cv.rectangle(image,new cv.Point(60,20),new cv.Point(68,29),new cv.Scalar(0,0,0,255),-1);
  const pair={questions:[make(0)],incomplete:[]};
  e.find_responses(cv,pair,image,params);
  check(pair.questions[0].boxes[0].inkCount===100&&pair.questions[0].boxes[1].inkCount===90,'retain actual countNonZero values');
  check(reviewItem({index:0,name:'Test',annotatedDataUrl:''},pair.questions[0],{...params,x1:0,choices:4}).suggestedResponse==='Unclear','native 10% pair must yield a hint');
  image.delete();
  check(student.incomplete.length===3,'only keyed blanks enter review');
  check(student.questions.slice(0,3).every(q=>q.response===false&&q.reviewReason==='no-mark'),'missing mark must remain unresolved');
  check(student.questions[3].response==='Blank'&&!student.questions[3].reviewReason,'unused row should stay ignored');
  let reviewed={...student,id:'test',index:0,name:'Test',responses:student.questions.map(q=>q.response),score:0,total:3,percentage:0,hasAmbiguity:true,annotatedDataUrl:'',originalDataUrl:''};
  reviewed=resolveStudentResponse(reviewed,0,'Blank',params.key);
  check(reviewed.incomplete.length===2&&reviewed.responses[0]==='Blank','confirming genuine blank should keep remaining reviews');
  reviewed=resolveStudentResponse(reviewed,1,'B',params.key);
  reviewed=resolveStudentResponse(reviewed,2,'A',params.key);
  check(reviewed.score===1&&!reviewed.hasAmbiguity,'teacher choices alone determine grade');
  const reread={...student,id:'test',index:0,name:'Test',responses:student.questions.map(q=>q.response),score:0,total:3,percentage:0,hasAmbiguity:true,annotatedDataUrl:'',originalDataUrl:''};
  const preserved=preserveManualResponses(reread,reviewed,params.key);
  check(preserved.responses[0]==='Blank'&&preserved.responses[1]==='B'&&!preserved.hasAmbiguity,'re-read must preserve manual Blank and answers');
  if(!supplied)return {keyedBlanks:3,ignoredRows:1};
  // Private user-provided PDF is read only when supplied locally; never committed to the repository.
  const bytes=Uint8Array.from(atob(supplied),c=>c.charCodeAt(0));
  const source=new File([bytes],'private-physics.pdf',{type:'application/pdf'});
  const {setup}=await import('/tests/helpers/sampleCalibration.ts');
  const {getMarkingPage,releaseUnusedSources}=await import('/src/utils/pdfProcessor.ts');
  const {pages,params:calibration}=await setup('IBSample',source);
  calibration.y2=6600; // This document's 14-row blocks extend below the bundled sample's bounds.
  const key=[...privateKey];
  calibration.key=Object.fromEntries(key.map((answer,i)=>[i,answer]));
  const read=async local=>{const lease=await getMarkingPage(pages[7]);try{return await e.processStudentScan(cv,lease.bitmap,'Regression sheet',0,local);}finally{lease.release();}};
  let result=await read(calibration);
  const baseScore=result.score;
  check(result.incomplete.some(q=>q.number===5&&q.reviewReason==='no-mark'),'Q6 D must be caught for review');
  check(result.rawDeskewedDataUrl&&result.ambiguityCrops[5],'Q6 must have a clean review crop');
  // Q10 is borderline and can cross the threshold with calibration/area variation.
  releaseResultImages([result]);
  const conservative={...calibration,fill_limit:calibration.fill_limit*1.05};
  result=await read(conservative);
  for(const number of [5,9]){
   const question=result.questions[number];
   check(question.response===false&&question.reviewReason==='no-mark',`Q${number+1} should require review`);
   const item=reviewItem(result,question,conservative);
   check(item.reviewReason==='no-mark'&&item.detectedLetters.length===0&&item.cropDataUrl,'review context/crop missing');
  }
  check(result.questions.length===25,'rows outside the key must be excluded');
  const before=result.score;
  result=resolveStudentResponse(result,5,'D',conservative.key);
  result=resolveStudentResponse(result,9,'B',conservative.key);
  check(result.score===16&&result.total===25,'confirmed grade must be 16/25');
  check(result.questions[5].response_box.colour==='green','Q6 D annotation must be green');
  check(result.questions[9].response_box.colour==='red','Q10 B annotation must be red');
  check(!result.hasAmbiguity,'all actual sheet reviews should now be resolved');
  const imageUrl=await e.renderStudentFinalAnnotation(cv,result,conservative);
  const marked=await e.renderScanMat(cv,imageUrl);
  try{
   for(const [number,channel]of [[5,'green'],[9,'red']]){
    const q=result.questions[number],b=q.response_box;
    let count=0;
    // Sample the expected outline, excluding the green answer-key letter in the centre.
    for(const point of conservative.outer)for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const x=Math.round(conservative.x1+b.xy[0]+point.x)+dx;
      const y=Math.round(conservative.y1+b.xy[1]+point.y)+dy;
      if(x<0||y<0||x>=marked.cols||y>=marked.rows)continue;
      const p=marked.ucharPtr(y,x);
      if(channel==='red'?p[0]>130&&p[1]<80:p[1]>100&&p[0]<80)count++;
    }
    check(count>20,`Q${number+1} ${channel} outline missing from final PNG`);
   }
  }finally{marked.delete();}
  const csv=e.exportStudentScoresCsv([result],conservative.key);
  check(csv.includes('"Regression sheet","16"'),'CSV grade must match 16');
  releaseResultImages([result]);releaseUnusedSources(pages,[]);releaseAllImages();
  return {keyedBlanks:3,ignoredRows:1,sourcePages:pages.length,baseScore,before,confirmedScore:result.score,total:25};
 },{supplied,privateKey});
 assert.equal(report.keyedBlanks,3);console.log(report);
}finally{await browser.close();await server.close();}
