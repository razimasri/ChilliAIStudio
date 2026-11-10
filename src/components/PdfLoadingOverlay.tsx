import React from 'react';
import { Sparkles, FileText, CheckCircle2, Layers } from 'lucide-react';
import { PdfProgressInfo } from '../utils/pdfProcessor';

interface PdfLoadingOverlayProps {
  progress: PdfProgressInfo | null;
  fileCount?: number;
}

export const PdfLoadingOverlay: React.FC<PdfLoadingOverlayProps> = ({
  progress,
  fileCount = 1,
}) => {
  const percent = Math.min(100, Math.max(5, progress?.percent ?? 15));
  const currentPage = progress?.currentPage ?? 1;
  const totalPages = progress?.totalPages ?? 1;
  const isCompleted = percent >= 100 || progress?.stage === 'completed';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md transition-all duration-300">
      <div className="relative w-full max-w-lg bg-[#240c10] border-2 border-[#8c1529] rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden flex flex-col items-center text-center">
        {/* Ambient background glow */}
        <div className="absolute -top-24 -left-24 w-64 h-64 bg-[#8c1529]/25 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -right-24 w-64 h-64 bg-[#f3b0ba]/15 rounded-full blur-3xl pointer-events-none" />

        {/* Top Header Badge */}
        <div className="flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#18090b] border border-[#571622] text-xs font-mono text-[#f3b0ba] mb-6 shadow-inner">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-ping" />
          <span className="font-semibold tracking-wide uppercase">
            {isCompleted ? 'Processing Complete' : 'Digital OMR Ingestion Active'}
          </span>
        </div>

        {/* Animated Document Scanner Viewport */}
        <div className="relative w-48 sm:w-56 aspect-[3/4] bg-[#140608] border border-[#571622] rounded-xl shadow-2xl overflow-hidden p-3.5 flex flex-col justify-between mb-6 group">
          {/* Mock Document Header */}
          <div className="space-y-1.5 border-b border-[#3b1219] pb-2 text-left">
            <div className="flex items-center justify-between">
              <div className="h-2 w-20 bg-[#571622] rounded-full" />
              <div className="h-2 w-8 bg-[#8c1529]/60 rounded-full" />
            </div>
            <div className="h-1.5 w-32 bg-[#331016] rounded-full" />
          </div>

          {/* Simulated OMR Rows with bubbles (A, B, C, D) */}
          <div className="flex-1 py-3 space-y-2.5 opacity-65 flex flex-col justify-center">
            {[1, 2, 3, 4, 5, 6].map((row) => (
              <div key={row} className="flex items-center justify-between text-[8px] font-mono text-[#8c505b]">
                <span className="w-3 text-left font-bold text-[#b1a1a4]">{row}</span>
                <div className="flex items-center gap-1.5 sm:gap-2">
                  {['A', 'B', 'C', 'D'].map((letter, optIdx) => {
                    // Mark some bubbles as filled on mock doc
                    const isFilled = (row === 1 && optIdx === 1) || (row === 3 && optIdx === 0) || (row === 5 && optIdx === 2);
                    return (
                      <div
                        key={letter}
                        className={`w-3.5 h-3.5 sm:w-4 sm:h-4 rounded-sm border flex items-center justify-center transition-colors ${
                          isFilled
                            ? 'bg-[#f3b0ba] border-[#f3b0ba] text-[#18090b] font-black'
                            : 'border-[#571622] bg-[#1a0b0e] text-[#7a2e3b]'
                        }`}
                      >
                        {letter}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Mock Document Footer with timing bar */}
          <div className="border-t border-[#3b1219] pt-2 flex items-center justify-between">
            <div className="flex gap-0.5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="w-1.5 h-1.5 bg-[#8c1529] rounded-xs" />
              ))}
            </div>
            <span className="text-[9px] font-mono text-[#8c505b]">600 DPI</span>
          </div>

          {/* Animated Laser Scanning Beam & Gradient Trail */}
          <div className="absolute inset-x-0 h-10 -top-10 pointer-events-none animate-laser-scan">
            {/* The razor-thin laser line */}
            <div className="h-[2.5px] w-full bg-gradient-to-r from-transparent via-[#ff3b5c] to-transparent shadow-[0_0_15px_3px_#ff0044,0_0_30px_6px_#ff3b5c]" />
            {/* The sweeping laser light cone / beam wash */}
            <div className="h-10 w-full bg-gradient-to-b from-[#ff0044]/35 via-[#ff3b5c]/10 to-transparent" />
          </div>

          {/* Optical Grid Overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage:
                'radial-gradient(circle, #f3b0ba 1px, transparent 1px)',
              backgroundSize: '12px 12px',
            }}
          />
        </div>

        {/* Center Progress Ring & Status */}
        <div className="w-full space-y-4">
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 text-white font-black text-xl sm:text-2xl mb-1 tracking-tight">
              {isCompleted ? (
                <>
                  <CheckCircle2 className="w-6 h-6 text-green-400" />
                  <span>Ready to Calibrate!</span>
                </>
              ) : (
                <>
                  <Layers className="w-6 h-6 text-[#f3b0ba] animate-bounce" />
                  <span>Rasterizing & Scanning PDF</span>
                </>
              )}
            </div>

            <p className="text-xs sm:text-sm text-[#b1a1a4] font-medium max-w-sm">
              {progress?.message || 'Extracting high-resolution pages for contour detection...'}
            </p>
          </div>

          {/* Progress Bar Container */}
          <div className="space-y-1.5 w-full">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-[#f3b0ba] font-semibold flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" />
                <span className="truncate max-w-[220px]">
                  {progress?.fileName || 'Exam_Document.pdf'}
                </span>
              </span>
              <span className="text-white font-bold">{percent}%</span>
            </div>

            {/* Glowing Custom Progress Bar */}
            <div className="h-3 w-full bg-[#18090b] rounded-full border border-[#571622] overflow-hidden p-0.5 shadow-inner">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8c1529] via-[#d62846] to-[#ff4d6d] transition-all duration-200 relative overflow-hidden shadow-[0_0_12px_#ff0044]"
                style={{ width: `${percent}%` }}
              >
                {/* Diagonal animated stripes */}
                <div
                  className="absolute inset-0 opacity-40 animate-pulse"
                  style={{
                    backgroundImage:
                      'linear-gradient(45deg, rgba(255,255,255,0.25) 25%, transparent 25%, transparent 50%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0.25) 75%, transparent 75%, transparent)',
                    backgroundSize: '16px 16px',
                  }}
                />
              </div>
            </div>

            {/* Page Count Indicator */}
            <div className="flex items-center justify-between text-[11px] text-[#8c505b] pt-0.5">
              <span>
                {totalPages > 1 ? `Page ${currentPage} of ${totalPages}` : `${fileCount} file${fileCount > 1 ? 's' : ''}`}
              </span>
              <span className="flex items-center gap-1 text-[#f3b0ba]">
                <Sparkles className="w-3 h-3 text-amber-400" />
                <span>600 DPI page rendering</span>
              </span>
            </div>
          </div>

          {/* Info Pill */}
          <div className="pt-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-[#1c080b] border border-[#571622] text-[11px] text-[#b1a1a4]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#ff3b5c]" />
              <span>Preserving page dimensions for scan alignment</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
