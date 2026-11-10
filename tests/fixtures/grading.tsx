import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResultsDashboard } from '../../src/components/ResultsDashboard';
import { calculateQuestionStats } from '../../src/utils/omrEngine';
import '../../src/index.css';
const root = createRoot(document.getElementById('root')!);
(window as any).showGradingResults = (student: any, answerKey: any) => root.render(React.createElement(ResultsDashboard,
  { students: [student], stats: calculateQuestionStats([student], answerKey), answerKey, onReset: () => {} } as any));
