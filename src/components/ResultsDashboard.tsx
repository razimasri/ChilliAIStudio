import React, { useState, useEffect, useRef } from 'react';
import {
  Download,
  FileSpreadsheet,
  RotateCcw,
  CheckCircle,
  XCircle,
  BarChart3,
  Award,
  Users,
  Search,
  Coffee,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Printer,
  FolderDown,
  Loader2,
} from 'lucide-react';
import confetti from 'canvas-confetti';
import { exportAnnotatedPdf } from '../utils/exportPdf';
import { exportArchive, ArchiveEntry } from '../utils/exportArchive';
import { StudentResult, QuestionStat } from '../types';
import {
  exportStudentScoresCsv,
  exportQuestionStatsCsv,
} from '../utils/omrEngine';

interface ResultsDashboardProps {
  students: StudentResult[];
  stats: QuestionStat[];
  answerKey: Record<number, string>;
  onReset: () => void;
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({
  students,
  stats,
  answerKey,
  onReset,
}) => {
  const [activeTab, setActiveTab] = useState<'sheets' | 'roster' | 'itemStats'>(
    'itemStats',
  );
  const [selectedStudentIdx, setSelectedStudentIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [sheetZoom, setSheetZoom] = useState(1);
  const tabsRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const previousTab = useRef(activeTab);
  useEffect(() => {
    if (previousTab.current !== activeTab)
      panelRef.current?.scrollIntoView({ block: 'start' });
    previousTab.current = activeTab;
  }, [activeTab]);
  useEffect(() => setSheetZoom(1), [selectedStudentIdx]);
  const [isPdf, setIsPdf] = useState(false);
  const pdfCache = useRef<{students: StudentResult[]; stats: QuestionStat[]; key: Record<number,string>; blob: Blob}>();
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);
  const [zipError, setZipError] = useState<string | null>(null);
  const zipController = useRef<AbortController>();
  useEffect(() => () => zipController.current?.abort(), []);

  // Fire celebratory confetti on initial load
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8c1529', '#00713e', '#f59e0b', '#ffffff'],
    });
  }, []);

  const currentStudent = students[selectedStudentIdx] || students[0];
  const alignmentChecks = students.filter((student) => student.geometryCheck);
  const alignedBoxes = alignmentChecks.reduce(
    (sum, student) => sum + (student.geometryCheck?.boxesTracked || 0),
    0,
  );
  const adjustedBoxes = alignmentChecks.reduce(
    (sum, student) => sum + (student.geometryCheck?.adjustments.length || 0),
    0,
  );

  // Class statistics calculations
  const totalStudents = students.length;
  const avgScore =
    totalStudents > 0
      ? (students.reduce((sum, s) => sum + s.score, 0) / totalStudents).toFixed(
          1,
        )
      : '0';
  const totalQuestions =
    stats.length || Object.keys(answerKey).length || currentStudent?.total || 0;
  const options = [
    ...new Set(
      stats.flatMap((q) =>
        Object.keys(q.distribution).filter((k) => /^[A-Z]$/.test(k)),
      ),
    ),
  ].sort();
  const avgPercent =
    totalStudents > 0
      ? Math.round(
          students.reduce((sum, s) => sum + s.percentage, 0) / totalStudents,
        )
      : 0;

  const highestScore = Math.max(...students.map((s) => s.score), 0);
  const lowestScore = students.length
    ? Math.min(...students.map((s) => s.score))
    : 0;
  const passCount = students.filter((s) => s.percentage >= 50).length;
  const passRate =
    totalStudents > 0 ? Math.round((passCount / totalStudents) * 100) : 0;

  // CSV download handlers
  const handleDownloadScoresCsv = () => {
    const csvContent = exportStudentScoresCsv(students, answerKey);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ChilliMark-Student-Scores.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleDownloadStatsCsv = () => {
    const csvContent = exportQuestionStatsCsv(stats);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ChilliMark-Question-Statistics.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // Download a single student's marked work
  const handleDownloadSingleSheet = (student: StudentResult) => {
    if (!student) return;
    const link = document.createElement('a');
    link.href = student.annotatedDataUrl;
    const safeName = student.name.replace(/\s+/g, '_');
    link.download = `${safeName}_Score_${student.score}of${student.total}_Marked.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getPdf = async (controller: AbortController) => {
    if (pdfCache.current?.students === students && pdfCache.current.key === answerKey && pdfCache.current.stats === stats)
      return pdfCache.current.blob;
    const blob = await exportAnnotatedPdf({
      students: students.map(({name, score, total, percentage, responses, annotatedDataUrl}) =>
        ({name, score, total, percentage, responses, annotatedDataUrl})), stats, answerKey,
    }, percent => setZipProgress(Math.round(percent)), controller.signal);
    pdfCache.current = {students, stats, key: answerKey, blob};
    return blob;
  };
  const handleDownloadPdf = async () => {
    if (!students.length || isZipping || isPdf) return;
    setIsPdf(true); setZipProgress(0); setZipError(null);
    const controller = new AbortController(); zipController.current = controller;
    try {
      const blob = await getPdf(controller);
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'ChilliMark_Annotated_Report.pdf'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      if (!controller.signal.aborted) setZipError(error instanceof Error ? error.message : 'Could not create PDF.');
    } finally { if (!controller.signal.aborted) { setIsPdf(false); setZipProgress(0); } }
  };

  // Batch download all student marked works as a clean ZIP package
  const handleDownloadAllZip = async () => {
    if (students.length === 0 || isZipping || isPdf) return;
    setIsZipping(true);
    setZipError(null);
    setZipProgress(0);

    const controller = new AbortController();
    zipController.current = controller;
    try {
      const folder = 'ChilliMark_Annotated_Student_Sheets/';
      const entries: ArchiveEntry[] = [{ name: folder + 'ChilliMark_Annotated_Report.pdf', data: await getPdf(controller) }];
      setZipProgress(0);
      for (const [idx, student] of students.entries()) {
        const safeName = student.name.replace(/\s+/g, '_');
        const prefix = String(idx + 1).padStart(2, '0');
        const response = await fetch(student.annotatedDataUrl, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(`Could not read marked sheet for ${student.name}`);
        entries.push({
          name: `${folder}${prefix}_${safeName}_Score_${student.score}of${student.total}.png`,
          data: await response.blob(),
        });
      }
      entries.push({
        name: folder + 'Class_Scores_Summary.csv',
        data: exportStudentScoresCsv(students, answerKey),
      });
      entries.push({
        name: folder + 'Question_Statistics.csv',
        data: exportQuestionStatsCsv(stats),
      });
      const content = await exportArchive(
        entries,
        (percent) => setZipProgress(Math.round(percent)),
        controller.signal,
      );
      controller.signal.throwIfAborted();

      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ChilliMark_All_${students.length}_Annotated_Sheets.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      if (!controller.signal.aborted)
        setZipError(
          err instanceof Error ? err.message : 'Could not create ZIP archive.',
        );
    } finally {
      if (!controller.signal.aborted) {
        setIsZipping(false);
        setZipProgress(0);
      }
    }
  };

  // High-fidelity student sheet print utility
  const handlePrintSheet = (student: StudentResult) => {
    if (!student) return;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>ChilliMark - ${student.name}</title>
            <style>
              @page { size: auto; margin: 8mm; }
              body { margin: 0; padding: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; background: white; font-family: system-ui, sans-serif; }
              .header { font-size: 15px; font-weight: bold; margin-bottom: 10px; color: #111; }
              img { max-width: 100%; max-height: 94vh; object-fit: contain; }
            </style>
          </head>
          <body>
            <div class="header">${student.name} — Score: ${student.score}/${student.total} (${student.percentage}%)</div>
            <img src="${student.annotatedDataUrl}" onload="setTimeout(() => { window.focus(); window.print(); }, 150);" />
          </body>
        </html>
      `);
      doc.close();
      setTimeout(() => {
        try {
          document.body.removeChild(iframe);
        } catch {}
      }, 60000);
    }
  };

  // Filter students
  const filteredStudents = students.filter((s) =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {zipError && (
        <p role="alert" className="rounded-lg bg-red-950 p-3 text-red-200">
          {zipError}
        </p>
      )}
      {/* Top Banner / Hero Summary */}
      <div className="bg-gradient-to-r from-[#571622] via-[#8c1529] to-[#360b13] rounded-2xl p-4 sm:p-5 text-white shadow-xl border border-[#8c1529]/60 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-900/60 border border-emerald-400/30 text-xs font-semibold text-emerald-200">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Marking Completed Successfully</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Results
          </h2>
          <p className="text-sm text-[#e5cbd0] max-w-xl">
            Review class statistics, student scores and marked sheets.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={handleDownloadPdf} disabled={isPdf || isZipping || !students.length}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#240c10] border border-[#571622] font-semibold disabled:opacity-50"
            title="All annotated sheets followed by class and question statistics">
            {isPdf ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {isPdf ? `Preparing PDF ${zipProgress}%...` : 'Download Annotated PDF'}
          </button>
          {/* Prominent Download All Student Work (ZIP) */}
          <button
            onClick={handleDownloadAllZip}
            disabled={isZipping || isPdf || students.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-black text-xs sm:text-sm shadow-lg transition-transform active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Download a ZIP archive containing all annotated student answer sheets, PDF report and CSV statistics"
          >
            {isZipping ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Preparing download {zipProgress}%...</span>
              </>
            ) : (
              <>
                <FolderDown className="w-4 h-4 text-emerald-200" />
                <span>Download All Student Work (ZIP)</span>
                <span className="ml-1 px-1.5 py-0.5 text-[10px] bg-emerald-800 rounded-full font-mono">
                  {students.length}
                </span>
              </>
            )}
          </button>

          <button
            onClick={handleDownloadScoresCsv}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#240c10] text-[#fbe1e5] hover:bg-[#341117] border border-[#571622] font-semibold text-xs sm:text-sm shadow-md transition-colors cursor-pointer"
            title="Export answer key, student responses, scores, and class statistics"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#f3b0ba]" />
            <span>Class Report CSV</span>
          </button>

          <button
            onClick={handleDownloadStatsCsv}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#240c10] text-[#fbe1e5] hover:bg-[#341117] border border-[#571622] font-semibold text-xs sm:text-sm shadow-md transition-colors cursor-pointer"
            title="Export item difficulty statistics as CSV"
          >
            <BarChart3 className="w-4 h-4 text-[#f3b0ba]" />
            <span>Item Stats CSV</span>
          </button>

          <button
            onClick={onReset}
            className="min-h-12 w-full sm:w-auto flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#f3b0ba] text-[#240c10] hover:bg-white border-2 border-white/50 text-base font-bold shadow-lg transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Mark Another Exam</span>
          </button>
        </div>
      </div>

      {activeTab === 'itemStats' && alignmentChecks.length > 0 && (
        <p className="text-sm text-[#b1a1a4] mb-4" role="status">
          Box alignment checked across {alignmentChecks.length} pages ·{' '}
          {alignedBoxes} answer boxes tracked · {adjustedBoxes} positions
          corrected and re-read.
        </p>
      )}
      {/* Class Metric Highlights Grid */}
      {activeTab === 'itemStats' && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {/* Total students */}
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
            <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
              <span>Students</span>
              <Users className="w-4 h-4 text-[#f3b0ba]" />
            </div>
            <div className="text-2xl font-black text-white">
              {totalStudents}
            </div>
            <p className="text-[11px] text-[#8c676d] mt-1">Exams marked</p>
          </div>

          {/* Average Score */}
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
            <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
              <span>Class Average</span>
              <Award className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {avgScore}{' '}
              <span className="text-sm text-[#b1a1a4] font-normal">
                / {totalQuestions}
              </span>
            </div>
            <p className="text-[11px] text-amber-400/90 mt-1">
              {avgPercent}% mean score
            </p>
          </div>

          {/* Highest Score */}
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
            <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
              <span>Highest Score</span>
              <CheckCircle className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-black text-emerald-400">
              {highestScore}{' '}
              <span className="text-sm text-[#b1a1a4] font-normal">
                / {totalQuestions}
              </span>
            </div>
            <p className="text-[11px] text-emerald-400/80 mt-1">
              {totalQuestions
                ? Math.round((highestScore / totalQuestions) * 100)
                : 0}
              % top mark
            </p>
          </div>

          {/* Lowest Score */}
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
            <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
              <span>Lowest Score</span>
              <XCircle className="w-4 h-4 text-red-400" />
            </div>
            <div className="text-2xl font-black text-white">
              {lowestScore}{' '}
              <span className="text-sm text-[#b1a1a4] font-normal">
                / {totalQuestions}
              </span>
            </div>
            <p className="text-[11px] text-[#8c676d] mt-1">
              {totalQuestions
                ? Math.round((lowestScore / totalQuestions) * 100)
                : 0}
              % minimum
            </p>
          </div>

          {/* Pass Rate */}
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
              <span>Pass Rate (≥50%)</span>
              <Sparkles className="w-4 h-4 text-purple-400" />
            </div>
            <div className="text-2xl font-black text-white">{passRate}%</div>
            <p className="text-[11px] text-[#8c676d] mt-1">
              {passCount} of {totalStudents} passed
            </p>
          </div>
        </div>
      )}
      {/* Results navigation */}
      <div
        ref={tabsRef}
        role="tablist"
        aria-label="Results sections"
        onKeyDown={(event) => {
          const buttons = [
            ...(tabsRef.current?.querySelectorAll<HTMLButtonElement>(
              '[role="tab"]',
            ) || []),
          ];
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : event.key === 'ArrowRight'
                  ? (current + 1) % buttons.length
                  : event.key === 'ArrowLeft'
                    ? (current - 1 + buttons.length) % buttons.length
                    : -1;
          if (next >= 0) {
            event.preventDefault();
            buttons[next].click();
            buttons[next].focus();
          }
        }}
        className="grid grid-cols-3 sticky top-16 z-20 scroll-mt-16 bg-[#18090b] border-b border-[#571622] gap-1"
      >
        {(
          [
            ['itemStats', 'Overall statistics', 'Overall Statistics'],
            ['roster', 'Student scores', 'Student Scores Roster'],
            ['sheets', 'Marked sheets', 'Annotated Marked Sheets'],
          ] as const
        ).map(([tab, label, accessible]) => (
          <button
            key={tab}
            id={`results-tab-${tab}`}
            role="tab"
            aria-controls="results-panel"
            tabIndex={activeTab === tab ? 0 : -1}
            aria-label={accessible}
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`min-h-14 px-2 py-2 text-sm font-semibold border-b-2 ${activeTab === tab ? 'border-[#f3b0ba] text-white' : 'border-transparent text-[#b1a1a4]'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <section
        ref={panelRef}
        className="scroll-mt-32"
        role="tabpanel"
        id="results-panel"
        aria-labelledby={`results-tab-${activeTab}`}
      >
        {/* TAB 1: ANNOTATED SHEETS VIEW */}
        {activeTab === 'sheets' && currentStudent && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_24rem] gap-6">
            {/* Left Column: Student Selector and Question Breakdown */}
            <div className="contents lg:block lg:col-start-2 lg:row-start-1 lg:space-y-6">
              {/* Candidate Selector Card */}
              <div className="order-1 lg:order-none bg-[#240c10] border border-[#571622] rounded-2xl p-5 shadow-md space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-white">
                    Select student
                  </h4>
                  <span className="text-xs text-[#a39093]">
                    {selectedStudentIdx + 1} of {students.length}
                  </span>
                </div>

                {/* Navigation stepper */}
                <div className="flex items-center gap-2">
                  <button
                    disabled={selectedStudentIdx <= 0}
                    aria-label="Previous student"
                    onClick={() =>
                      setSelectedStudentIdx((prev) => Math.max(0, prev - 1))
                    }
                    className="p-2 rounded-xl bg-[#1a080a] border border-[#571622] text-white disabled:opacity-30 hover:bg-[#571622]/40 transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <select
                    aria-label="Select student"
                    value={selectedStudentIdx}
                    onChange={(e) =>
                      setSelectedStudentIdx(parseInt(e.target.value))
                    }
                    className="w-full bg-[#18090b] border border-[#571622] rounded-xl px-3 py-2 text-white font-medium text-sm focus:outline-none"
                  >
                    {students.map((s, idx) => (
                      <option key={s.id} value={idx}>
                        #{idx + 1} {s.name} ({s.score}/{s.total} •{' '}
                        {s.percentage}%)
                      </option>
                    ))}
                  </select>
                  <button
                    disabled={selectedStudentIdx >= students.length - 1}
                    aria-label="Next student"
                    onClick={() =>
                      setSelectedStudentIdx((prev) =>
                        Math.min(students.length - 1, prev + 1),
                      )
                    }
                    className="p-2 rounded-xl bg-[#1a080a] border border-[#571622] text-white disabled:opacity-30 hover:bg-[#571622]/40 transition-colors"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Current Student Scorecard */}
                <div className="p-4 rounded-xl bg-[#1a080a] border border-[#571622] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#b1a1a4]">Student:</span>
                    <span className="text-sm font-bold text-white">
                      {currentStudent.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#b1a1a4]">Score:</span>
                    <span
                      className={`text-base font-extrabold ${
                        currentStudent.percentage >= 50
                          ? 'text-emerald-400'
                          : 'text-red-400'
                      }`}
                    >
                      {currentStudent.score} / {currentStudent.total} (
                      {currentStudent.percentage}%)
                    </span>
                  </div>
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() =>
                          handleDownloadSingleSheet(currentStudent)
                        }
                        className="flex-1 py-2 px-3 rounded-lg bg-gradient-to-r from-[#8c1529] to-[#b71c35] hover:opacity-95 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow cursor-pointer"
                        title="Download this student's annotated sheet image"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Download Sheet (PNG)</span>
                      </button>
                      <button
                        onClick={() => handlePrintSheet(currentStudent)}
                        className="p-2 rounded-lg bg-[#240c10] hover:bg-[#341117] border border-[#571622] text-[#fbe1e5] text-xs font-semibold flex items-center justify-center transition cursor-pointer"
                        title="Print this student's marked sheet"
                        aria-label="Print sheet"
                      >
                        <Printer className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Question Breakdown List */}
              <div className="order-3 lg:order-none bg-[#240c10] border border-[#571622] rounded-2xl p-5 shadow-md">
                <h4 className="text-sm font-bold text-white mb-3">
                  Item Breakdown (Response Key)
                </h4>
                <div className="max-h-96 overflow-y-auto pr-1 space-y-1.5 text-xs">
                  {currentStudent.questions.map((q) => {
                    const correctAnswer = answerKey[q.number] || '';
                    const isCorrect =
                      !!correctAnswer && q.response === correctAnswer;
                    return (
                      <div
                        key={q.number + 1}
                        className={`flex items-center justify-between p-2 rounded-lg border ${
                          isCorrect
                            ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200'
                            : 'bg-red-950/20 border-red-900/40 text-red-200'
                        }`}
                      >
                        <span className="font-mono font-bold w-10">
                          Q{q.number + 1}
                        </span>
                        <div className="flex items-center gap-2">
                          <span>
                            Choice:{' '}
                            <strong
                              className={
                                isCorrect
                                  ? 'text-emerald-400 font-mono'
                                  : 'text-red-400 font-mono'
                              }
                            >
                              {q.response === false ? 'Unclear' : q.response}
                            </strong>
                          </span>
                          <span className="text-[#8c676d]">•</span>
                          <span>
                            Key:{' '}
                            <strong className="font-mono text-white">
                              {correctAnswer}
                            </strong>
                          </span>
                        </div>
                        <span className="font-bold">
                          {isCorrect ? '✓ 1' : '✗ 0'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right Column: High-Res Annotated Canvas Preview */}
            <div className="order-2 lg:order-none lg:col-start-1 lg:row-start-1 min-w-0 bg-[#18090b] border border-[#571622] rounded-2xl p-4 flex flex-col items-center justify-center relative shadow-inner overflow-hidden min-h-0">
              <div className="w-full flex flex-wrap items-center justify-between gap-3 mb-3 px-2">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                  <span className="text-xs text-[#b1a1a4]">
                    Green = Correct
                  </span>
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block ml-3" />
                  <span className="text-xs text-[#b1a1a4]">
                    Red = Student Choice
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    aria-label="Zoom sheet out"
                    disabled={sheetZoom === 1}
                    onClick={() => setSheetZoom((z) => Math.max(1, z - 0.5))}
                    className="min-h-11 min-w-11 rounded bg-[#571622] disabled:opacity-40"
                  >
                    −
                  </button>
                  <button
                    onClick={() => setSheetZoom(1)}
                    className="min-h-11 px-3 text-sm"
                  >
                    Fit
                  </button>
                  <button
                    aria-label="Zoom sheet in"
                    disabled={sheetZoom === 4}
                    onClick={() => setSheetZoom((z) => Math.min(4, z + 0.5))}
                    className="min-h-11 min-w-11 rounded bg-[#571622] disabled:opacity-40"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="w-full max-h-[75dvh] overflow-auto p-2 bg-[#110507] rounded-xl border border-[#571622]/50">
                <img
                  src={currentStudent.annotatedDataUrl}
                  alt={`Annotated sheet for ${currentStudent.name}`}
                  className={`rounded-lg shadow-2xl border border-gray-600 ${sheetZoom === 1 ? 'max-w-full max-h-[70dvh] w-auto h-auto mx-auto object-contain' : 'max-w-none h-auto'}`}
                  style={
                    sheetZoom === 1
                      ? undefined
                      : { width: `${sheetZoom * 100}%` }
                  }
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: STUDENT SCORES ROSTER */}
        {activeTab === 'roster' && (
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-6 shadow-md space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Class Examination Roster
                </h3>
                <p className="text-xs text-[#a39093] mt-0.5">
                  Use View Sheet to open a student’s marked work, or download
                  their PNG from the action buttons.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative w-full sm:w-60">
                  <Search className="w-4 h-4 text-[#a39093] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search students..."
                    aria-label="Search students"
                    className="w-full bg-[#18090b] border border-[#571622] rounded-xl pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-[#8c1529]"
                  />
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#fbe1e5]">
                <thead className="bg-[#18090b] text-[#b1a1a4] uppercase text-[11px] tracking-wider border-b border-[#571622]">
                  <tr>
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Student</th>
                    <th className="py-3 px-4">Score</th>
                    <th className="py-3 px-4">Percentage</th>
                    <th className="py-3 px-4">Verdict</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#571622]/40">
                  {filteredStudents
                    .slice()
                    .sort((a, b) => b.score - a.score)
                    .map((student, rank) => {
                      const isPassed = student.percentage >= 50;
                      return (
                        <tr
                          key={student.id}
                          className="hover:bg-[#571622]/20 transition-colors"
                        >
                          <td className="py-3 px-4 font-mono font-bold text-[#b1a1a4]">
                            #{rank + 1}
                          </td>
                          <td className="py-3 px-4 font-semibold text-white">
                            {student.name}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold">
                            {student.score} / {student.total}
                          </td>
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono">
                                {student.percentage}%
                              </span>
                              <div className="w-16 bg-[#1a080a] h-2 rounded-full overflow-hidden border border-[#571622]">
                                <div
                                  className={`h-full ${
                                    isPassed ? 'bg-emerald-500' : 'bg-red-500'
                                  }`}
                                  style={{ width: `${student.percentage}%` }}
                                />
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                                isPassed
                                  ? 'bg-emerald-950 text-emerald-300 border border-emerald-700'
                                  : 'bg-red-950 text-red-300 border border-red-700'
                              }`}
                            >
                              {isPassed ? 'Pass' : 'Review Needed'}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                onClick={() => {
                                  const originalIdx = students.findIndex(
                                    (s) => s.id === student.id,
                                  );
                                  if (originalIdx >= 0) {
                                    setSelectedStudentIdx(originalIdx);
                                    setActiveTab('sheets');
                                  }
                                }}
                                className="text-xs bg-[#571622]/60 hover:bg-[#8c1529] text-[#fbe1e5] px-2.5 py-1.5 rounded-lg border border-[#571622] transition-colors cursor-pointer"
                              >
                                View Sheet
                              </button>
                              <button
                                onClick={() =>
                                  handleDownloadSingleSheet(student)
                                }
                                className="text-xs bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-800/80 text-emerald-200 px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                                title={`Download ${student.name}'s marked sheet`}
                              >
                                <Download className="w-3 h-3 text-emerald-400" />
                                <span>Download</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: QUESTION ITEM ANALYSIS (IGCSE/IBDP EXAM STATISTICS) */}
        {activeTab === 'itemStats' && (
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-6 shadow-md space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Class Overview & Question Analysis
                </h3>
                <p className="text-xs text-[#b1a1a4] mt-0.5">
                  Displays the proportion of candidates choosing each option per
                  question. Highlighted rows identify questions with low correct
                  rates.
                </p>
              </div>
              <button
                onClick={handleDownloadStatsCsv}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#571622] hover:bg-[#8c1529] text-white text-xs font-semibold transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            </div>

            <section
              aria-label="Class score distribution"
              className="rounded-xl border border-[#571622] bg-[#18090b] p-5"
            >
              <h4 className="font-bold text-white mb-4">Score Distribution</h4>
              <div className="grid grid-cols-5 gap-3 items-end">
                {[0, 20, 40, 60, 80].map((lower) => {
                  const upper = lower === 80 ? 100 : lower + 19;
                  const count = students.filter(
                    (s) =>
                      s.percentage >= lower &&
                      (lower === 80
                        ? s.percentage <= 100
                        : s.percentage < lower + 20),
                  ).length;
                  return (
                    <div key={lower} className="text-center space-y-2">
                      <div className="h-28 flex items-end justify-center">
                        <div
                          className="bg-[#8c1529] rounded-t-md w-full max-w-20"
                          style={{
                            height: `${totalStudents ? (count / totalStudents) * 100 : 0}%`,
                          }}
                        />
                      </div>
                      <div className="font-bold text-white">{count}</div>
                      <div className="text-xs text-[#b1a1a4]">
                        {lower}–{upper}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-[#fbe1e5]">
                <thead className="bg-[#18090b] text-[#b1a1a4] uppercase text-[11px] tracking-wider border-b border-[#571622]">
                  <tr>
                    <th className="py-3 px-3">Q#</th>
                    <th className="py-3 px-3">Correct Key</th>
                    <th className="py-3 px-4">% Correct</th>
                    {options.map((option) => (
                      <th key={option} className="py-3 px-3">
                        % {option}
                      </th>
                    ))}
                    <th className="py-3 px-3">% Blank</th>
                    <th className="py-3 px-3">% Unclear</th>
                    <th className="py-3 px-4">Distribution Visualizer</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#571622]/40 font-mono text-xs">
                  {stats.map((q) => {
                    const isTricky = q.correctPercent < 40;
                    return (
                      <tr
                        key={q.questionNumber}
                        className={`hover:bg-[#571622]/20 transition-colors ${
                          isTricky ? 'bg-red-950/15' : ''
                        }`}
                      >
                        <td className="py-2.5 px-3 font-bold text-white">
                          Q{q.questionNumber}
                        </td>
                        <td className="py-2.5 px-3 font-bold text-emerald-400">
                          {q.correctAnswer}
                        </td>
                        <td className="py-2.5 px-4 font-bold">
                          <span
                            className={`px-2 py-0.5 rounded ${
                              q.correctPercent >= 70
                                ? 'bg-emerald-950 text-emerald-300'
                                : q.correctPercent >= 40
                                  ? 'bg-amber-950 text-amber-300'
                                  : 'bg-red-950 text-red-300'
                            }`}
                          >
                            {q.correctPercent}%
                          </span>
                        </td>
                        {options.map((option) => (
                          <td
                            key={option}
                            className={`py-2.5 px-3 ${q.correctAnswer === option ? 'font-bold text-emerald-400' : 'text-[#b1a1a4]'}`}
                          >
                            {q.percentages[option] || 0}%
                          </td>
                        ))}
                        <td className="py-2.5 px-3 text-[#8c676d]">
                          {q.percentages.Blank || 0}%
                        </td>
                        <td className="py-2.5 px-3 text-amber-300">
                          {q.percentages.Unclear || 0}%
                        </td>
                        <td className="py-2.5 px-4">
                          {/* Stacked bar of options */}
                          <div className="w-36 h-3.5 bg-[#18090b] rounded-full overflow-hidden flex border border-[#571622]">
                            {[...options, 'Blank', 'Unclear'].map(
                              (option, index) => (
                                <div
                                  key={option}
                                  title={`${option}: ${q.percentages[option] || 0}%`}
                                  style={{
                                    width: `${q.percentages[option] || 0}%`,
                                    backgroundColor:
                                      q.correctAnswer === option
                                        ? '#2f855a'
                                        : option === 'Blank'
                                          ? '#4b3b3e'
                                          : option === 'Unclear'
                                            ? '#7d6442'
                                            : [
                                                '#a63446',
                                                '#3f6387',
                                                '#b5852e',
                                                '#b85636',
                                                '#784b68',
                                              ][index % 5],
                                  }}
                                />
                              ),
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Developer note & Buy me a coffee from original desktop app */}
      <div className="border border-[#571622] rounded-2xl p-5 bg-[#1a080a] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#a39093]">
        <div className="space-y-1 text-center sm:text-left">
          <p className="text-[#fbe1e5] font-semibold flex items-center justify-center sm:justify-start gap-1.5">
            <img
              src="/icons/Icon128.png"
              alt="ChilliMark logo"
              className="w-8 h-8 rounded bg-white p-0.5 object-contain"
            />
            <span>ChilliMark — Created by Solo Dev</span>
          </p>
          <p>
            Free to use by individual teachers. Dedicated to teachers
            administering IBDP and Cambridge IGCSE science multiple choice
            papers worldwide.
          </p>
        </div>
        <a
          href="https://buymeacoffee.com/jumplogic/e/349532"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-600 to-amber-500 hover:from-amber-500 hover:to-amber-400 text-white font-bold transition-transform active:scale-95 shrink-0 shadow-md"
        >
          <Coffee className="w-4 h-4" />
          <span>Buy me a Coffee ☕</span>
        </a>
      </div>
    </div>
  );
};
