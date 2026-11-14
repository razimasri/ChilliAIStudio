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
  annotatedDataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  originalDataUrl:'',hasAmbiguity:false,incomplete:[],
}));
if (new URLSearchParams(location.search).has('portrait')) {
  for (const student of students) {
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 1140;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 1140);
    ctx.fillStyle = 'black'; ctx.font = 'bold 32px sans-serif'; ctx.fillText(student.name, 50, 80);
    ctx.font = '24px sans-serif'; ctx.fillText(`Score ${student.score}/${student.total}`, 50, 125);
    for (let row = 0; row < 20; row++) {
      ctx.fillText(String(row + 1), 65, 220 + row * 40);
      for (let col = 0; col < 4; col++) ctx.strokeRect(140 + col * 100, 195 + row * 40, 65, 30);
    }
    student.annotatedDataUrl = canvas.toDataURL();
  }
}
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
