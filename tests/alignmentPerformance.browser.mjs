import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Full native-resolution parity and timing. ALIGNMENT_PAGES=IGSample:1,IBSample:7
// limits a quick experiment. ALIGNMENT_FULL=1 covers all 25 bundled sample pages.
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
const useSimd = process.env.ALIGNMENT_SIMD !== '0';
try {
  const page = await browser.newPage();
  page.on('console', message => { if(message.text().startsWith('alignment:')) console.log(message.text()); });
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/worker.html');
  const report = await page.evaluate(async ({useSimd,requested,syntheticOnly}) => {
    const engine = await import('/src/utils/omrEngine.ts');
    const {getCV} = await import('/tests/helpers/cvRuntimes.ts');
    const {legacyRotation} = await import('/tests/helpers/legacyAlignment.ts');
    const {warpMonochrome} = await import('/src/utils/monochromeAlignment.ts');
    const {setup} = await import('/tests/helpers/sampleCalibration.ts');
    const {getMarkingPage} = await import('/src/utils/pdfProcessor.ts');
    const {releaseAllImages} = await import('/src/utils/imageStore.ts');
    const {resolveStudentResponse} = await import('/src/utils/grading.ts');
    const scalar = await getCV('scalar');
    const simd = useSimd ? await getCV('simd') : undefined;
    const check = (ok,message) => {if(!ok)throw Error(message);};
    const comparePixels = (expected,actual,label) => {
      check(expected.rows===actual.rows&&expected.cols===actual.cols&&expected.type()===actual.type(),label+': image format changed');
      const a=expected.data,b=actual.data;let different=0,maxDelta=0;
      for(let i=0;i<a.length;i++)if(a[i]!==b[i]){different++;maxDelta=Math.max(maxDelta,Math.abs(a[i]-b[i]));}
      check(different===0,`${label}: ${different} bytes differ (max ${maxDelta})`);
    };
    const profileRotation = (cv,input,options) => {
      let warpMs=0,warpCalls=0;
      const proxy=new Proxy(cv,{get(target,key){if(key!=='warpAffine')return target[key];return (...args)=>{const start=performance.now();try{return target.warpAffine(...args);}finally{warpMs+=performance.now()-start;warpCalls++;}};}});
      const started=performance.now();const result=engine.rotation(proxy,input,options);
      return {...result,ms:performance.now()-started,warpMs,warpCalls};
    };
    let borderCases=0;
    for(const cv of simd?[scalar,simd]:[scalar])
      for(const [width,height] of [[3,5],[17,29],[64,33],[101,201]])
        for(const angle of [0,.01,-.01,.10297393798828125,.25502777099609375,-.3365587294101715,1,-1,10,-10,44.9,-44.9]) {
          const input=new cv.Mat(height,width,cv.CV_8UC4);
          const bytes=input.data;
          for(let i=0;i<width*height;i++){const shade=(i*73+Math.floor(i/width)*19)%256;bytes[i*4]=shade;bytes[i*4+1]=shade;bytes[i*4+2]=shade;bytes[i*4+3]=255;}
          const matrix=cv.getRotationMatrix2D(new cv.Point(Math.floor(width/2),Math.floor(height/2)),angle,1);
          const expected=new cv.Mat(),actual=new cv.Mat();
          cv.warpAffine(input,expected,matrix,new cv.Size(width,height));
          warpMonochrome(cv,input,actual,matrix);
          comparePixels(expected,actual,`small ${width}x${height} angle ${angle}`);
          expected.delete();actual.delete();matrix.delete();input.delete();borderCases++;
        }
    const synthetic=[];
    for(const kind of ['mono-rgba','mono-rgb','colour','alpha','noncontiguous']) {
      const cv=scalar,channels=kind==='mono-rgb'?3:4;
      let storage=new cv.Mat(3020,2920,channels===3?cv.CV_8UC3:cv.CV_8UC4,new cv.Scalar(255,255,255,255));
      let input=kind==='noncontiguous'?storage.roi(new cv.Rect(10,10,2900,3000)):storage;
      const points=cv.matFromArray(4,1,cv.CV_32SC2,[300,350,2600,330,2580,2700,320,2720]);
      const contours=new cv.MatVector();contours.push_back(points);
      cv.polylines(input,contours,true,new cv.Scalar(0,0,0,255),4,cv.LINE_AA);
      for(let i=0;i<40;i++)cv.rectangle(input,new cv.Point(600+i*27,700+i*31),new cv.Point(620+i*27,710+i*31),new cv.Scalar(90+i,90+i,90+i,255),-1);
      if(kind==='colour')input.data[(1000*input.cols+1000)*4+1]=17;
      if(kind==='alpha')input.data[3]=254;
      const baseline=legacyRotation(cv,input),candidate=profileRotation(cv,input,{singleChannel:true});
      check(JSON.stringify(candidate.rect)===JSON.stringify(baseline.rect),kind+': registration rectangle');
      check(candidate.angle===baseline.angle,kind+': angle');
      comparePixels(baseline.rotated,candidate.rotated,kind);
      const expectedFast=kind!=='colour'&&kind!=='alpha'&&kind!=='noncontiguous';
      check(candidate.singleChannel===expectedFast,kind+': guarded path selection');
      synthetic.push({kind,singleChannel:candidate.singleChannel,ms:candidate.ms,warpMs:candidate.warpMs});
      candidate.rotated.delete();baseline.rotated.delete();points.delete();contours.delete();
      if(input!==storage)input.delete();storage.delete();
    }
    const selections=requested?requested.split(',').map(part=>{const [sample,page]=part.split(':');return{sample,index:Number(page)-1};}):undefined;
    const reports=[], calibrations=[];
    for(const sample of syntheticOnly?[]:['IGSample','IBSample']) {
      if(selections&&!selections.some(s=>s.sample===sample))continue;
      const {pages,params}=await setup(sample,undefined,'scalar');
      if(simd) {
        const candidate=await setup(sample,pages[0].sourceFile,'simd');
        check(JSON.stringify(candidate.params)===JSON.stringify(params),`${sample}: SIMD changed calibration parameters (rectangle, sample contour, fill limit, or column layout)`);
        calibrations.push({sample,matched:true,rect:params.rect,box:[params.w,params.h],fillLimit:params.fill_limit,columns:params.columnLayout});
        console.log('alignment: '+sample+' scalar/SIMD calibration parameters match');
      }
      for(let index=0;index<pages.length;index++) {
        if(selections&&!selections.some(s=>s.sample===sample&&s.index===index))continue;
        const raster=await getMarkingPage(pages[index]);
        const input=await engine.renderScanMat(scalar,raster.bitmap);raster.release();
        const modes=[{name:'scalar-rgba',cv:scalar,options:{singleChannel:false}},{name:'scalar-mono',cv:scalar,options:{singleChannel:true}}];
        if(simd)modes.push({name:'simd-rgba',cv:simd,options:{singleChannel:false}},{name:'simd-mono',cv:simd,options:{singleChannel:true}});
        let expectedPixels,expectedState;
        const expectedMasks=new Map();
        const timings=[];
        for(const mode of modes) {
          const cv=mode.cv;
          const source=cv===scalar?input:cv.matFromArray(input.rows,input.cols,cv.CV_8UC4,input.data);
          const rotated=profileRotation(cv,source,mode.options);
          const start=performance.now();const scan=engine.scale(cv,rotated.rotated,rotated.rect,params);const scaleMs=performance.now()-start;
          rotated.rotated.delete();if(source!==input)source.delete();
          if(!expectedPixels)expectedPixels=scan.data.slice();
          else {const actualPixels=scan.data;let different=0;for(let i=0;i<actualPixels.length;i++)different+=actualPixels[i]!==expectedPixels[i];check(!different,`${sample} page ${index+1} ${mode.name}: ${different} registered bytes differ`);}
          const q=scan.roi(new cv.Rect(params.x1,params.y1,params.x2-params.x1,params.y2-params.y1));
          const maskCalls = {}; let maskOverheadMs = 0;
          const checkedCV = new Proxy(cv,{get(target,key){
            if(key!=='adaptiveThreshold'&&key!=='threshold')return target[key];
            return (...args)=>{
              const result=target[key](...args), captured=performance.now(), call=maskCalls[key]||0;maskCalls[key]=call+1;
              const id=key+':'+call, actual=args[1].data;
              if(mode.name==='scalar-rgba')expectedMasks.set(id,actual.slice());
              else {const expected=expectedMasks.get(id);check(expected&&expected.length===actual.length,`${sample} ${mode.name}: ${id} mask size`);let difference=0;for(let i=0;i<actual.length;i++)difference+=actual[i]!==expected[i];check(!difference,`${sample} page ${index+1} ${mode.name}: ${id} ${difference} mask pixels differ`);}
              maskOverheadMs+=performance.now()-captured; return result;
            };
          }});
          let started=performance.now();const local={...params};const boxes=engine.find_boxes(checkedCV,q,local);const boxesMs=performance.now()-started-maskOverheadMs;
          const {columns,filtered_boxes}=engine.sort_into_columns(boxes,local);engine.sort_into_rows(filtered_boxes,local);engine.missing(columns,local);
          const questions=engine.find_questions(columns,local),student={questions,incomplete:[]};engine.find_responses(checkedCV,student,q,local);
          const responses=questions.map(q=>q.response);
          const score=Object.entries(params.key).reduce((sum,[number,key])=>sum+(responses[Number(number)]===key?1:0),0);
          const result={id:'parity',index,name:'Test',questions,incomplete:student.incomplete,responses,score,total:Object.keys(params.key).length,percentage:0,hasAmbiguity:!!student.incomplete.length,annotatedDataUrl:'',originalDataUrl:''};
          const corrected=resolveStudentResponse(result,0,'D',params.key);
          const state={rect:rotated.rect,angle:rotated.angle,boxes,questions,responses,incomplete:student.incomplete,score,corrected:{responses:corrected.responses,score:corrected.score,manual:corrected.manualResponses}};
          if(!expectedState)expectedState=JSON.stringify(state);else check(JSON.stringify(state)===expectedState,`${sample} page ${index+1} ${mode.name}: box/response/review/manual state changed`);
          timings.push({mode:mode.name,singleChannel:rotated.singleChannel,rotationMs:rotated.ms,warpMs:rotated.warpMs,warpCalls:rotated.warpCalls,scaleMs,boxesMs,score,ambiguities:student.incomplete.length});
          q.delete();scan.delete();
        }
        input.delete();releaseAllImages();
        reports.push({sample,page:index+1,timings});console.log('alignment: '+JSON.stringify(reports.at(-1)));
      }
    }
    return {borderCases,synthetic,calibrations,reports,hardware:{cores:navigator.hardwareConcurrency,memory:navigator.deviceMemory}};
  },{useSimd,syntheticOnly:process.env.ALIGNMENT_SYNTHETIC_ONLY==='1',requested:process.env.ALIGNMENT_PAGES||(process.env.ALIGNMENT_FULL==='1'?'':'IGSample:1,IGSample:2,IBSample:1,IBSample:7')});
  assert.equal(report.synthetic.length,5);
  if(process.env.ALIGNMENT_SYNTHETIC_ONLY!=='1')assert.ok(report.reports.length>0);
  if(process.env.ALIGNMENT_REPORT)await writeFile(process.env.ALIGNMENT_REPORT,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
  console.log('Native registered pixels, boxes, responses, review flags, grades and manual corrections match across alignment/runtime paths.');
} finally {await browser.close();await server.close();}
