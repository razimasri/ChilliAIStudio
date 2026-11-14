import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResultsDashboard } from '../../src/components/ResultsDashboard';
import { calculateQuestionStats } from '../../src/utils/omrEngine';
import '../../src/index.css';
import { MarkingClient } from '../../src/utils/markingClient';
import { CalibrationParams, StudentResult } from '../../src/types';
const answerKey = {0:'A',1:'B',2:'E',3:'A',4:'B'};
const students: StudentResult[] = [
  ['Alice',2,['A','C','E','Blank',false]],
  ['Bob',2,['B','B','A','A','Unclear']],
  ['Zoë, "Q"\nX',1,['A']],
].map(([name,score,responses],index) => ({
  id:String(index), index, name:name as string, score:score as number, total:5, percentage:Number(score)*20,
  responses:responses as (string|false)[],
  questions:(responses as (string|false)[]).map((response,number)=>({number,response,boxes:[],response_box:null})),
  annotatedDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  originalDataUrl:'',hasAmbiguity:false,incomplete:[],
}));
const pendingMode = new URLSearchParams(location.search).has('pending');
if (pendingMode) {
  students[0].annotationPending = true;
  students[0].rawDeskewedDataUrl = students[0].annotatedDataUrl;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  Object.assign(window, {releaseAnnotation: release});
  MarkingClient.prototype.annotate = async student => {
    await gate;
    return student.rawDeskewedDataUrl!;
  };
}
const params = pendingMode ? {} as CalibrationParams : undefined;
createRoot(document.getElementById('root')!).render(<React.StrictMode><ResultsDashboard students={students} params={params} stats={calculateQuestionStats(students,answerKey,5)} answerKey={answerKey} onReset={()=>{}}/></React.StrictMode>);
