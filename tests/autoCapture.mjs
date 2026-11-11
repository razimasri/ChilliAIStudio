import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile } from 'node:fs/promises';
const source=await readFile(new URL('../src/utils/camera/autoCapture.ts',import.meta.url),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;
const {AutoCaptureGate,uprightPage}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const quad=[{x:.15,y:.1},{x:.85,y:.1},{x:.85,y:.9},{x:.15,y:.9}];
const frame=({page=true,corners=true,shift=0,cover=false,dim=0}={})=>{
 const pixels=new Uint8Array(32*24*3);
 for(let y=0;y<24;y++)for(let x=0;x<32;x++){
  let rgb=[50,60,70];
  if(page&&x/31>=.15+shift&&x/31<=.85+shift&&y/23>=.1&&y/23<=.9)rgb=cover&&x/31<.5?[120,90,65]:[240,240,240];
  for(let c=0;c<3;c++)pixels[(y*32+x)*3+c]=Math.max(0,rgb[c]-dim);
 }
 return {width:360,height:480,pixels,corners:page&&corners?quad.map(p=>({...p,x:p.x+shift})):undefined};
};
let now=0;
function stable(gate,scene=frame()) {let decisions=[];for(let i=0;i<6;i++){now+=250;decisions.push(gate.observe(scene,now));}return decisions;}
function clear(gate) {let decisions=[];for(let i=0;i<6;i++){now+=250;decisions.push(gate.observe(frame({page:false}),now));}return decisions;}
const gate=new AutoCaptureGate();
assert.equal(stable(gate).filter(d=>d.capture).length,1,'stationary sheet captures once');
assert.equal(gate.state,'CAPTURING');gate.succeeded();
for(const scene of [frame(),frame({shift:.04}),frame({cover:true,corners:false}),frame({corners:false}),frame({corners:false,dim:30})]){
 assert.equal(stable(gate,scene).some(d=>d.capture),false);
 assert.equal(gate.state,'WAITING_FOR_REMOVAL','motion, cover, lost corners or exposure must not unlock');
}
now+=250;gate.observe(frame({page:false}),now);now+=250;gate.observe(frame({page:false}),now);
assert.equal(gate.state,'WAITING_FOR_REMOVAL','brief clearance is insufficient');
gate.setPaused(true);now+=10000;gate.observe(frame({page:false}),now);gate.setPaused(false);
assert.equal(gate.state,'WAITING_FOR_REMOVAL','pause must preserve duplicate lock');
clear(gate);assert.equal(gate.state,'READY');now+=250;assert.equal(gate.observe(frame({page:false}),now).message,'Ready for next sheet');
assert.equal(stable(gate).filter(d=>d.capture).length,1,'second page captures after confirmed removal');
gate.failed(now);assert.notEqual(gate.state,'WAITING_FOR_REMOVAL','failed first attempt for new page should retry');
assert.equal(gate.observe(frame(),now+250).capture,false,'failure retry backoff');
const initial=new AutoCaptureGate();
const white=frame({page:false});white.pixels.fill(235);now+=250;initial.observe(white,now);
assert.equal(stable(initial).filter(d=>d.capture).length,1);initial.succeeded();clear(initial);assert.equal(initial.state,'READY','first sheet must not be learned as the desk');
const moving=new AutoCaptureGate();for(let i=0;i<12;i++){now+=250;assert.equal(moving.observe(frame({shift:i*.004}),now).capture,false,'slow drift should not count as stable');}
const partial=new AutoCaptureGate();assert.equal(stable(partial,frame({corners:false})).some(d=>d.capture),false);
assert.equal(uprightPage(quad,480,360),false,'landscape projection rejected, not auto-rotated');
const manual=new AutoCaptureGate();manual.setPaused(true);manual.manual(frame());manual.succeeded();manual.setPaused(false);
assert.equal(stable(manual).some(d=>d.capture),false,'manual capture also locks');clear(manual);assert.equal(manual.state,'READY');
const batch=new AutoCaptureGate();let count=0;
for(let i=0;i<30;i++){
 count+=stable(batch).filter(d=>d.capture).length;batch.succeeded();
 assert.equal(stable(batch,frame({cover:true,corners:false})).some(d=>d.capture),false);
 clear(batch);assert.equal(batch.state,'READY');
}
assert.equal(count,30);
console.log('Auto gate: stability, moving/partial/upright checks, duplicate lock, hand/edge/exposure loss, sustained removal, manual/pause/failure and 30 ordered cycles passed.');
