import { PagePreview } from './PagePreview';
import React from 'react';
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react';
import { ExamFile } from '../types';

interface MarkingAnimationStepProps {
  files: ExamFile[];
  currentIndex: number;
  currentStudentName: string;
  progressPercent: number;
  statusText?: string;
  pageErrors?: string[];
  onBack?: () => void;
}

export const MarkingAnimationStep: React.FC<MarkingAnimationStepProps> = ({
  files,
  currentIndex,
  currentStudentName,
  progressPercent,
  statusText,
  pageErrors = [],
  onBack,
}) => {
  return (
    <div className="max-w-4xl mx-auto px-4 py-12 text-center space-y-6">
      {pageErrors.length > 0 && onBack && <button onClick={onBack} className="rounded-lg bg-[#8c1529] px-4 py-2 text-white">Back to upload</button>}
      {/* Animated Chilli Header */}
      <div className="relative inline-flex items-center justify-center">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-[#8c1529] to-[#571622] flex items-center justify-center shadow-2xl shadow-[#8c1529]/40 border-2 border-[#b1a1a4]/30 animate-pulse">
          <img src="/icons/Icon128.png" alt="ChilliMark logo" className="w-16 h-16 rounded-xl bg-white p-1 object-contain" />
        </div>
        <div className="absolute -bottom-2 px-3 py-0.5 rounded-full bg-[#18090b] border border-[#8c1529] text-[10px] uppercase font-bold text-[#f3b0ba]">
          ChilliMark Engine
        </div>
      </div>

      <div className="space-y-1">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
          Marking Scanned Worksheets...
        </h2>
        <p className="text-sm text-[#b1a1a4]">
          Analyzing page {Math.min(currentIndex + 1, files.length)} of {files.length}:{' '}
          <span className="text-white font-semibold">{currentStudentName}</span>
        </p>
        {statusText && (
          <p className="text-xs font-mono text-rose-300/80 animate-pulse pt-1">
            {statusText}
          </p>
        )}
      </div>

      {/* Progress bar */}
      <div className="max-w-md mx-auto space-y-2">
        <div className="w-full bg-[#1a080a] h-3 rounded-full overflow-hidden border border-[#571622] p-0.5">
          <div
            className="bg-gradient-to-r from-[#8c1529] via-[#b11b35] to-[#48bb78] h-full rounded-full transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-[#a39093]">
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            <span>Scanning contours & dark fill</span>
          </span>
          <span className="font-mono font-bold text-white">{progressPercent}%</span>
        </div>
      </div>

      {/* Diagnostic Error Readout Panel */}
      {pageErrors.length > 0 && (
        <div className="max-w-2xl mx-auto bg-amber-950/30 border border-amber-600/40 rounded-xl p-4 text-left space-y-2 text-xs">
          <div className="flex items-center gap-2 text-amber-400 font-bold">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Page Diagnostic Notice ({pageErrors.length} alert{pageErrors.length > 1 ? 's' : ''})</span>
          </div>
          <div className="space-y-1 font-mono text-amber-200/90 max-h-28 overflow-y-auto pr-1">
            {pageErrors.map((err, idx) => (
              <div key={idx} className="bg-black/40 px-2.5 py-1 rounded border border-amber-900/30">
                {err}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#a39093]">
            The batch process gracefully recorded affected scans and continues grading remaining pages.
          </p>
        </div>
      )}

      {/* Page thumbnail strip */}
      <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-6 shadow-xl max-w-2xl mx-auto">
        <h4 className="text-xs font-semibold text-[#b1a1a4] uppercase tracking-wider mb-4 text-left">
          Batch Processing Grid
        </h4>
        <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 gap-3 max-h-56 overflow-y-auto pr-1">
          {files.map((file, idx) => {
            const isDone = idx < currentIndex;
            const isCurrent = idx === currentIndex;

            return (
              <div
                key={file.id + idx}
                className={`relative aspect-[1/1.4] rounded-lg overflow-hidden border-2 transition-all duration-200 flex flex-col items-center justify-center ${
                  isDone
                    ? 'border-emerald-500 bg-emerald-950/40'
                    : isCurrent
                    ? 'border-[#8c1529] ring-2 ring-[#8c1529] scale-105 shadow-lg bg-[#3a0d15]'
                    : 'border-[#571622]/40 bg-[#18090b] opacity-50'
                }`}
              >
                <PagePreview
                  file={file}
                  alt={`Page ${idx + 1}`}
                  className="w-full h-full object-cover opacity-75"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 flex flex-col justify-between p-1">
                  <span className="text-[9px] font-mono font-bold text-white text-left">
                    #{idx + 1}
                  </span>
                  {isDone ? (
                    <span className="self-end text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    </span>
                  ) : isCurrent ? (
                    <span className="self-center text-white animate-spin">
                      <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full" />
                    </span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
