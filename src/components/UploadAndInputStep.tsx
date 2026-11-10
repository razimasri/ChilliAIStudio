import React, { useRef, useState } from 'react';
import {
  Upload,
  FileText,
  Trash2,
  Sparkles,
  Eye,
  RotateCw,
  FileSpreadsheet,
  CheckCircle,
  Loader2,
} from 'lucide-react';
import { ExamFile, CalibrationParams } from '../types';
import { loadExamFile, PdfProgressInfo } from '../utils/pdfProcessor';
import {
  SAMPLE_STUDENT_NAMES,
  SAMPLE_ANSWER_KEY_40,
  generateSampleDemoBatch,
} from '../utils/sampleData';
import { rotateScanImage } from '../utils/omrEngine';
import { PdfLoadingOverlay } from './PdfLoadingOverlay';

interface UploadAndInputStepProps {
  files: ExamFile[];
  onFilesChange: (files: ExamFile[]) => void;
  studentNamesText: string;
  onStudentNamesChange: (text: string) => void;
  answerKeyText: string;
  onAnswerKeyChange: (text: string) => void;
  params: CalibrationParams;
  onParamsChange: (params: CalibrationParams) => void;
  onContinue: () => void;
}

export const UploadAndInputStep: React.FC<UploadAndInputStepProps> = ({
  files,
  onFilesChange,
  studentNamesText,
  onStudentNamesChange,
  answerKeyText,
  onAnswerKeyChange,
  params,
  onParamsChange,
  onContinue,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<PdfProgressInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<ExamFile | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const studentCount = studentNamesText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  const parsedKey = answerKeyText.replace(/[^A-Za-z]/g, '').toUpperCase();

  const handleFilesSelected = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setIsLoadingFile(true);
    setErrorMsg(null);
    setPdfProgress({
      stage: 'reading',
      fileName: fileList[0].name,
      currentPage: 1,
      totalPages: 1,
      percent: 8,
      message: `Preparing to process ${fileList.length} file${fileList.length > 1 ? 's' : ''}...`,
    });

    try {
      const allLoaded: ExamFile[] = [];
      for (let i = 0; i < fileList.length; i++) {
        const loaded = await loadExamFile(fileList[i], (info) => {
          setPdfProgress(info);
        });
        allLoaded.push(...loaded);
      }
      onFilesChange([...files, ...allLoaded]);

      if (!studentNamesText.trim()) {
        const total = files.length + allLoaded.length;
        const generated = Array.from({ length: total }, (_, i) =>
          i < SAMPLE_STUDENT_NAMES.length
            ? SAMPLE_STUDENT_NAMES[i]
            : `Student ${String(i + 1).padStart(2, '0')}`
        ).join('\n');
        onStudentNamesChange(generated);
      }

      // Brief pause to show 100% completion in the animation
      setPdfProgress((prev) =>
        prev
          ? {
              ...prev,
              stage: 'completed',
              percent: 100,
              message: `Successfully loaded ${allLoaded.length} page${allLoaded.length > 1 ? 's' : ''}!`,
            }
          : null
      );
      await new Promise((r) => setTimeout(r, 650));
    } catch (err: unknown) {
      console.error(err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to process files. Please upload standard PDF or image files.'
      );
    } finally {
      setIsLoadingFile(false);
      setPdfProgress(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  const handleRemoveFile = (index: number) => {
    const updated = files.filter((_, i) => i !== index);
    onFilesChange(updated);
  };

  const handleRotateSingle = async (index: number) => {
    const target = files[index];
    if (!target) return;
    const curRot = target.rotation || 0;
    const newRot = (curRot + 90) % 360;

    const rotated = await rotateScanImage(target.dataUrl, 90);
    const updatedFiles = [...files];
    updatedFiles[index] = {
      ...target,
      dataUrl: rotated,
      rotation: newRot,
      width: target.height,
      height: target.width,
    };
    onFilesChange(updatedFiles);
  };

  const handleLoadDemo = async (variant: 'cambridge' | 'ibdp' = 'cambridge') => {
    setIsLoadingFile(true);
    setErrorMsg(null);
    const fileName = variant === 'cambridge' ? 'IGSample.pdf' : 'IBSample.pdf';
    const filePath = `/samples/${fileName}`;

    setPdfProgress({
      stage: 'reading',
      fileName,
      currentPage: 1,
      totalPages: 1,
      percent: 10,
      message: `Loading authentic sample file ${fileName}...`,
    });

    try {
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`Failed to load ${fileName} (${response.statusText})`);
      }
      const blob = await response.blob();
      const file = new File([blob], fileName, { type: 'application/pdf' });

      const loadedPages = await loadExamFile(file, (info) => {
        setPdfProgress(info);
      });

      onFilesChange(loadedPages);

      const sampleNames = [
        'Tanner Moore',
        'Emily Hunt',
        'Foster Holmes',
        'Bailey Alexander',
        'Clara Oswald',
        'Arthur Pendelton',
        'Maya Lin',
        'David Chen',
        'Sophia Rodriguez',
        'Lucas Vance',
        'Hannah Abbott',
        'George Weasley',
        'Fred Weasley',
        'Neville Longbottom',
      ];
      const pageNames = sampleNames.slice(0, loadedPages.length);
      onStudentNamesChange(pageNames.join('\n'));

      const sampleKey = 'BACDBCADAABDCADBCAADBCADBCADAABDCADBCADB';
      onAnswerKeyChange(sampleKey);

      const keyObj: Record<number, string> = {};
      for (let i = 0; i < sampleKey.length; i++) {
        keyObj[i] = sampleKey[i];
      }

      onParamsChange({
        ...params,
        x1: 0,
        y1: 0,
        x2: 0,
        y2: 0,
        box_x1: 0,
        box_y1: 0,
        box_x2: 0,
        box_y2: 0,
        w: 0,
        h: 0,
        key: keyObj,
        names: pageNames,
        totalQuestions: sampleKey.length,
      });

      setPdfProgress({
        stage: 'completed',
        fileName,
        currentPage: loadedPages.length,
        totalPages: loadedPages.length,
        percent: 100,
        message: `Successfully loaded ${loadedPages.length} scanned pages from ${fileName}!`,
      });
      await new Promise((r) => setTimeout(r, 600));
    } catch (err: unknown) {
      console.error(err);
      setErrorMsg(
        err instanceof Error ? err.message : `Failed to load ${fileName}`
      );
    } finally {
      setIsLoadingFile(false);
      setPdfProgress(null);
    }
  };

  const handleFormContinue = () => {
    // Sync answer key and names into params matching Python load_inputs
    const keyClean = answerKeyText.replace(/[^A-Za-z]/g, '').toUpperCase();
    const keyObj: Record<number, string> = {};
    for (let i = 0; i < keyClean.length; i++) {
      keyObj[i] = keyClean[i];
    }
    const namesList = studentNamesText
      .split('\n')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    onParamsChange({
      ...params,
      key: keyObj,
      names: namesList,
      totalQuestions: keyClean.length || params.totalQuestions || 40,
    });

    onContinue();
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Dynamic PDF Loading Overlay with Laser Scanning Animation */}
      {isLoadingFile && (
        <PdfLoadingOverlay
          progress={pdfProgress}
          fileCount={files.length || 1}
        />
      )}

      {/* Top Banner */}
      <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-6 shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-white p-2"><img src="/icons/Banner.png" alt="ChilliMark" className="w-52 sm:w-64 h-auto object-contain" /></span>
            <span className="sr-only">Answer Sheet Scanner</span>
            <span className="text-xs bg-[#571622] text-[#f3b0ba] font-mono px-2 py-0.5 rounded-full border border-[#8c1529]">
              v1.0 Adjuma
            </span>
          </h1>
          <p className="text-sm text-[#b1a1a4] mt-1">
            Heuristical Identification of Landmark-Less Input Multiple-choice Answer Recognition Kernel
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleLoadDemo('cambridge')}
            disabled={isLoadingFile}
            className="flex items-center gap-2 bg-[#8c1529] hover:bg-[#a61a32] border border-[#f3b0ba]/40 text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer shadow-md disabled:opacity-50"
          >
            <Sparkles className="w-3.5 h-3.5 text-[#f3b0ba]" />
            <span>Load Cambridge IGCSE Sample</span>
          </button>
          <button
            onClick={() => handleLoadDemo('ibdp')}
            disabled={isLoadingFile}
            className="flex items-center gap-2 bg-[#571622] hover:bg-[#8c1529] border border-[#8c1529] text-[#f3b0ba] hover:text-white px-3.5 py-2 rounded-xl text-xs font-semibold transition cursor-pointer shadow-md disabled:opacity-50"
          >
            <span>Load IBDP Sample</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-red-950/60 border border-red-800 text-red-200 px-4 py-3 rounded-xl text-sm">
          {errorMsg}
        </div>
      )}

      {/* Main Grid: Upload left, Inputs right matching Gui.py */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Side: PDF Upload */}
        <div className="space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => !isLoadingFile && fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center text-center transition min-h-[320px] relative overflow-hidden ${
              isLoadingFile
                ? 'border-[#ff3b5c] bg-[#2d0f14] cursor-wait'
                : isDragging
                ? 'border-[#f3b0ba] bg-[#571622]/30 cursor-pointer'
                : 'border-[#571622] bg-[#240c10] hover:border-[#8c1529] cursor-pointer'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              onChange={(e) => handleFilesSelected(e.target.files)}
              accept=".pdf,image/png,image/jpeg"
              multiple
              disabled={isLoadingFile}
              className="hidden"
            />

            {isLoadingFile ? (
              <div className="flex flex-col items-center space-y-3">
                <div className="relative">
                  <div className="w-16 h-16 rounded-2xl bg-[#8c1529] flex items-center justify-center text-white shadow-lg animate-pulse">
                    <Loader2 className="w-8 h-8 animate-spin text-[#f3b0ba]" />
                  </div>
                </div>
                <h3 className="text-lg font-bold text-white">
                  Rasterizing Scans...
                </h3>
                <p className="text-xs text-[#f3b0ba] font-mono">
                  {pdfProgress?.message || 'Processing pages at 600 DPI'}
                </p>
              </div>
            ) : (
              <>
                <div className="w-16 h-16 rounded-2xl bg-[#571622] flex items-center justify-center mb-4 text-[#f3b0ba] shadow-lg group-hover:scale-105 transition-transform">
                  <Upload className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-white mb-1">
                  Drag & Drop Exam Scans
                </h3>
                <p className="text-xs text-[#b1a1a4] max-w-sm mb-4">
                  Upload your scanned multi-page PDF or image files (600 DPI recommended for best fidelity).
                </p>
                <span className="px-4 py-2 rounded-xl bg-[#8c1529] text-white text-xs font-semibold shadow hover:opacity-90 transition">
                  Select Exam PDF
                </span>
              </>
            )}
          </div>

          {/* Uploaded Files List */}
          {files.length > 0 && (
            <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 shadow-md space-y-3">
              <div className="flex items-center justify-between text-xs text-[#b1a1a4] pb-2 border-b border-[#571622]">
                <span className="font-semibold text-white">
                  Loaded Pages ({files.length})
                </span>
                <button
                  onClick={() => onFilesChange([])}
                  className="text-red-400 hover:underline"
                >
                  Clear All
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-h-60 overflow-y-auto pr-1">
                {files.map((file, idx) => (
                  <div
                    key={file.id || idx}
                    className="relative bg-[#18090b] border border-[#571622] rounded-xl p-2 group hover:border-[#8c1529] transition"
                  >
                    <div className="aspect-[3/4] bg-black rounded overflow-hidden mb-2 relative">
                      <img
                        src={file.dataUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-full object-contain"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewFile(file);
                        }}
                        className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center text-white transition"
                      >
                        <Eye className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-[#b1a1a4]">
                      <span className="truncate">Page {idx + 1}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleRotateSingle(idx)}
                          className="hover:text-white p-0.5"
                          title="Rotate 90°"
                        >
                          <RotateCw className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleRemoveFile(idx)}
                          className="hover:text-red-400 p-0.5"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Student Names & Answer Key matching Gui.py */}
        <div className="space-y-4 flex flex-col justify-between">
          <div className="bg-[#240c10] border border-[#571622] rounded-2xl p-5 shadow-md space-y-4">
            {/* Student Names */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-bold text-white flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#f3b0ba]" />
                  <span>Student Names</span>
                </label>
                <span className="text-xs text-[#b1a1a4] font-mono">
                  {studentCount} detected
                </span>
              </div>
              <textarea
                value={studentNamesText}
                onChange={(e) => onStudentNamesChange(e.target.value)}
                placeholder="Tanner Moore&#10;Emily Hunt&#10;Foster Holmes&#10;Bailey Alexander&#10;..."
                rows={7}
                className="w-full bg-[#18090b] border border-[#571622] rounded-xl p-3 text-xs text-white placeholder-[#665] font-mono focus:outline-none focus:border-[#8c1529] resize-none"
              />
              <p className="text-[11px] text-[#b1a1a4] mt-1">
                Organize names in the same order as the exam scans (one name per line).
              </p>
            </div>

            {/* Answer Key */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-bold text-white flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-[#f3b0ba]" />
                  <span>Answer Key</span>
                </label>
                <span className="text-xs text-[#b1a1a4] font-mono">
                  {parsedKey.length} answers
                </span>
              </div>
              <textarea
                value={answerKeyText}
                onChange={(e) => onAnswerKeyChange(e.target.value)}
                placeholder="ABCDABCD..."
                rows={4}
                className="w-full bg-[#18090b] border border-[#571622] rounded-xl p-3 text-xs text-white placeholder-[#665] font-mono tracking-widest uppercase focus:outline-none focus:border-[#8c1529] resize-none"
              />
              <p className="text-[11px] text-[#b1a1a4] mt-1">
                Enter correct letters consecutively (e.g. "ABCDBCDA..."). Spaces are ignored.
              </p>
            </div>
          </div>

          {/* Continue Button */}
          <button
            onClick={handleFormContinue}
            disabled={files.length === 0 || isLoadingFile}
            className={`w-full py-4 rounded-2xl font-black text-base shadow-xl flex items-center justify-center gap-3 transition ${
              files.length > 0 && !isLoadingFile
                ? 'bg-gradient-to-r from-[#8c1529] to-[#b71c35] text-white hover:opacity-95 cursor-pointer'
                : 'bg-[#571622] text-[#888] cursor-not-allowed'
            }`}
          >
            <span>Continue ►</span>
          </button>
        </div>
      </div>

      {/* Modal Scan Preview */}
      {previewFile && (
        <div
          onClick={() => setPreviewFile(null)}
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-6 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#240c10] border border-[#571622] rounded-2xl p-4 max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[#571622] text-sm font-bold text-white">
              <span>{previewFile.name} (Page {previewFile.pageIndex + 1})</span>
              <button
                onClick={() => setPreviewFile(null)}
                className="text-[#b1a1a4] hover:text-white"
              >
                ✕ Close
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              <img
                src={previewFile.dataUrl}
                alt="Scan Preview"
                className="max-h-[75vh] max-w-full object-contain rounded"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
