import { Dialog } from './Dialog';
import type { PdfProgressInfo } from '../utils/pdfProcessor';
export function PdfLoadingOverlay({
  progress,
}: {
  progress: PdfProgressInfo | null;
  fileCount: number;
}) {
  const percent = Math.max(0, Math.min(100, progress?.percent || 0));
  return (
    <Dialog titleId="loading-title" className="max-w-md p-6 space-y-4">
      <div className="flex items-center gap-3">
        <img
          src="/icons/Icon128.png"
          alt="ChilliMark logo"
          className="w-11 h-11 rounded-lg bg-white p-1"
        />
        <h2 id="loading-title" className="text-xl font-bold">
          Reading your scans
        </h2>
      </div>
      <p
        role="status"
        aria-live="polite"
        className="text-sm text-[#d8c7ca] break-words"
      >
        {progress?.message || 'Reading page information…'}
      </p>
      <progress
        aria-label="File preparation"
        max={100}
        value={percent}
        className="w-full h-3 accent-[#8c1529]"
      />
      <p className="text-sm text-[#b1a1a4]">
        Previews load as needed. Full-resolution pages are prepared during
        calibration and marking.
      </p>
    </Dialog>
  );
}
