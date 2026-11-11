import { PagePreview } from './PagePreview';
import { Dialog } from './Dialog';
import { APP_VERSION, RELEASE_NAME } from '../utils/release';
import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Upload, Trash2, Eye, RotateCw, Camera } from 'lucide-react';
import { ExamFile, CalibrationParams, MarkingConcurrency } from '../types';
import {
  loadExamFile,
  releaseUnusedSources,
  PdfProgressInfo,
} from '../utils/pdfProcessor';
import { REAL_SAMPLE_CONFIGS } from '../utils/sampleData';
import { rotateScanImage } from '../utils/omrEngine';
import type { BatchPage } from '../utils/camera/batchCapture';
import { PdfLoadingOverlay } from './PdfLoadingOverlay';

const CameraScanner = lazy(() => import('./CameraScanner'));
const BatchCameraScanner = lazy(() => import('./BatchCameraScanner'));

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
  markingConcurrency: MarkingConcurrency;
  onMarkingConcurrencyChange: (value: MarkingConcurrency) => void;
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
  markingConcurrency,
  onMarkingConcurrencyChange,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [pdfProgress, setPdfProgress] = useState<PdfProgressInfo | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewFile, setPreviewFile] = useState<ExamFile | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [cameraFile, setCameraFile] = useState<File | null>(null);
  const [batchScanning, setBatchScanning] = useState(false);
  const confirmCameraScan = async (file: File, signal: AbortSignal) => {
    const loaded = await loadExamFile(file);
    if (signal.aborted) { releaseUnusedSources(loaded, []); signal.throwIfAborted(); }
    if (files.some(page => page.isSample)) {
      onStudentNamesChange(''); onAnswerKeyChange(''); onFilesChange(loaded);
    } else onFilesChange([...files, ...loaded]);
    setCameraFile(null);
  };

  const confirmBatch = async (pages: BatchPage[], signal: AbortSignal, progress: (message: string) => void) => {
    const loaded: ExamFile[] = [];
    try {
      for (let i = 0; i < pages.length; i++) {
        signal.throwIfAborted(); progress(`Adding sheet ${i + 1} of ${pages.length}…`);
        const file = new File([pages[i].file], `Camera-sheet-${i + 1}.png`, { type: 'image/png' });
        const images = await loadExamFile(file);
        loaded.push(...images.map(image => ({ ...image, rotation: pages[i].rotation })));
      }
      signal.throwIfAborted();
      if (files.some(page => page.isSample)) {
        onStudentNamesChange(''); onAnswerKeyChange(''); onFilesChange(loaded);
      } else onFilesChange([...files, ...loaded]);
      setBatchScanning(false);
    } catch (error) { releaseUnusedSources(loaded, []); throw error; }
  };

  const studentCount = studentNamesText
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0).length;

  const parsedKey = answerKeyText.replace(/[^A-Za-z]/g, '').toUpperCase();

  const handleFilesSelected = async (fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList || []);
    if (selectedFiles.length === 0) return;
    setIsLoadingFile(true);
    setErrorMsg(null);
    setPdfProgress({
      stage: 'reading',
      fileName: selectedFiles[0].name,
      currentPage: 1,
      totalPages: 1,
      percent: 8,
      message: `Preparing to process ${selectedFiles.length} file${selectedFiles.length > 1 ? 's' : ''}...`,
    });

    const allLoaded: ExamFile[] = [];
    try {
      for (let i = 0; i < selectedFiles.length; i++) {
        const loaded = await loadExamFile(selectedFiles[i], (info) => {
          setPdfProgress(info);
        });
        allLoaded.push(...loaded);
      }
      if (files.some((page) => page.isSample)) {
        onStudentNamesChange('');
        onAnswerKeyChange('');
        onFilesChange(allLoaded);
      } else onFilesChange([...files, ...allLoaded]);

      setPdfProgress((prev) =>
        prev
          ? {
              ...prev,
              stage: 'completed',
              percent: 100,
              message: `Successfully loaded ${allLoaded.length} page${allLoaded.length > 1 ? 's' : ''}!`,
            }
          : null,
      );
    } catch (err: unknown) {
      releaseUnusedSources(allLoaded, []);
      console.error(err);
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to process files. Please upload standard PDF or image files.',
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
    if (studentCount === files.length) {
      onStudentNamesChange(
        studentNamesText
          .split('\n')
          .map((name) => name.trim())
          .filter(Boolean)
          .filter((_, i) => i !== index)
          .join('\n'),
      );
    }
    onFilesChange(updated);
  };

  const handleRotateSingle = async (index: number) => {
    const target = files[index];
    if (!target) return;
    const curRot = target.rotation || 0;
    const newRot = (curRot + 90) % 360;

    const updatedFiles = [...files];
    updatedFiles[index] = {
      ...target,
      dataUrl: target.sourceFile
        ? target.dataUrl
        : await rotateScanImage(target.dataUrl, 90),
      rotation: newRot,
      width: target.height,
      height: target.width,
    };
    onFilesChange(updatedFiles);
  };

  const handleLoadDemo = async (
    variant: 'cambridge' | 'ibdp' = 'cambridge',
  ) => {
    setIsLoadingFile(true);
    setErrorMsg(null);
    const sample = REAL_SAMPLE_CONFIGS[variant];
    const fileName = sample.name;
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

      onFilesChange(loadedPages.map((page) => ({ ...page, isSample: true })));

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

      const sampleKey = sample.answerKey;
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
    } catch (err: unknown) {
      console.error(err);
      setErrorMsg(
        err instanceof Error ? err.message : `Failed to load ${fileName}`,
      );
    } finally {
      setIsLoadingFile(false);
      setPdfProgress(null);
    }
  };

  const namesMatch = studentCount === 0 || studentCount === files.length;
  const ready =
    files.length > 0 && parsedKey.length > 0 && namesMatch && !isLoadingFile;
  const setupRef = useRef<HTMLElement>(null);
  const previousCount = useRef(files.length);
  useEffect(() => {
    if (previousCount.current === 0 && files.length > 0) {
      setupRef.current?.scrollIntoView({ block: 'start' });
      setupRef.current?.focus({ preventScroll: true });
    }
    previousCount.current = files.length;
  }, [files.length]);
  const clearPages = () => {
    onFilesChange([]);
    onStudentNamesChange('');
    if (files.some((page) => page.isSample)) onAnswerKeyChange('');
  };
  const handleFormContinue = () => {
    if (!ready) return;
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
    <div className="max-w-6xl mx-auto p-4 sm:p-6 pb-44 sm:pb-32 space-y-5">
      {batchScanning && <Suspense fallback={<div role="status" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">Opening batch scanner…</div>}>
        <BatchCameraScanner onClose={() => setBatchScanning(false)} onConfirm={confirmBatch} />
      </Suspense>}
      {cameraFile && <Suspense fallback={<div role="status" className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center">Loading camera scanner…</div>}>
        <CameraScanner file={cameraFile} onClose={() => setCameraFile(null)}
          onRetry={() => { setCameraFile(null); cameraInputRef.current?.click(); }} onConfirm={confirmCameraScan} />
      </Suspense>}
      {isLoadingFile && (
        <PdfLoadingOverlay
          progress={pdfProgress}
          fileCount={files.length || 1}
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#571622] bg-[#240c10] p-4 sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-lg bg-white p-2">
              <img
                src="/icons/Banner.png"
                alt="ChilliMark"
                className={files.length ? 'w-36 h-auto' : 'w-48 h-auto'}
              />
            </span>
            <span className="text-sm text-[#f3b0ba]">
              v{APP_VERSION} {RELEASE_NAME}
            </span>
          </div>
          <p className="mt-2 text-sm text-[#b1a1a4]">
            {files.length
              ? 'Check your names and answer key, then continue to calibration.'
              : 'Load your answer sheets to get started.'}
          </p>
        </div>
        <details
          className="sample-picker"
          open={files.length === 0 ? true : undefined}
        >
          <summary className="cursor-pointer min-h-11 flex items-center text-sm text-[#d8c7ca]">
            {files.length ? 'Replace with a sample' : 'Try a sample'}
          </summary>
          <div className="flex flex-wrap gap-2 mt-2">
            <button
              onClick={() => handleLoadDemo('cambridge')}
              disabled={isLoadingFile}
              className="min-h-11 px-3 rounded-xl bg-[#8c1529] text-sm font-semibold"
            >
              Load Cambridge IGCSE Sample
            </button>
            <button
              onClick={() => handleLoadDemo('ibdp')}
              disabled={isLoadingFile}
              className="min-h-11 px-3 rounded-xl bg-[#571622] text-sm font-semibold"
            >
              Load IBDP Sample
            </button>
          </div>
        </details>
      </div>
      {errorMsg && (
        <div
          role="alert"
          className="rounded-xl border border-red-800 bg-red-950/60 p-4 text-red-200"
        >
          {errorMsg}
        </div>
      )}
      <input
        aria-label="Exam scan files"
        type="file"
        ref={fileInputRef}
        onChange={(e) => {
          void handleFilesSelected(e.target.files);
          e.target.value = '';
        }}
        accept=".pdf,image/png,image/jpeg"
        multiple
        disabled={isLoadingFile}
        className="hidden"
      />
      <input ref={cameraInputRef} aria-label="Camera photograph" type="file" accept="image/*" capture="environment" className="hidden"
        onChange={event => { const file = event.target.files?.[0]; if (file) setCameraFile(file); event.target.value = ''; }} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        <section
          className={`${files.length ? 'order-2 lg:order-1' : 'order-1'} space-y-4`}
          aria-label="Exam pages"
        >
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-2xl border-2 border-dashed ${isDragging ? 'border-[#f3b0ba]' : 'border-[#571622]'} bg-[#240c10] ${files.length ? 'p-4 flex flex-wrap items-center justify-between gap-3' : 'p-8 min-h-64 flex flex-col items-center justify-center text-center gap-4'}`}
          >
            {!files.length && <Upload className="w-12 h-12 text-[#f3b0ba]" />}
            <div>
              <h2 className="font-bold">
                {files.some((page) => page.isSample)
                  ? 'Load your own exam'
                  : files.length
                    ? 'Add more scans'
                    : 'Choose PDF or images'}
              </h2>
              <p className="text-sm text-[#b1a1a4] mt-1">
                {files.some((page) => page.isSample)
                  ? 'Replaces the sample and clears its names and answer key.'
                  : files.length
                    ? 'New pages are added at the end.'
                    : 'Select files or drop them here. Scan at 600 DPI where possible.'}
              </p>
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoadingFile}
              className="min-h-11 px-4 rounded-xl bg-[#8c1529] font-semibold"
            >
              {files.some((page) => page.isSample)
                ? 'Choose my exam'
                : files.length
                  ? 'Add files'
                  : 'Choose files'}
            </button>
            <div className="flex flex-col items-start gap-1">
              <button onClick={() => cameraInputRef.current?.click()} disabled={isLoadingFile}
                className="min-h-11 px-4 rounded-xl border border-[#8c1529] font-semibold flex items-center gap-2"><Camera size={20} />Scan with Camera</button>
              <button onClick={() => setBatchScanning(true)} disabled={isLoadingFile}
                className="min-h-11 px-4 rounded-xl bg-[#571622] font-semibold flex items-center gap-2"><Camera size={20} />Batch Scan</button>
              <p className="text-xs text-[#b1a1a4] max-w-xs">Use the rear camera or choose a photo. If camera access is unavailable, use Choose files. Keep the full page visible on a contrasting surface.</p>
            </div>
          </div>
          {files.length > 0 && (
            <div className="rounded-2xl border border-[#571622] bg-[#240c10] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-bold">Loaded pages ({files.length})</h2>
                <button
                  onClick={clearPages}
                  className="min-h-11 px-2 text-red-300 text-sm"
                >
                  Clear pages & names
                </button>
              </div>
              <p className="text-sm text-[#b1a1a4]">
                Check page order and orientation. Removing a page also removes
                its matching name when the counts agree.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 max-h-96 overflow-y-auto">
                {files.map((file, idx) => (
                  <div
                    key={file.id}
                    className="rounded-xl border border-[#571622] bg-[#18090b] p-2 min-w-0"
                  >
                    <button
                      aria-label={`Preview page ${idx + 1}`}
                      onClick={() => setPreviewFile(file)}
                      className="relative block w-full aspect-[3/4] overflow-hidden rounded bg-black"
                    >
                      <PagePreview
                        file={file}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-full object-contain"
                      />
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 p-2">
                        <Eye className="w-4 h-4" />
                      </span>
                    </button>
                    <p className="mt-2 text-sm font-semibold">Page {idx + 1}</p>
                    <p className="text-xs text-[#b1a1a4] truncate">
                      {studentCount === files.length
                        ? studentNamesText
                            .split('\n')
                            .map((n) => n.trim())
                            .filter(Boolean)[idx]
                        : `Student ${String(idx + 1).padStart(2, '0')}`}
                    </p>
                    <div className="flex justify-end gap-1 mt-1">
                      <button
                        onClick={() => handleRotateSingle(idx)}
                        title="Rotate 90°"
                        aria-label={`Rotate page ${idx + 1} 90 degrees`}
                        className="min-w-11 min-h-11 rounded-lg hover:bg-[#571622]"
                      >
                        <RotateCw className="w-4 h-4 mx-auto" />
                      </button>
                      <button
                        onClick={() => handleRemoveFile(idx)}
                        title="Remove"
                        aria-label={`Remove page ${idx + 1}`}
                        className="min-w-11 min-h-11 rounded-lg text-red-300 hover:bg-[#571622]"
                      >
                        <Trash2 className="w-4 h-4 mx-auto" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
        <section
          ref={setupRef}
          tabIndex={-1}
          aria-label="Names and answer key"
          className={`${files.length ? 'order-1 lg:order-2' : 'order-2'} scroll-mt-20 outline-none rounded-2xl border border-[#571622] bg-[#240c10] p-4 sm:p-5 space-y-5`}
        >
          <div>
            <h2 className="font-bold text-lg">Names & answer key</h2>
            <p className="text-sm text-[#b1a1a4] mt-1">
              {files.length
                ? `${files.length} pages loaded. Check these details before continuing.`
                : 'You can enter these before or after loading your scans.'}
            </p>
          </div>
          <div>
            <div className="flex justify-between gap-2 mb-2">
              <label htmlFor="student-names" className="font-semibold">
                Student names{' '}
                <span className="text-sm text-[#b1a1a4] font-normal">
                  (optional)
                </span>
              </label>
              <span className="text-sm text-[#b1a1a4]">
                {studentCount} names
              </span>
            </div>
            <textarea
              id="student-names"
              value={studentNamesText}
              onChange={(e) => onStudentNamesChange(e.target.value)}
              placeholder="One name per page, in page order"
              rows={5}
              className="w-full rounded-xl border border-[#571622] bg-[#18090b] p-3 text-base font-mono"
              aria-describedby="names-help names-status"
            />
            <p id="names-help" className="text-sm text-[#b1a1a4] mt-1">
              Leave empty for Student 01, Student 02, and so on.
            </p>
            <p
              id="names-status"
              role={!namesMatch && files.length ? 'alert' : undefined}
              className="text-sm text-amber-300"
            >
              {!namesMatch && files.length > 0
                ? `There are ${files.length} pages and ${studentCount} names. Enter one name per page or clear the names.`
                : ''}
            </p>
          </div>
          <div>
            <div className="flex justify-between gap-2 mb-2">
              <label htmlFor="answer-key" className="font-semibold">
                Answer key
              </label>
              <span className="text-sm text-[#b1a1a4]">
                {parsedKey.length} answers
              </span>
            </div>
            <textarea
              id="answer-key"
              value={answerKeyText}
              onChange={(e) => onAnswerKeyChange(e.target.value)}
              placeholder="ABCDABCD…"
              rows={3}
              spellCheck={false}
              autoCapitalize="characters"
              className="w-full rounded-xl border border-[#571622] bg-[#18090b] p-3 text-base font-mono uppercase tracking-wider"
              aria-describedby="key-help"
            />
            <p id="key-help" className="text-sm text-[#b1a1a4] mt-1">
              One letter per question. Spaces and line breaks are ignored.
            </p>
          </div>
          <div className="border-t border-[#571622] pt-4 space-y-2">
            <label htmlFor="marking-workers" className="font-semibold block">
              Parallel marking
            </label>
            <select
              id="marking-workers"
              value={markingConcurrency}
              onChange={(event) =>
                onMarkingConcurrencyChange(
                  event.target.value === 'auto'
                    ? 'auto'
                    : (Number(event.target.value) as 1 | 2 | 4),
                )
              }
              className="min-h-11 rounded-xl border border-[#571622] bg-[#18090b] p-2 text-base w-full"
              aria-describedby="workers-help"
            >
              <option value="auto">Auto (adapts to this exam)</option>
              <option value="1">1 worker</option>
              <option value="2">2 workers</option>
              <option value="4">4 workers</option>
            </select>
            <p id="workers-help" className="text-sm text-[#b1a1a4]">
              Auto uses CPU, memory and scan size to set a limit. On longer
              exams it measures throughput before keeping extra workers.
              More workers use more memory.
            </p>
          </div>
        </section>
      </div>
      <div className="fixed bottom-0 inset-x-0 z-30 border-t border-[#571622] bg-[#240c10]/95 backdrop-blur-md px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-4">
          <div role="status" aria-live="polite" className="text-sm">
            <p className="font-semibold">
              {files.length} pages ·{' '}
              {studentCount ? `${studentCount} names` : 'Numbered students'} ·{' '}
              {parsedKey.length} answers
            </p>
            <p className="text-[#b1a1a4]">
              {!files.length
                ? 'Load your scans to continue.'
                : !parsedKey.length
                  ? 'Add an answer key to continue.'
                  : !namesMatch
                    ? 'Match the names to the pages to continue.'
                    : 'Ready to select the question area.'}
            </p>
          </div>
          <button
            onClick={handleFormContinue}
            disabled={!ready}
            className="min-h-12 px-5 rounded-xl font-bold bg-[#8c1529] disabled:bg-[#571622] disabled:text-[#b1a1a4] shrink-0"
          >
            Continue to calibration
          </button>
        </div>
      </div>
      {previewFile && (
        <Dialog
          titleId="scan-preview-title"
          onClose={() => setPreviewFile(null)}
          className="max-w-4xl p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <h2
              id="scan-preview-title"
              className="font-semibold min-w-0 break-words"
            >
              {previewFile.name}
            </h2>
            <button
              onClick={() => setPreviewFile(null)}
              className="min-h-11 min-w-11 shrink-0"
            >
              Close
            </button>
          </div>
          <div className="mt-3 overflow-auto max-h-[75dvh]">
            <PagePreview
              file={previewFile}
              edge={1400}
              alt="Scan preview"
              className="w-full h-auto object-contain"
            />
          </div>
        </Dialog>
      )}
    </div>
  );
};
