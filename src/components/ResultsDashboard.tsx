import React, { useState, useEffect } from 'react';
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
import JSZip from 'jszip';
import { StudentResult, QuestionStat } from '../types';
import { exportStudentScoresCsv, exportQuestionStatsCsv } from '../utils/omrEngine';

interface ResultsDashboardProps {
  students: StudentResult[];
  stats: QuestionStat[];
  onReset: () => void;
}

export const ResultsDashboard: React.FC<ResultsDashboardProps> = ({
  students,
  stats,
  onReset,
}) => {
  const [activeTab, setActiveTab] = useState<'sheets' | 'roster' | 'itemStats'>('sheets');
  const [selectedStudentIdx, setSelectedStudentIdx] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [isZipping, setIsZipping] = useState(false);
  const [zipProgress, setZipProgress] = useState(0);

  // Fire celebratory confetti on initial load
  useEffect(() => {
    confetti({
      particleCount: 80,
      spread: 70,
      origin: { y: 0.6 },
      colors: ['#8c1529', '#00713e', '#f59e0b', '#ffffff'],
    });
  }, []);

  const currentStudent = students[selectedStudentIdx] || students[0];

  // Class statistics calculations
  const totalStudents = students.length;
  const avgScore =
    totalStudents > 0
      ? (students.reduce((sum, s) => sum + s.score, 0) / totalStudents).toFixed(1)
      : '0';
  const totalQuestions = currentStudent?.total || 40;
  const avgPercent =
    totalStudents > 0
      ? Math.round(students.reduce((sum, s) => sum + s.percentage, 0) / totalStudents)
      : 0;

  const highestScore = Math.max(...students.map((s) => s.score), 0);
  const lowestScore = Math.min(...students.map((s) => s.score), 0);
  const passCount = students.filter((s) => s.percentage >= 50).length;
  const passRate = totalStudents > 0 ? Math.round((passCount / totalStudents) * 100) : 0;

  // CSV download handlers
  const handleDownloadScoresCsv = () => {
    const csvContent = exportStudentScoresCsv(students);
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ChilliMark-Student-Scores.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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

  // Batch download all student marked works as a clean ZIP package
  const handleDownloadAllZip = async () => {
    if (students.length === 0 || isZipping) return;
    setIsZipping(true);
    setZipProgress(0);

    try {
      const zip = new JSZip();
      const folder = zip.folder('ChilliMark_Annotated_Student_Sheets');

      students.forEach((student, idx) => {
        const safeName = student.name.replace(/\s+/g, '_');
        const rankPrefix = String(idx + 1).padStart(2, '0');
        const fileName = `${rankPrefix}_${safeName}_Score_${student.score}of${student.total}.png`;
        const base64Data = student.annotatedDataUrl.split(',')[1];
        if (base64Data && folder) {
          folder.file(fileName, base64Data, { base64: true });
        }
      });

      // Include student scores CSV inside the ZIP package
      const scoresCsv = exportStudentScoresCsv(students);
      folder?.file('Class_Scores_Summary.csv', scoresCsv);

      const content = await zip.generateAsync(
        { type: 'blob' },
        (metadata) => {
          setZipProgress(Math.round(metadata.percent));
        }
      );

      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ChilliMark_All_${students.length}_Annotated_Sheets.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error('Failed to create ZIP package:', err);
    } finally {
      setIsZipping(false);
      setZipProgress(0);
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
    s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Top Banner / Hero Summary */}
      <div className="bg-gradient-to-r from-[#571622] via-[#8c1529] to-[#360b13] rounded-2xl p-6 sm:p-8 text-white shadow-xl border border-[#8c1529]/60 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-900/60 border border-emerald-400/30 text-xs font-semibold text-emerald-200">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
            <span>Marking Completed Successfully</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Exams Graded & Annotated
          </h2>
          <p className="text-sm text-[#e5cbd0] max-w-xl">
            All multiple-choice sheets have been evaluated against your answer key. Review
            annotated papers, explore item response rates, and export CSV spreadsheets.
          </p>
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Prominent Download All Student Work (ZIP) */}
          <button
            onClick={handleDownloadAllZip}
            disabled={isZipping || students.length === 0}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-black text-xs sm:text-sm shadow-lg transition-transform active:scale-95 disabled:opacity-50 cursor-pointer"
            title="Download a ZIP archive containing all annotated student answer sheets"
          >
            {isZipping ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>Zipping {zipProgress}%...</span>
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

          {/* Download Current Student Sheet */}
          {currentStudent && (
            <button
              onClick={() => handleDownloadSingleSheet(currentStudent)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-[#8c1529] hover:bg-[#fde8eb] font-bold text-xs sm:text-sm shadow-md transition-transform active:scale-95 cursor-pointer"
              title={`Download ${currentStudent.name}'s marked sheet (PNG)`}
            >
              <Download className="w-4 h-4 text-[#8c1529]" />
              <span>Download Sheet (PNG)</span>
            </button>
          )}

          <button
            onClick={handleDownloadScoresCsv}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#240c10] text-[#fbe1e5] hover:bg-[#341117] border border-[#571622] font-semibold text-xs sm:text-sm shadow-md transition-colors cursor-pointer"
            title="Export student scores table as CSV"
          >
            <FileSpreadsheet className="w-4 h-4 text-[#f3b0ba]" />
            <span>Scores CSV</span>
          </button>

          <button
            onClick={handleDownloadStatsCsv}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#240c10] text-[#fbe1e5] hover:bg-[#341117] border border-[#571622] font-semibold text-xs sm:text-sm shadow-md transition-colors cursor-pointer"
            title="Export item difficulty statistics as CSV"
          >
            <BarChart3 className="w-4 h-4 text-[#f3b0ba]" />
            <span>Item Stats CSV</span>
          </button>

          {currentStudent && (
            <button
              onClick={() => handlePrintSheet(currentStudent)}
              className="flex items-center gap-2 px-3.5 py-2.5 rounded-xl bg-[#240c10] text-[#fbe1e5] hover:bg-[#341117] border border-[#571622] font-semibold text-xs sm:text-sm shadow-md transition-colors cursor-pointer"
              title={`Print ${currentStudent.name}'s marked sheet`}
            >
              <Printer className="w-4 h-4 text-[#f3b0ba]" />
              <span>Print Sheet</span>
            </button>
          )}

          <button
            onClick={onReset}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1a080a] text-red-300 hover:text-white hover:bg-red-950/60 border border-red-800/40 text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Mark Another Exam</span>
          </button>
        </div>
      </div>

      {/* Class Metric Highlights Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {/* Total students */}
        <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
            <span>Candidates</span>
            <Users className="w-4 h-4 text-[#f3b0ba]" />
          </div>
          <div className="text-2xl font-black text-white">{totalStudents}</div>
          <p className="text-[11px] text-[#8c676d] mt-1">Exams marked</p>
        </div>

        {/* Average Score */}
        <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
            <span>Class Average</span>
            <Award className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-black text-white">
            {avgScore} <span className="text-sm text-[#b1a1a4] font-normal">/ {totalQuestions}</span>
          </div>
          <p className="text-[11px] text-amber-400/90 mt-1">{avgPercent}% mean score</p>
        </div>

        {/* Highest Score */}
        <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
            <span>Highest Score</span>
            <CheckCircle className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-black text-emerald-400">
            {highestScore} <span className="text-sm text-[#b1a1a4] font-normal">/ {totalQuestions}</span>
          </div>
          <p className="text-[11px] text-emerald-400/80 mt-1">
            {Math.round((highestScore / totalQuestions) * 100)}% top mark
          </p>
        </div>

        {/* Lowest Score */}
        <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
            <span>Lowest Score</span>
            <XCircle className="w-4 h-4 text-red-400" />
          </div>
          <div className="text-2xl font-black text-white">
            {lowestScore} <span className="text-sm text-[#b1a1a4] font-normal">/ {totalQuestions}</span>
          </div>
          <p className="text-[11px] text-[#8c676d] mt-1">
            {Math.round((lowestScore / totalQuestions) * 100)}% minimum
          </p>
        </div>

        {/* Pass Rate */}
        <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between text-[#a39093] text-xs mb-1">
            <span>Pass Rate (≥50%)</span>
            <Sparkles className="w-4 h-4 text-purple-400" />
          </div>
          <div className="text-2xl font-black text-white">{passRate}%</div>
          <p className="text-[11px] text-[#8c676d] mt-1">{passCount} of {totalStudents} passed</p>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex border-b border-[#571622] space-x-2">
        <button
          onClick={() => setActiveTab('sheets')}
          className={`pb-3 px-4 font-bold text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'sheets'
              ? 'border-[#8c1529] text-white'
              : 'border-transparent text-[#b1a1a4] hover:text-white'
          }`}
        >
          <span>📸 Annotated Marked Sheets</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#571622] text-[#fbe1e5]">
            {students.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('roster')}
          className={`pb-3 px-4 font-bold text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'roster'
              ? 'border-[#8c1529] text-white'
              : 'border-transparent text-[#b1a1a4] hover:text-white'
          }`}
        >
          <span>📋 Student Scores Roster</span>
        </button>

        <button
          onClick={() => setActiveTab('itemStats')}
          className={`pb-3 px-4 font-bold text-sm border-b-2 transition-colors flex items-center gap-2 ${
            activeTab === 'itemStats'
              ? 'border-[#8c1529] text-white'
              : 'border-transparent text-[#b1a1a4] hover:text-white'
          }`}
        >
          <span>📊 Item Response Statistics</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-[#571622] text-[#fbe1e5]">
            {stats.length} Qs
          </span>
        </button>
      </div>

      {/* TAB 1: ANNOTATED SHEETS VIEW */}
      {activeTab === 'sheets' && currentStudent && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Student Selector and Question Breakdown */}
          <div className="lg:col-span-4 space-y-6">
            {/* Candidate Selector Card */}
            <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-5 shadow-md space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-white">Select Candidate</h4>
                <span className="text-xs text-[#a39093]">
                  {selectedStudentIdx + 1} of {students.length}
                </span>
              </div>

              {/* Navigation stepper */}
              <div className="flex items-center gap-2">
                <button
                  disabled={selectedStudentIdx <= 0}
                  onClick={() => setSelectedStudentIdx((prev) => Math.max(0, prev - 1))}
                  className="p-2 rounded-xl bg-[#1a080a] border border-[#571622] text-white disabled:opacity-30 hover:bg-[#571622]/40 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <select
                  value={selectedStudentIdx}
                  onChange={(e) => setSelectedStudentIdx(parseInt(e.target.value))}
                  className="w-full bg-[#18090b] border border-[#571622] rounded-xl px-3 py-2 text-white font-medium text-sm focus:outline-none"
                >
                  {students.map((s, idx) => (
                    <option key={s.id} value={idx}>
                      #{idx + 1} {s.name} ({s.score}/{s.total} • {s.percentage}%)
                    </option>
                  ))}
                </select>
                <button
                  disabled={selectedStudentIdx >= students.length - 1}
                  onClick={() => setSelectedStudentIdx((prev) => Math.min(students.length - 1, prev + 1))}
                  className="p-2 rounded-xl bg-[#1a080a] border border-[#571622] text-white disabled:opacity-30 hover:bg-[#571622]/40 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Current Student Scorecard */}
              <div className="p-4 rounded-xl bg-[#1a080a] border border-[#571622] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#b1a1a4]">Candidate:</span>
                  <span className="text-sm font-bold text-white">{currentStudent.name}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#b1a1a4]">Final Score:</span>
                  <span
                    className={`text-base font-extrabold ${
                      currentStudent.percentage >= 50 ? 'text-emerald-400' : 'text-red-400'
                    }`}
                  >
                    {currentStudent.score} / {currentStudent.total} ({currentStudent.percentage}%)
                  </span>
                </div>
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleDownloadSingleSheet(currentStudent)}
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
                    >
                      <Printer className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <button
                    onClick={handleDownloadAllZip}
                    disabled={isZipping || students.length === 0}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-950/80 border border-emerald-700/60 hover:bg-emerald-900 text-emerald-200 text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isZipping ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Zipping {zipProgress}%...</span>
                      </>
                    ) : (
                      <>
                        <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Download All {students.length} Sheets (ZIP)</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Question Breakdown List */}
            <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-5 shadow-md">
              <h4 className="text-sm font-bold text-white mb-3">Item Breakdown (Response Key)</h4>
              <div className="max-h-96 overflow-y-auto pr-1 space-y-1.5 text-xs">
                {currentStudent.questions.map((q) => {
                  const isCorrect = q.isCorrect;
                  return (
                    <div
                      key={q.questionNumber}
                      className={`flex items-center justify-between p-2 rounded-lg border ${
                        isCorrect
                          ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-200'
                          : 'bg-red-950/20 border-red-900/40 text-red-200'
                      }`}
                    >
                      <span className="font-mono font-bold w-10">Q{q.questionNumber}</span>
                      <div className="flex items-center gap-2">
                        <span>
                          Choice:{' '}
                          <strong
                            className={
                              isCorrect ? 'text-emerald-400 font-mono' : 'text-red-400 font-mono'
                            }
                          >
                            {q.finalResponse}
                          </strong>
                        </span>
                        <span className="text-[#8c676d]">•</span>
                        <span>
                          Key: <strong className="font-mono text-white">{q.correctAnswer}</strong>
                        </span>
                      </div>
                      <span className="font-bold">{isCorrect ? '✓ 1' : '✗ 0'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: High-Res Annotated Canvas Preview */}
          <div className="lg:col-span-8 bg-[#18090b] border border-[#571622] rounded-2xl p-4 flex flex-col items-center justify-center relative shadow-inner overflow-hidden min-h-[650px]">
            <div className="w-full flex flex-wrap items-center justify-between gap-3 mb-3 px-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
                <span className="text-xs text-[#b1a1a4]">Green = Correct</span>
                <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block ml-3" />
                <span className="text-xs text-[#b1a1a4]">Red = Student Choice</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDownloadSingleSheet(currentStudent)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#571622] hover:bg-[#8c1529] text-white text-xs font-semibold transition cursor-pointer shadow"
                  title="Download marked PNG"
                >
                  <Download className="w-3.5 h-3.5 text-[#f3b0ba]" />
                  <span>Download Work (PNG)</span>
                </button>
                <button
                  onClick={handleDownloadAllZip}
                  disabled={isZipping || students.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950 border border-emerald-800 hover:bg-emerald-900 text-emerald-300 text-xs font-semibold transition cursor-pointer disabled:opacity-50 shadow"
                  title="Download all student marked sheets as ZIP"
                >
                  <FolderDown className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Download All (ZIP)</span>
                </button>
                <button
                  onClick={() => handlePrintSheet(currentStudent)}
                  className="p-1.5 rounded-lg bg-[#240c10] hover:bg-[#341117] border border-[#571622] text-[#fbe1e5] text-xs font-semibold transition cursor-pointer"
                  title="Print sheet"
                >
                  <Printer className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs text-[#a39093] ml-1 font-mono">
                  #{selectedStudentIdx + 1}/{students.length}
                </span>
              </div>
            </div>

            <div className="w-full h-full max-h-[800px] overflow-auto flex items-center justify-center p-2 bg-[#110507] rounded-xl border border-[#571622]/50">
              <img
                src={currentStudent.annotatedDataUrl}
                alt={`Annotated sheet for ${currentStudent.name}`}
                className="max-h-[760px] w-auto object-contain rounded-lg shadow-2xl border border-gray-600"
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
              <h3 className="text-lg font-bold text-white">Class Examination Roster</h3>
              <p className="text-xs text-[#a39093] mt-0.5">
                Overview of candidate rankings and scores. Click any student to view or download their annotated work.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleDownloadAllZip}
                disabled={isZipping || students.length === 0}
                className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 hover:from-emerald-500 hover:to-emerald-600 text-white font-bold text-xs shadow transition-transform active:scale-95 disabled:opacity-50 cursor-pointer"
                title="Download all marked sheets as a ZIP file"
              >
                {isZipping ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Zipping {zipProgress}%...</span>
                  </>
                ) : (
                  <>
                    <FolderDown className="w-3.5 h-3.5 text-emerald-200" />
                    <span>Download All (ZIP)</span>
                  </>
                )}
              </button>
              <div className="relative w-full sm:w-60">
                <Search className="w-4 h-4 text-[#a39093] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search candidate name..."
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
                  <th className="py-3 px-4">Candidate Name</th>
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
                      <tr key={student.id} className="hover:bg-[#571622]/20 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-[#b1a1a4]">#{rank + 1}</td>
                        <td className="py-3 px-4 font-semibold text-white">{student.name}</td>
                        <td className="py-3 px-4 font-mono font-bold">
                          {student.score} / {student.total}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{student.percentage}%</span>
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
                                const originalIdx = students.findIndex((s) => s.id === student.id);
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
                              onClick={() => handleDownloadSingleSheet(student)}
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
                Item Response Distribution & Difficulty Analysis
              </h3>
              <p className="text-xs text-[#b1a1a4] mt-0.5">
                Displays the proportion of candidates choosing each option (A, B, C, D) per
                question. Highlighted rows identify questions with low correct rates.
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

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-[#fbe1e5]">
              <thead className="bg-[#18090b] text-[#b1a1a4] uppercase text-[11px] tracking-wider border-b border-[#571622]">
                <tr>
                  <th className="py-3 px-3">Q#</th>
                  <th className="py-3 px-3">Correct Key</th>
                  <th className="py-3 px-4">% Correct</th>
                  <th className="py-3 px-3">% A</th>
                  <th className="py-3 px-3">% B</th>
                  <th className="py-3 px-3">% C</th>
                  <th className="py-3 px-3">% D</th>
                  <th className="py-3 px-3">% Blank</th>
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
                      <td className="py-2.5 px-3 font-bold text-white">Q{q.questionNumber}</td>
                      <td className="py-2.5 px-3 font-bold text-emerald-400">{q.correctAnswer}</td>
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
                      <td
                        className={`py-2.5 px-3 ${
                          q.correctAnswer === 'A' ? 'font-bold text-emerald-400' : 'text-[#b1a1a4]'
                        }`}
                      >
                        {q.percentages.A || 0}%
                      </td>
                      <td
                        className={`py-2.5 px-3 ${
                          q.correctAnswer === 'B' ? 'font-bold text-emerald-400' : 'text-[#b1a1a4]'
                        }`}
                      >
                        {q.percentages.B || 0}%
                      </td>
                      <td
                        className={`py-2.5 px-3 ${
                          q.correctAnswer === 'C' ? 'font-bold text-emerald-400' : 'text-[#b1a1a4]'
                        }`}
                      >
                        {q.percentages.C || 0}%
                      </td>
                      <td
                        className={`py-2.5 px-3 ${
                          q.correctAnswer === 'D' ? 'font-bold text-emerald-400' : 'text-[#b1a1a4]'
                        }`}
                      >
                        {q.percentages.D || 0}%
                      </td>
                      <td className="py-2.5 px-3 text-[#8c676d]">{q.percentages.Blank || 0}%</td>
                      <td className="py-2.5 px-4">
                        {/* Stacked bar of options */}
                        <div className="w-36 h-3.5 bg-[#18090b] rounded-full overflow-hidden flex border border-[#571622]">
                          <div
                            title={`A: ${q.percentages.A || 0}%`}
                            className={`${
                              q.correctAnswer === 'A' ? 'bg-emerald-500' : 'bg-blue-600'
                            }`}
                            style={{ width: `${q.percentages.A || 0}%` }}
                          />
                          <div
                            title={`B: ${q.percentages.B || 0}%`}
                            className={`${
                              q.correctAnswer === 'B' ? 'bg-emerald-500' : 'bg-indigo-600'
                            }`}
                            style={{ width: `${q.percentages.B || 0}%` }}
                          />
                          <div
                            title={`C: ${q.percentages.C || 0}%`}
                            className={`${
                              q.correctAnswer === 'C' ? 'bg-emerald-500' : 'bg-purple-600'
                            }`}
                            style={{ width: `${q.percentages.C || 0}%` }}
                          />
                          <div
                            title={`D: ${q.percentages.D || 0}%`}
                            className={`${
                              q.correctAnswer === 'D' ? 'bg-emerald-500' : 'bg-amber-600'
                            }`}
                            style={{ width: `${q.percentages.D || 0}%` }}
                          />
                          <div
                            title={`Blank: ${q.percentages.Blank || 0}%`}
                            className="bg-gray-700"
                            style={{ width: `${q.percentages.Blank || 0}%` }}
                          />
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

      {/* Developer note & Buy me a coffee from original desktop app */}
      <div className="border border-[#571622] rounded-2xl p-5 bg-[#1a080a] flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-[#a39093]">
        <div className="space-y-1 text-center sm:text-left">
          <p className="text-[#fbe1e5] font-semibold flex items-center justify-center sm:justify-start gap-1.5">
            <span>🌶️ ChilliMark — Created by Solo Dev</span>
          </p>
          <p>
            Free to use by individual teachers. Dedicated to teachers administering IBDP and Cambridge
            IGCSE science multiple choice papers worldwide.
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
