import {chromium} from 'playwright';
import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();page.on('console',m=>{if(m.text().startsWith('filter parity:'))console.log(m.text());});
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/worker.html');
  const report=await page.evaluate(async()=>{
    const e=await import('/src/utils/omrEngine.ts');
    const {cutoffBoxes}=await import('/tests/helpers/cutoffBoxes.ts');
    const {setup}=await import('/tests/helpers/sampleCalibration.ts');
    const {getCV}=await import('/src/utils/cvLoader.ts');
    const {getMarkingPage}=await import('/src/utils/pdfProcessor.ts');
    const cv=await getCV();let checked=0;
    for(const [sample,indices] of [['IGSample',[0,1,9]],['IBSample',[0,6,9]]]){
      const {pages,params}=await setup(sample);
      for(const index of indices){
        const lease=await getMarkingPage(pages[index]);const source=await e.renderScanMat(cv,lease.bitmap);lease.release();
        const {rotated,rect}=e.rotation(cv,source);source.delete();const registered=e.scale(cv,rotated,rect,params);rotated.delete();
        const grid=registered.roi(new cv.Rect(params.x1,params.y1,params.x2-params.x1,params.y2-params.y1));
        try {
          const state=find=>{
            const p={...params},raw=find(cv,grid,p);
            const {columns,filtered_boxes}=e.sort_into_columns(raw,p);e.sort_into_rows(filtered_boxes,p);e.missing(columns,p);
            const student={questions:e.find_questions(columns,p),incomplete:[]};e.find_responses(cv,student,grid,p);
            return JSON.stringify({raw,questions:student.questions,incomplete:student.incomplete,rows:p.row_avg,columns:p.col_avg});
          };
          if(state(e.find_boxes)!==state(cutoffBoxes))throw Error(`${sample} page ${index+1}: geometry or answers changed`);
          checked++;console.log(`filter parity: ${sample} page ${index+1} identical`);
        } finally {grid.delete();registered.delete();}
      }
    }
    return {pages:checked,rawBoxesGeometryAnswersAndReviewIdentical:true};
  });console.log(report);
}finally{await browser.close();await server.close();}
