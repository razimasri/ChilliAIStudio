import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { AmbiguityResolutionItem } from '../types';

interface AmbiguityModalProps {
  item: AmbiguityResolutionItem;
  currentIndex: number;
  totalCount: number;
  optionsCount?: number;
  onResolve: (choice: string) => void;
}

export const AmbiguityModal: React.FC<AmbiguityModalProps> = ({
  item,
  currentIndex,
  totalCount,
  optionsCount = 4,
  onResolve,
}) => {
  const choicesCount = item.choicesCount || optionsCount || 4;
  const letters = Array.from({ length: choicesCount }, (_, i) => String.fromCharCode(65 + i));

  if (!item) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#240c10] border-2 border-[#8c1529] rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[#571622] pb-3">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-semibold uppercase tracking-wider mb-1">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Ambiguous Mark Detected</span>
            </div>
            <h3 className="text-xl font-bold text-white">Clean Up Ambiguity</h3>
            <p className="text-xs text-[#b1a1a4] mt-0.5">
              Candidate: <span className="text-white font-semibold">{item.studentName || 'Student'}</span> • Question #{item.questionNumber}
            </p>
          </div>
          <span className="text-xs font-mono font-bold px-3 py-1 rounded-full bg-[#8c1529] text-white">
            {currentIndex + 1} of {totalCount}
          </span>
        </div>

        {/* Question Crop Snippet (1000 x 270 native crop) */}
        <div className="bg-[#110507] border border-[#571622] rounded-xl p-3 flex flex-col items-center justify-center">
          <p className="text-[11px] text-[#b1a1a4] mb-2 self-start font-medium">
            Scanned Question #{item.questionNumber} Snippet:
          </p>
          <div className="bg-white p-2 rounded-lg shadow-inner w-full flex items-center justify-center overflow-hidden">
            {item.cropDataUrl ? (
              <img
                src={item.cropDataUrl}
                alt={`Question ${item.questionNumber} snippet`}
                className="w-full max-h-48 object-contain rounded"
              />
            ) : (
              <div className="text-xs text-gray-500 font-mono py-4">No snippet preview available</div>
            )}
          </div>
        </div>

        {/* Options buttons matching Gui.py */}
        <div className="space-y-3">
          <p className="text-xs font-semibold text-[#fbe1e5]">
            Select the intended answer for Question #{item.questionNumber}:
          </p>

          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${choicesCount}, minmax(0, 1fr))` }}
          >
            {letters.map((letter) => (
              <button
                key={letter}
                onClick={() => onResolve(letter)}
                className="py-3.5 rounded-xl font-bold text-xl bg-[#571622] hover:bg-[#8c1529] text-white border border-[#8c1529] shadow-md transition-all active:scale-95 cursor-pointer"
              >
                {letter}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={() => onResolve('Unclear')}
              className="py-2.5 rounded-xl font-semibold text-sm bg-[#331118] hover:bg-[#4d1620] text-amber-300 border border-[#571622] transition active:scale-95 cursor-pointer"
            >
              Unclear
            </button>
            <button
              onClick={() => onResolve('Blank')}
              className="py-2.5 rounded-xl font-semibold text-sm bg-[#331118] hover:bg-[#4d1620] text-[#b1a1a4] border border-[#571622] transition active:scale-95 cursor-pointer"
            >
              Blank (No Mark)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
