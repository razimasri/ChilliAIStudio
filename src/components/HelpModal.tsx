import { X } from 'lucide-react';
import { Dialog } from './Dialog';
import { APP_VERSION, RELEASE_NAME } from '../utils/release';
export function HelpModal({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      titleId="guide-title"
      onClose={onClose}
      className="max-w-2xl p-5 sm:p-6 space-y-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <img
              src="/icons/Icon128.png"
              alt="ChilliMark logo"
              className="w-8 h-8 rounded bg-white p-0.5"
            />
            <h2 id="guide-title" className="font-bold text-xl">
              ChilliMark Guide
            </h2>
          </div>
          <p className="text-sm text-[#b1a1a4]">
            v{APP_VERSION} {RELEASE_NAME}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close guide"
          className="min-h-11 min-w-11 rounded-lg hover:bg-[#571622]"
        >
          <X className="w-5 h-5 mx-auto" />
        </button>
      </div>
      <p className="text-sm text-[#d8c7ca]">
        Mark Cambridge IGCSE and IBDP multiple-choice sheets without QR codes or
        printed alignment markers.
      </p>
      <ol className="list-decimal pl-5 space-y-4 text-sm text-[#d8c7ca]">
        <li>
          <strong className="text-white">Load your scans.</strong> Choose PDF,
          PNG or JPEG files, or use a sample. Scan at 600 DPI where possible.
          Sample PDFs include their own names and answer keys: 27 answers for
          IGCSE, 30 for IBDP.
        </li>
        <li>
          <strong className="text-white">Check names and answers.</strong> Enter
          one name per page, in page order, or leave names empty to use Student
          01, Student 02, and so on. Enter one answer letter per question;
          spaces and line breaks are ignored. Check the page preview before
          continuing.
        </li>
        <li>
          <strong className="text-white">Select the question area.</strong> Drag
          around the complete answer grid on the first page using a mouse,
          finger or pen. Review the rectangle, then choose “Next: Select Box”.
          Use Pan to move a zoomed page and the zoom buttons to magnify it.
        </li>
        <li>
          <strong className="text-white">Select one empty box.</strong> In Draw
          mode, drag around one clean, unmarked answer box. A little surrounding
          space is fine; the outline snaps to the box. Box view opens close up;
          Fit shows the whole grid. Wait for “Empty box ready”, then choose
          “Mark Exams”. If selection fails, zoom in and try another empty box.
        </li>
        <li>
          <strong className="text-white">Review ambiguous answers.</strong>{' '}
          Review starts as pages become available while marking continues. Click
          or tap an answer on the scan, or choose its letter, Blank or Unclear.
          Your choice saves and goes next immediately. Previous revisits a
          decision. When all pages and corrections are ready, choose View
          results. Cancel review returns to setup.
        </li>
        <li>
          <strong className="text-white">Review and export.</strong> Results
          open on Overall statistics. Use Student scores or Marked sheets for
          individual results. Export the class report, item statistics or ZIP; a
          single sheet can be downloaded or printed in Marked sheets.
        </li>
      </ol>
      <p className="text-sm text-[#b1a1a4]">
        Parallel marking offers Auto, 1, 2 or 4 workers. Auto limits workers
        using CPU, memory and scan size, then tests extra workers during longer
        exams. It keeps them only when measured throughput improves.
      </p>
      <div className="rounded-xl bg-[#18090b] p-4 text-sm text-[#b1a1a4]">
        Use clear, dark marks and avoid faint scans or heavy erasures.
        ChilliMark learns the box shape and paper background from the empty box
        you select. Marking runs in the background; Cancel marking stops the
        batch and returns to setup.
      </div>
      <button
        onClick={onClose}
        className="min-h-11 w-full sm:w-auto px-5 rounded-xl bg-[#8c1529] font-semibold"
      >
        Got it
      </button>
    </Dialog>
  );
}
