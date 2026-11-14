import assert from 'node:assert/strict';
import {chromium} from 'playwright';import {createServer} from 'vite';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
 const result=await page.evaluate(async()=>{
  const {scanProfile}=await import('/src/utils/pdfScanProfile.ts');const {OPS}=await import('/node_modules/pdfjs-dist/build/pdf.mjs');
  const check=(ok,msg)=>{if(!ok)throw Error(msg);};let cases=0;
  const fake=(dpi,extra=[],options={})=>({view:[0,0,612,792],userUnit:1,getOperatorList:async()=>({fnArray:[OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore,...extra],argsArray:[[],options.matrix||[612,0,0,792,0,0],['image',8.5*dpi,11*dpi*(options.anisotropic?2:1)],[],...extra.map(()=>[])]})});
  for(const dpi of [150,200,300,400,600,1200]){const p=await scanProfile(fake(dpi));check(p.renderDpi===(dpi>=300&&dpi<600?dpi:600),`resolution ${dpi}`);cases++;}
  for(const op of [OPS.showText,OPS.constructPath,OPS.fill,OPS.paintImageMaskXObject]){check((await scanProfile(fake(300,[op]))).renderDpi===600,'mixed content must retain reference');cases++;}
  check((await scanProfile(fake(300,[],{anisotropic:true}))).renderDpi===600,'anisotropic input stays on reference');cases++;
  check((await scanProfile(fake(300,[],{matrix:[306,0,0,396,0,0]}))).renderDpi===600,'partial page image must not control resolution');cases++;
  const twice=fake(300);const op=await twice.getOperatorList();op.fnArray.splice(3,0,OPS.paintImageXObject);op.argsArray.splice(3,0,['other',2550,3300]);twice.getOperatorList=async()=>op;check((await scanProfile(twice)).renderDpi===600,'multiple images stay reference');cases++;
  const unit=fake(600);unit.userUnit=2;check((await scanProfile(unit)).renderDpi===300,'PDF userUnit must affect PPI');cases++;
  const rotated=fake(300);rotated.getOperatorList=async()=>({fnArray:[OPS.save,OPS.transform,OPS.paintImageXObject,OPS.restore],argsArray:[[],[0,792,-612,0,612,0],['image',3300,2550],[]]});check((await scanProfile(rotated)).renderDpi===300,'rotated image axes must retain PPI');cases++;
  return {cases};
 });assert.equal(result.cases,15);console.log(result);
}finally{await browser.close();await server.close();}
