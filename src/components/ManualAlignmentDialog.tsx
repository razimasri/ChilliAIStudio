import { useEffect, useRef, useState } from 'react';
import type { CalibrationParams, ExamFile } from '../types';
import type { AlignmentRecoveryRequest, ManualPageAlignment } from '../utils/manualAlignment';
import { validateManualAlignment } from '../utils/manualAlignment';
import { getExamPage } from '../utils/pdfProcessor';
import { useCanvasPointer } from '../utils/useCanvasPointer';

const W=4800, H=6840;
type Point={x:number;y:number};
export function ManualAlignmentDialog({file,params,request,onConfirm,onCancel}:{
  file:ExamFile; params:CalibrationParams; request:AlignmentRecoveryRequest;
  onConfirm:(alignment:ManualPageAlignment)=>void; onCancel:()=>void;
}) {
  const source=useRef<HTMLCanvasElement>(null), preview=useRef<HTMLCanvasElement>(null);
  const reference=useRef<HTMLCanvasElement>(null), viewport=useRef<HTMLDivElement>(null);
  const dialog=useRef<HTMLDivElement>(null);
  const [image,setImage]=useState<HTMLImageElement>();
  const [referenceImage,setReferenceImage]=useState<HTMLImageElement>();
  const [angle,setAngle]=useState(0), [zoom,setZoom]=useState(1);
  const [mode,setMode]=useState<'draw'|'pan'>('draw');
  const [rect,setRect]=useState<ManualPageAlignment['rect']|null>(null);
  const [error,setError]=useState('');
  const [view,setView]=useState<'source'|'preview'|'reference'>('source');
  const pageMode=params.alignmentMode==='page';
  useEffect(()=>{
    const controller=new AbortController();
    let release:(()=>void)|undefined, referenceUrl:string|undefined;
    const decode=(url:string)=>new Promise<HTMLImageElement>((resolve,reject)=>{
      const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Could not display alignment image.'));img.src=url;
    });
    void (async()=>{
      try {
        const raster=await getExamPage(file,1400,controller.signal); release=raster.release;
        const loaded=await decode(raster.url); controller.signal.throwIfAborted();setImage(loaded);
        if(params.alignmentReferencePreview){
          referenceUrl=URL.createObjectURL(params.alignmentReferencePreview);
          const ref=await decode(referenceUrl);controller.signal.throwIfAborted();setReferenceImage(ref);
        }
      }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:String(e));}
    })();
    return()=>{controller.abort();release?.();if(referenceUrl)URL.revokeObjectURL(referenceUrl);};
  },[file,params.alignmentReferencePreview]);
  useEffect(()=>{
    const before=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    dialog.current?.focus();
    return()=>{document.body.style.overflow=overflow;before?.focus();};
  },[]);
  useEffect(()=>{
    if(!image||!source.current||!preview.current)return;
    const rotated=document.createElement('canvas');
    rotated.width=image.naturalWidth;rotated.height=image.naturalHeight;
    const r=rotated.getContext('2d')!;
    r.fillStyle='white';r.fillRect(0,0,rotated.width,rotated.height);
    r.translate(Math.floor(rotated.width/2),Math.floor(rotated.height/2));r.rotate(-angle*Math.PI/180);
    r.translate(-Math.floor(rotated.width/2),-Math.floor(rotated.height/2));r.drawImage(image,0,0);
    const paint=(canvas:HTMLCanvasElement)=>{canvas.width=600;canvas.height=855;const c=canvas.getContext('2d')!;c.setTransform(600/W,0,0,855/H,0,0);c.fillStyle='white';c.fillRect(0,0,W,H);return c;};
    const a=paint(source.current);a.drawImage(rotated,0,0,W,H);
    if(rect){a.strokeStyle='#f2a3b6';a.lineWidth=15;a.strokeRect(...rect);}
    const b=paint(preview.current);
    if(rect){
      const [x,y,w,h]=rect,[rx,ry,rw,rh]=params.rect;
      b.save();b.translate(rx-x*rw/w,ry-y*rh/h);b.scale(rw/w,rh/h);b.drawImage(rotated,0,0,W,H);b.restore();
      b.strokeStyle='#00c88b';b.lineWidth=12;b.strokeRect(params.x1,params.y1,params.x2-params.x1,params.y2-params.y1);
    }
    if(reference.current&&referenceImage){
      const c=paint(reference.current);c.drawImage(referenceImage,0,0,W,H);c.strokeStyle='#f2a3b6';c.lineWidth=15;c.strokeRect(...params.rect);
    }
    rotated.width=rotated.height=0;
  },[image,referenceImage,rect,angle,params]);
  const select=(start:Point,end:Point)=>{
    const next:ManualPageAlignment['rect']=[Math.min(start.x,end.x),Math.min(start.y,end.y),Math.abs(end.x-start.x),Math.abs(end.y-start.y)];
    setRect(next);setError('');
  };
  const pointer=useCanvasPointer({mode,disabled:!image,coordinateSize:{width:W,height:H},viewport,onPreview:(a,b,drawing)=>{if(drawing)select(a,b);},onCommit:select});
  let valid=false;
  if(rect){try{validateManualAlignment({angle,rect});valid=true;}catch{}}
  return <div className="fixed inset-0 z-[80] bg-black/80 p-2 sm:p-4 flex items-center justify-center">
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="manual-alignment-title"
      onKeyDown={e=>{
        if(e.key==='Escape'){e.preventDefault();onCancel();}
        if(e.key==='Tab'){
          const elements=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),summary,[tabindex="0"]')||[]);
          const first=elements[0],last=elements[elements.length-1];
          if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog.current)){e.preventDefault();last?.focus();}
          else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
        }
      }} className="bg-[#240c10] text-white border border-[#571622] rounded-2xl max-w-6xl w-full max-h-[96dvh] overflow-y-auto p-3 sm:p-5">
      <h2 id="manual-alignment-title" className="font-bold text-xl">Align page {request.index+1} · {request.name}</h2>
      <p className="text-sm text-[#d8c7ca] my-2">{pageMode?'Draw around the whole sheet.':'Draw around the same printed area highlighted on the first-page reference.'} Check the preview before continuing.</p>
      <details className="text-sm mb-2"><summary className="cursor-pointer">Why alignment needs checking</summary>{request.message}</details>
      <div className="flex flex-wrap gap-2 items-center mb-2">
        <button aria-pressed={mode==='draw'&&view==='source'} className={`px-3 min-h-11 rounded-lg border border-[#571622] ${mode==='draw'&&view==='source'?'bg-[#8c1229]':''}`} onClick={()=>{setMode('draw');setView('source');}}>Draw</button>
        <button aria-pressed={mode==='pan'&&view==='source'} className={`px-3 min-h-11 rounded-lg border border-[#571622] ${mode==='pan'&&view==='source'?'bg-[#8c1229]':''}`} onClick={()=>{setMode('pan');setView('source');}}>Pan</button>
        <button aria-pressed={view==='preview'} disabled={!valid} className="px-3 min-h-11 rounded-lg border border-[#571622] disabled:opacity-40" onClick={()=>setView('preview')}>Preview</button>
        <button aria-label="Show first-page reference" aria-pressed={view==='reference'} disabled={!referenceImage} className="px-3 min-h-11 rounded-lg border border-[#571622] disabled:opacity-40" onClick={()=>setView(view==='reference'?'source':'reference')}>Reference</button>
      </div>
      <div className="flex gap-2 items-center mb-2">
        <button className="w-11 min-h-11 shrink-0 rounded-lg border border-[#571622]" onClick={()=>setZoom(Math.max(1,zoom-.5))} aria-label="Zoom out alignment">−</button>
        <button className="w-11 min-h-11 shrink-0 rounded-lg border border-[#571622]" onClick={()=>setZoom(Math.min(4,zoom+.5))} aria-label="Zoom in alignment">+</button>
        <label className="flex gap-1 items-center text-xs min-w-0 flex-1" title="Fine rotation"><span className="sr-only">Rotate</span><input className="min-w-0 w-12 flex-1" aria-label="Fine rotation" type="range" min="-15" max="15" step="0.1" value={angle} onChange={e=>{setAngle(Number(e.target.value));setRect(null);setView('source');}}/> {angle.toFixed(1)}°</label>
        {pageMode&&<button aria-label="Use full image" className="px-2 min-h-11 shrink-0 text-sm rounded-lg border border-[#571622]" onClick={()=>setRect([0,0,W,H])}>Full image</button>}
      </div>
      {error&&<p role="alert" className="text-rose-300">{error}</p>}
      {!image&&<p role="status">Loading page…</p>}
      <div className="grid md:grid-cols-2 gap-3">
        <section className={`min-w-0 ${view==='source'?'block':'hidden md:block'}`}><h3 className="text-sm mb-1">Select alignment area</h3><div ref={viewport} className="overflow-auto max-h-[55dvh] bg-[#150709] rounded-lg">
          <canvas aria-label="Draw manual alignment rectangle" ref={source} {...pointer} className="touch-none max-w-none block" style={{width:`${zoom*100}%`}}/>
        </div></section>
        <section className={`min-w-0 ${view==='source'?'hidden md:block':'block'}`}><h3 className="text-sm mb-1">{view==='reference'?'First-page reference · pink outline':'Registered preview · green answer area'}</h3>
          <canvas ref={preview} aria-label="Registered page preview" className={`${view==='reference'?'hidden':'block'} w-auto max-w-full max-h-[55dvh] mx-auto`}/>
          <canvas ref={reference} aria-label="First-page alignment reference" className={`${view==='reference'?'block':'hidden'} w-auto max-w-full max-h-[55dvh] mx-auto`}/>
        </section>
      </div>
      <div className="sticky bottom-0 bg-[#240c10] pt-3 mt-2 grid grid-cols-2 sm:flex sm:justify-between gap-2">
        <button onClick={onCancel} className="rounded-xl border border-[#571622] px-4 py-3">Cancel marking</button>
        <button disabled={!image} onClick={()=>onConfirm({skip:true,angle:0,rect:[0,0,W,H]})} className="rounded-xl border border-[#571622] disabled:opacity-40 px-3 py-3">Skip alignment</button>
        <button disabled={!valid||!image} onClick={()=>{if(rect)onConfirm({angle,rect});}} className="col-span-2 sm:ml-auto rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 px-4 py-3 font-semibold">Use alignment and continue</button>
      </div>
    </div>
  </div>;
}
