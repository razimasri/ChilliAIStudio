import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const cases = [];
const grid = (name, lengths, omit = [], noise = []) => {
  const boxes = [];
  lengths.forEach((n,b) => {
    for (let c=0;c<4;c++) for(let r=0;r<n;r++) {
      if (!omit.some(([ob,oc,or])=>ob===b&&oc===c&&or===r)) boxes.push([100+b*800+c*100, 100+r*180]);
    }
  });
  return { name, boxes: [...boxes,...noise], params: { w:60,h:50,key:{} } };
};
cases.push(grid('intact', [6,6]));
cases.push(grid('middle missing', [6,6], [[0,1,2]]));
cases.push(grid('first missing', [6,6], [[0,1,0]]));
cases.push(grid('last missing', [6,6], [[0,1,5]]));
cases.push(grid('several tail boxes missing', [7,7], [[0,1,5],[0,1,6]]));
cases.push(grid('unequal blocks', [6,4]));
cases.push(grid('equal blocks', [6,6]));
cases.push(grid('entire global row missing', [7,7], [0,1].flatMap(b=>Array.from({length:4},(_,c)=>[b,c,3]))));
cases.push(grid('sparse noise row', [6,6], [], [[100,340],[200,340]]));
cases.push(grid('duplicate contour', [6,6], [], [[100,101]]));
cases.push(grid('whole first row missing in one block', [6,6], Array.from({length:4},(_,c)=>[1,c,0])));
cases.push(grid('whole last row missing in one block', [6,6], Array.from({length:4},(_,c)=>[1,c,5])));
cases.push(grid('two full tail rows missing in one block', [6,6], [4,5].flatMap(r=>Array.from({length:4},(_,c)=>[1,c,r]))));
const slight=grid('small drift retained',[6,6]);slight.boxes[2][1]+=10;cases.push(slight);
const snapped=grid('larger drift snapped',[6,6]);snapped.boxes[2][1]+=20;cases.push(snapped);
for (const name of ['IBSample','IGSample']) cases.push(JSON.parse(await readFile(`tests/fixtures/${name}-rows.json`, 'utf8')));
const oracle = spawnSync(process.env.PYTHON || 'python3', ['tests/rows_reference.py'], { input:JSON.stringify(cases),encoding:'utf8' });
assert.equal(oracle.status,0,oracle.stderr);
const expected=JSON.parse(oracle.stdout);
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const actual=await page.evaluate(async cases=>{
    const e=await import('/src/utils/omrEngine.ts');
    return cases.map(spec=>{
      const params=structuredClone(spec.params);
      const {columns,filtered_boxes}=e.sort_into_columns(spec.boxes,params);
      e.sort_into_rows(filtered_boxes,params);
      e.missing(columns,params);
      const questions=e.find_questions(columns,params).map(q=>({number:q.number,boxes:q.boxes.map(b=>({xy:b.xy,letter:b.letter}))}));
      return {name:spec.name,...params,columns,questions};
    });
  },cases);
  for(let i=0;i<cases.length;i++) {
    const a=actual[i],p=expected[i];
    assert.deepEqual(a.row_avg,p.row_avg,`${a.name}: observed rows`);
    assert.equal(a.y_jump,p.y_jump,`${a.name}: spacing`);
    assert.deepEqual(a.col_avg,p.col_avg,`${a.name}: column means`);
    assert.equal(a.x_jump,p.x_jump,`${a.name}: horizontal spacing`);
    assert.equal(a.choices,p.choices,`${a.name}: choices`);
    // Mutation/tail-order fixes are specified independently, below.
    const corrected=['several tail boxes missing','unequal blocks','duplicate contour','sparse noise row','two full tail rows missing in one block'];
    if(corrected.includes(a.name)) {
      if(p.questions) assert.notDeepEqual(a.columns,p.columns,`${a.name}: must fix the legacy mutation/tail behavior`);
      else assert.ok(p.error,`${a.name}: expected a legacy failure`);
    }
    if(!corrected.includes(a.name)) {
      assert.equal(p.error,undefined,`${a.name}: Python failed`);
      assert.deepEqual(a.questions,p.questions,`${a.name}: question/letter positions`);
      console.log(`${a.name}: matches Python question mapping`);
    }
    for(const column of a.columns) {
      assert.equal(column.length,a.row_avg.length,`${a.name}: every row represented`);
      for(let r=1;r<column.length;r++) assert.ok(column[r][1]>column[r-1][1],`${a.name}: top-to-bottom`);
    }
    if(a.name==='entire global row missing') assert.equal(a.row_avg.length,6,'Do not invent an unobserved row');
    if(a.name==='several tail boxes missing') assert.deepEqual(a.columns[1].map(b=>b[1]),[100,280,460,640,820,1000,1180]);
    if(a.name==='two full tail rows missing in one block') assert.deepEqual(a.questions.slice(-2).map(q=>q.boxes.map(b=>b.xy[1])),[[820,820,820,820],[1000,1000,1000,1000]]);
    if(a.name==='sparse noise row') assert.equal(a.questions.length,12,'Noise must not shift following questions');
    if(a.name==='duplicate contour') assert.equal(a.questions.length,12,'Duplicate must not add a question');
  }
  // A reused parameter object must not carry spacing into a single/empty row.
  const resets=await page.evaluate(async()=>{
    const {sort_into_rows}=await import('/src/utils/omrEngine.ts');
    const p={h:50,y_jump:180};sort_into_rows([[100,100],[200,100],[300,100]],p);
    const single=p.y_jump;sort_into_rows([],p);return {single,empty:p.y_jump,rows:p.row_avg};
  });
  assert.deepEqual(resets,{single:0,empty:0,rows:[]});
  const inconsistentRejected=await page.evaluate(async()=>{
    const e=await import('/src/utils/omrEngine.ts');
    const p={w:60,h:50,key:{}};
    const boxes=[[100,100],[100,280],[100,460],[200,190],[200,370],[200,550],[300,640],[300,820],[300,1000]];
    const {columns,filtered_boxes}=e.sort_into_columns(boxes,p);
    e.sort_into_rows(filtered_boxes,p);
    try {e.missing(columns,p);return false;}catch(error){return error.message.includes('No consistent question rows');}
  });
  assert.equal(inconsistentRejected,true,'An inconsistent grid must fail instead of producing questions');
  console.log(`${cases.length} row reconstruction cases passed`);
} finally {await browser.close();await server.close();}
