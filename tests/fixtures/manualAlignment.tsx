import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { ManualAlignmentDialog } from '../../src/components/ManualAlignmentDialog';
import { CalibrationStep } from '../../src/components/CalibrationStep';
const root=createRoot(document.getElementById('root')!);
(window as any).showManual=(file:any,params:any)=>{
  (window as any).confirmed=undefined;(window as any).cancelled=false;
  root.render(<ManualAlignmentDialog key={Math.random()} file={file} params={params} request={{index:1,name:'Test page',message:'Alignment contour does not match.'}}
    onConfirm={value=>{(window as any).confirmed=value;root.render(<p>Continued</p>);}}
    onCancel={()=>{(window as any).cancelled=true;root.render(<p>Cancelled</p>);}}/>);
};
function Calibration({file,initial}:{file:any;initial:any}){
  const [params,setParams]=useState(initial);
  (window as any).calibrationParams=params;
  return <CalibrationStep firstFile={file} params={params} onParamsChange={setParams} onBack={()=>{}} onProceedToMark={()=>{}}/>;
}
(window as any).showCalibration=(file:any,params:any)=>root.render(<Calibration file={file} initial={params}/>);
