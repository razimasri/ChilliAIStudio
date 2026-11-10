import React from 'react';
import { APP_VERSION, RELEASE_NAME } from '../utils/release';
import { Sparkles, HelpCircle } from 'lucide-react';

interface HeaderProps {
  currentStep: number;
  onShowHelp?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ currentStep, onShowHelp }) => {
  const steps = [
    { num: 1, label: 'Setup' },
    { num: 2, label: 'Calibration' },
    { num: 3, label: 'Marking' },
    { num: 4, label: 'Results & Stats' },
  ];

  return (
    <header className="border-b border-[#571622]/60 bg-[#240c10]/90 backdrop-blur-md sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8c1529] to-[#571622] flex items-center justify-center shadow-lg shadow-[#8c1529]/20 border border-[#b1a1a4]/20">
            <img
              src="/icons/Icon128.png"
              alt="ChilliMark logo"
              className="w-10 h-10 rounded-lg bg-white p-1 object-contain"
            />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2">
              <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-1.5">
                ChilliMark
              </h1>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-[#8c1529]/40 text-[#f3b0ba] border border-[#8c1529]/60">
                v{APP_VERSION} {RELEASE_NAME}
              </span>
            </div>
            <p className="text-xs text-[#b1a1a4] hidden sm:block truncate">
              Multiple-choice marking for IBDP & Cambridge IGCSE
            </p>
          </div>
        </div>

        {/* Step indicator */}
        <div className="hidden xl:flex items-center gap-1 bg-[#18090b]/80 p-1 rounded-full border border-[#571622]/50">
          {steps.map((step) => {
            const isActive = currentStep === step.num;
            const isDone = currentStep > step.num;
            return (
              <div
                key={step.num}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-[#8c1529] text-white shadow-md shadow-[#8c1529]/30'
                    : isDone
                      ? 'text-[#48bb78] hover:text-[#38a169]'
                      : 'text-[#8a7a7d]'
                }`}
              >
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                    isActive
                      ? 'bg-white text-[#8c1529]'
                      : isDone
                        ? 'bg-[#48bb78]/20 text-[#48bb78]'
                        : 'bg-[#571622]/40 text-[#8a7a7d]'
                  }`}
                >
                  {isDone ? '✓' : step.num}
                </span>
                <span>{step.label}</span>
              </div>
            );
          })}
        </div>

        {/* Action / Help */}
        <div className="flex items-center gap-3">
          {onShowHelp && (
            <button
              onClick={onShowHelp}
              aria-label="Guide"
              className="min-h-11 min-w-11 flex items-center gap-1.5 text-sm text-[#d8c7ca] hover:text-white bg-[#571622]/40 hover:bg-[#571622] px-3 py-1.5 rounded-lg border border-[#571622] transition-colors"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Guide</span>
            </button>
          )}
          <div className="text-xs text-[#f3b0ba]/80 bg-[#8c1529]/20 px-2.5 py-1 rounded-md border border-[#8c1529]/30 hidden 2xl:flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#f3b0ba]" />
            <span>No QR or Predefined Templates Required</span>
          </div>
        </div>
      </div>
    </header>
  );
};
