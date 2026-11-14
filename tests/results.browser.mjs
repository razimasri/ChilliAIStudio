import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
const parse=data=>{
  const p=spawnSync(process.env.PYTHON||'python3',['-c','import csv,sys,json,io; print(json.dumps(list(csv.reader(io.StringIO(sys.stdin.read())))))'],{input:data,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);return JSON.parse(p.stdout);
};
try {
  const page=await browser.newPage({viewport:{width:1440,height:1100}});
  await page.addInitScript(()=>{
    const Native=Worker,counts={pdf:0,zip:0,live:0,peak:0};window.exportWorkers=counts;
    window.Worker=class extends Native{
      constructor(...args){super(...args);const path=String(args[0]);this.tag=path.includes('/src/utils/pdf.worker.ts')?'pdf':path.includes('/src/utils/archive.worker.ts')?'zip':undefined;
        if(this.tag){counts[this.tag]++;counts.live++;counts.peak=Math.max(counts.peak,counts.live);}}
      terminate(){if(this.tag&&!this.closed){this.closed=true;counts.live--;}super.terminate();}
    };
  });
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/results.html');
  await page.getByRole('status').filter({hasText:'Downloads ready'}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.exportWorkers),{pdf:1,zip:1,live:0,peak:1},'Results prebuilds both exports sequentially, including under Strict Mode');
  await page.getByRole('heading',{name:'Class Overview & Question Analysis'}).waitFor();
  await page.getByRole('heading',{name:'Score Distribution'}).waitFor();
  assert.equal(await page.getByText(/Pass Rate|of \d+ passed/).count(),0,'No inferred pass threshold');
  assert.equal(await page.getByRole('button',{name:'Print sheet',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:'Download Sheet (PNG)',exact:true}).count(),0);
  const lowest=page.locator('div.rounded-2xl').filter({has:page.locator('span',{hasText:'Lowest Score'})}).last();
  assert.match(await lowest.innerText(),/1\s*\/\s*5/);
  const download=async name=>{const wait=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFile(await (await wait).path());};
  const reportText=(await download('Class Report CSV')).toString();
  const report=parse(reportText);
  assert.deepEqual(report[1],['Answer Key','','A','B','E','A','B']);
  assert.deepEqual(report[4],['Zoë, "Q"\nX','1','A','Blank','Blank','Blank','Blank']);
  assert.ok(report.every(row=>row.length===7),'Every report row spans all questions');
  assert.deepEqual(report.find(row=>row[1]==='Correct'),['','Correct','2','1','1','1','0']);
  assert.deepEqual(report.find(row=>row[1]==='Unclear'),['','Unclear','0','0','0','0','2']);
  const items=parse((await download('Item Stats CSV')).toString());
  const value=(row,col)=>items[row][items[0].indexOf(col)];
  assert.equal(value(3,'E'),'1');assert.equal(value(5,'Unclear'),'2');assert.equal(value(5,'Answered'),'0');
  assert.equal(value(5,'Blank'),'1');assert.equal(value(5,'Candidates'),'3');
  assert.equal(value(5,'Unclear %'),'67');
  const pdfBytes=await download('Download Annotated PDF');
  const pdf=await PDFDocument.load(pdfBytes);
  assert.equal(pdf.getCreator(),'ChilliMark Birdseye 2.5');
  await writeFile('/tmp/chilli-restyled-report.pdf',pdfBytes);
  assert.equal(pdf.getPageCount(),7,'Three sheets, summary, two option panels and comparison');
  const pdfText=await page.evaluate(async bytes=>{
    const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='/node_modules/pdfjs-dist/build/pdf.worker.mjs';
    const doc=await pdfjs.getDocument({data:new Uint8Array(bytes)}).promise;
    const texts=[];
    for(let i=4;i<=doc.numPages;i++) texts.push((await (await doc.getPage(i)).getTextContent()).items.map(x=>x.str).join(' ').replace(/\s+/g,' '));
    await doc.destroy(); return texts;
  },Array.from(pdfBytes));
  assert.match(pdfText[0],/Mean score: 1.7/);
  assert.doesNotMatch(pdfText.join(' '),/At least 50|Pass Rate|passed/i);
  assert.match(pdfText[0],/Zoë/);
  assert.match(pdfText[2],/UNCLEAR/);
  assert.match(pdfText[2],/5 B 0\/3 \(0%\) 0 2 \(67%\)/);
  assert.match(pdfText[pdfText.length-1],/S3/);
  const zip=await JSZip.loadAsync(await download('Download All Student Work (ZIP) 3'));
  const reportFile=Object.keys(zip.files).find(p=>p.endsWith('Class_Scores_Summary.csv'));
  assert.equal(await zip.file(reportFile).async('string'),reportText);
  assert.ok(Object.keys(zip.files).some(p=>p.endsWith('Question_Statistics.csv')));
  const pdfFile=Object.keys(zip.files).find(p=>p.endsWith('.pdf'));
  assert.deepEqual(await zip.file(pdfFile).async('nodebuffer'),pdfBytes,'Download All reuses the complete annotated report');
  assert.deepEqual(await page.evaluate(()=>window.exportWorkers),{pdf:1,zip:1,live:0,peak:1},'Download buttons reuse prepared files without starting workers');
  await page.getByRole('tab',{name:'Student Scores Roster',exact:true}).click();
  assert.equal(await page.getByRole('columnheader',{name:'Verdict',exact:true}).count(),0);
  assert.equal(await page.getByText('Pass',{exact:true}).count(),0);
  assert.equal(await page.getByText('Review Needed',{exact:true}).count(),0);
  await page.getByRole('tab',{name:/Overall Statistics/}).click();
  const batch=await page.evaluate(async()=>{
    const {exportAnnotatedPdf}=await import('/src/utils/exportPdf.ts');
    const {calculateQuestionStats}=await import('/src/utils/omrEngine.ts');
    const pdfjs=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
    const canvas=document.createElement('canvas');canvas.width=48;canvas.height=68;
    const context=canvas.getContext('2d');context.fillStyle='#8c1529';context.fillRect(0,0,48,68);
    const image=canvas.toDataURL();
    const students=Array.from({length:30},(_,i)=>({name:i===29?'学生 Maya '+ 'W'.repeat(160):'Student '+(i+1),score:40,total:40,percentage:100,responses:Array(40).fill('A'),annotatedDataUrl:image}));
    const answerKey=Object.fromEntries(Array.from({length:40},(_,i)=>[i,'A']));
    const blob=await exportAnnotatedPdf({students,answerKey,stats:calculateQuestionStats(students,answerKey)},()=>{});
    const doc=await pdfjs.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
    let last='',overflow=false;
    for(let i=31;i<=doc.numPages;i++) {
      const content=await (await doc.getPage(i)).getTextContent();
      last=content.items.map(x=>x.str).join(' ');
      overflow ||= content.items.some(x=>x.transform[4]+x.width>562 || x.transform[5]<18);
    }
    const pages=doc.numPages;await doc.destroy();
    const controller=new AbortController();controller.abort();let cancelled=false;
    try {await exportAnnotatedPdf({students,stats:[],answerKey},()=>{},controller.signal);}catch(error){cancelled=error.name==='AbortError';}
    let failed=false;try {await exportAnnotatedPdf({students:[{...students[0],annotatedDataUrl:'data:image/png;base64,broken'}],stats:[],answerKey},()=>{});}catch{failed=true;}
    return {pages,last,overflow,cancelled,failed};
  });
  assert.ok(batch.pages>38,'Thirty sheets plus paginated report and comparison panels');
  assert.match(batch.last,/40\s+A/);assert.match(batch.last,/S30/);
  assert.equal(batch.overflow,false,'Long names and 40-question panels stay inside printable margins');
  assert.equal(batch.cancelled,true);assert.equal(batch.failed,true);
  await page.screenshot({path:'/workspace/work/results-overview.png',fullPage:true});
  await page.getByRole('tab',{name:/Annotated Marked Sheets/}).click();
  await page.getByRole('button',{name:'Print sheet',exact:true}).waitFor();
  assert.ok((await page.locator('body').innerText()).includes('Key: A'));
  await page.getByRole('tab',{name:/Overall Statistics/}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('heading',{name:'Score Distribution'}).waitFor();
  console.log('Results overview, complete report/item CSVs, Unicode/quote/newline names, blank/unclear counts, fifth option, ZIP contents and sheet navigation passed');
} finally {await browser.close();await server.close();}
