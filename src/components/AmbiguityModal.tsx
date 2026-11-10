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
}
export function AmbiguityModal({
  item,
  currentIndex,
  totalCount,
  optionsCount = 4,
  onResolve,
  onBack,
  onCancel,
}: AmbiguityModalProps) {
  const [choice, setChoice] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    setChoice(item.currentResponse || null);
    setZoom(1);
  }, [
    currentIndex,
    item.studentIndex,
    item.questionNumber,
    item.currentResponse,
  ]);
  const letters = Array.from(
    { length: item.choicesCount || optionsCount },
    (_, i) => String.fromCharCode(65 + i),
  );
  return (
    <Dialog titleId="review-title" className="max-w-2xl p-4 sm:p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-amber-300">
            Answer review · {currentIndex + 1} of {totalCount}
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
      <p className="text-sm text-[#b1a1a4]">
        More than one answer was detected. Select your decision, then confirm.
        Use Unclear if the intended answer cannot be determined.
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
          <img
            src={item.cropDataUrl}
            alt={`Question ${item.questionNumber} snippet`}
            className="max-w-none h-auto"
            style={{ width: `${zoom * 100}%` }}
          />
        ) : (
          <p className="text-black text-sm">No snippet available.</p>
        )}
      </div>
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.min(letters.length, 5)},minmax(0,1fr))`,
        }}
      >
        {letters.map((letter) => (
          <button
            key={letter}
            aria-pressed={choice === letter}
            onClick={() => setChoice(letter)}
            className={`min-h-12 rounded-xl font-bold text-lg border ${choice === letter ? 'bg-[#8c1529] border-white' : 'bg-[#571622] border-[#8c1529]'}`}
          >
            {letter}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {['Unclear', 'Blank'].map((value) => (
          <button
            key={value}
            aria-pressed={choice === value}
            onClick={() => setChoice(value)}
            className={`min-h-12 rounded-xl border text-sm ${choice === value ? 'bg-[#8c1529] border-white' : 'bg-[#18090b] border-[#571622]'}`}
          >
            {value === 'Blank' ? 'Blank (no mark)' : value}
          </button>
        ))}
      </div>
      <p role="status" className="text-sm text-[#b1a1a4]">
        {choice
          ? `Selected: ${choice}. Confirm to save this decision.`
          : 'Choose an answer above.'}
      </p>
      <div className="flex justify-between gap-3">
        <button
          onClick={onBack}
          disabled={!onBack || currentIndex === 0}
          className="min-h-12 px-4 rounded-xl bg-[#571622] disabled:opacity-40"
        >
          Back
        </button>
        <button
          disabled={!choice}
          onClick={() => choice && onResolve(choice)}
          className="min-h-12 px-4 rounded-xl bg-[#8c1529] font-bold disabled:opacity-40"
        >
          {currentIndex + 1 === totalCount
            ? 'Confirm & finish'
            : 'Confirm & next'}
        </button>
      </div>
    </Dialog>
  );
}
