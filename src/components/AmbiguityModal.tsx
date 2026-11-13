import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { AmbiguityResolutionItem } from '../types';
interface AmbiguityModalProps {
  item: AmbiguityResolutionItem;
  currentIndex: number;
  totalCount: number;
  optionsCount?: number;
  onResolve: (choice: string) => void;
  onBack?: () => void;
  onCancel?: () => void;
  onNext?: () => void;
  backgroundStatus?: string;
}
export function AmbiguityModal({
  item,
  currentIndex,
  totalCount,
  optionsCount = 4,
  onResolve,
  onBack,
  onCancel,
  onNext,
  backgroundStatus,
}: AmbiguityModalProps) {
  const choice = item.currentResponse;
  const [zoom, setZoom] = useState(1);
  useEffect(
    () => setZoom(1),
    [currentIndex, item.studentIndex, item.questionNumber],
  );
  const choose = (value: string) => onResolve(value);
  const letters = Array.from(
    { length: item.choicesCount || optionsCount },
    (_, i) => String.fromCharCode(65 + i),
  );
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat)
        return;
      const target = event.target as HTMLElement;
      if (target?.closest('input, textarea, select, [contenteditable="true"]'))
        return;
      const letter = event.key.toUpperCase();
      if (letters.includes(letter)) {
        event.preventDefault();
        onResolve(letter);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [item.studentIndex, item.questionNumber, letters.join(''), onResolve]);
  return (
    <Dialog titleId="review-title" className="max-w-2xl p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-amber-300">
            Answer review · {currentIndex + 1} of {totalCount} available
          </p>
          <h2 id="review-title" className="text-xl font-bold">
            {item.studentName} · Question {item.questionNumber}
          </h2>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="min-h-11 px-2 text-sm text-[#b1a1a4]"
          >
            Cancel review
          </button>
        )}
      </div>
      <p role="status" className="text-sm text-emerald-300">
        {backgroundStatus}
      </p>
      {item.reviewReason === 'no-mark' && <p className="rounded-lg border border-amber-800/60 bg-amber-950/30 p-3 text-sm text-amber-200">No mark was detected for this question. Check for light pencil, or choose Blank if it is unanswered.</p>}
      <p className="text-sm text-[#b1a1a4]">
        Click or tap an answer on the scan, or press its letter, to save it and
        go next. Previous lets you revise a decision. Use Unclear if you cannot
        determine the intended answer.
      </p>
      <div
        className="flex justify-end items-center gap-2"
        role="group"
        aria-label="Snippet zoom"
      >
        <button
          onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          disabled={zoom === 1}
          aria-label="Zoom snippet out"
          className="min-w-11 min-h-11 rounded-lg bg-[#571622] disabled:opacity-40"
        >
          −
        </button>
        <span className="text-sm">{Math.round(zoom * 100)}%</span>
        <button
          onClick={() => setZoom((z) => Math.min(5, z + 0.5))}
          disabled={zoom === 5}
          aria-label="Zoom snippet in"
          className="min-w-11 min-h-11 rounded-lg bg-[#571622] disabled:opacity-40"
        >
          +
        </button>
      </div>
      <div
        className="overflow-auto max-h-64 rounded-xl bg-white p-2"
        tabIndex={0}
        aria-label="Scanned answer snippet"
      >
        {item.cropDataUrl ? (
          <div className="relative" style={{ width: `${zoom * 100}%` }}>
            <img
              src={item.cropDataUrl}
              alt={`Question ${item.questionNumber} snippet`}
              className="block w-full max-w-none h-auto"
            />
            <div
              className="absolute inset-0"
              role="group"
              aria-label="Choose an answer on the scan"
            >
              {(
                item.answerRegions ||
                letters.map((letter, index) => ({
                  letter,
                  left: index / letters.length,
                  width: 1 / letters.length,
                }))
              ).map((region) => (
                <button
                  key={region.letter}
                  aria-label={`Choose ${region.letter} on scan`}
                  aria-pressed={choice === region.letter}
                  onClick={() => choose(region.letter)}
                  className="absolute inset-y-0 bg-black/0 hover:bg-black/30 focus-visible:bg-black/30 active:bg-black/40 transition-colors"
                  style={{
                    left: `${region.left * 100}%`,
                    width: `${region.width * 100}%`,
                  }}
                >
                  <span className="absolute bottom-0 inset-x-0 bg-black/65 text-white text-xs py-0.5">
                    {region.letter}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-black text-sm">
            No snippet available. Press an answer letter or choose Unclear.
          </p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {['Unclear', 'Blank'].map((value) => (
          <button
            key={value}
            aria-pressed={choice === value}
            onClick={() => choose(value)}
            className={`min-h-12 rounded-xl border text-sm ${choice === value ? 'bg-[#8c1529] border-white' : 'bg-[#18090b] border-[#571622]'}`}
          >
            {value === 'Blank' ? 'Blank (no mark)' : value}
          </button>
        ))}
      </div>
      <div className="flex justify-between gap-3">
        <button
          onClick={() => {
            onBack?.();
          }}
          disabled={!onBack || currentIndex === 0}
          className="min-h-12 px-4 rounded-xl bg-[#571622] disabled:opacity-40"
        >
          Previous
        </button>
        {choice && (
          <button
            onClick={onNext}
            className="min-h-12 px-4 rounded-xl bg-[#8c1529]"
          >
            Next
          </button>
        )}
      </div>
    </Dialog>
  );
}
