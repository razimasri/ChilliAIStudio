import React from 'react';
import { X, CheckCircle } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#240c10] border border-[#571622] rounded-2xl max-w-xl w-full max-h-[85vh] overflow-y-auto p-6 space-y-5 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#571622] pb-3">
          <div className="flex items-center gap-2">
            <img src="/icons/Icon128.png" alt="ChilliMark logo" className="w-8 h-8 rounded bg-white p-0.5 object-contain" />
            <h3 className="text-lg font-bold text-white">ChilliMark Guide</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#b1a1a4] hover:text-white hover:bg-[#571622]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4 text-xs text-[#e5cbd0] leading-relaxed">
          <div>
            <h4 className="font-bold text-white text-sm mb-1">How ChilliMark Works</h4>
            <p>
              ChilliMark uses a heuristic Optical Mark Recognition (OMR) algorithm tailored for
              standard Cambridge IGCSE and IBDP science multiple choice sheets. Unlike older OMR
              systems, it requires no special QR codes or black alignment squares.
            </p>
          </div>

          <div className="space-y-2">
            <h4 className="font-bold text-white text-sm">Recommended Workflow</h4>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                <strong className="text-white">Scan your exam papers:</strong> 300 to 600 DPI is
                recommended. Auto-feed scanners work great.
              </li>
              <li>
                <strong className="text-white">Load PDF or images:</strong> Drag & drop your scanned
                file. You can also click "Load 10 Demo Scanned Exams" to see it in action
                instantly.
              </li>
              <li>
                <strong className="text-white">Enter Candidate Names & Answer Key:</strong> Make
                sure the student names match the order of the pages in your scan.
              </li>
              <li>
                <strong className="text-white">Calibrate Question Area & One Empty Box:</strong> Frame
                the question area using the fine-tuning handles or nudge controls, and click on one clean empty
                bubble to sample it. ChilliMark uses this template to derive bubble dimensions and baseline paper
                reflectance directly from the scan.
              </li>
              <li>
                <strong className="text-white">Resolve Ambiguities:</strong> If a student shaded two
                boxes or made an incomplete erasure, you will be prompted to pick the correct one.
              </li>
              <li>
                <strong className="text-white">Review & Export:</strong> Inspect annotated sheets
                with green/red marks and download CSV spreadsheets for report cards and item response
                statistics.
              </li>
            </ol>
          </div>

          <div className="p-3.5 rounded-xl bg-[#1a080a] border border-[#571622] text-[#fbe1e5] space-y-1">
            <div className="flex items-center gap-1.5 font-semibold text-emerald-400">
              <CheckCircle className="w-4 h-4" />
              <span>Scanning Tips</span>
            </div>
            <p className="text-[11px] text-[#b1a1a4]">
              Advise students to shade with HB pencils or dark pens. Light pencil or incomplete
              erasures can be adjusted by changing the "Mark Threshold" slider in settings.
            </p>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#8c1529] hover:bg-[#a01830] text-white text-xs font-bold transition-colors"
          >
            Got it, Let's Mark!
          </button>
        </div>
      </div>
    </div>
  );
};
