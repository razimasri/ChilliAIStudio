import { useEffect, useRef, useState } from 'react';
import { Header } from './components/Header';
import { UploadAndInputStep } from './components/UploadAndInputStep';
import { CalibrationStep } from './components/CalibrationStep';
import { MarkingAnimationStep } from './components/MarkingAnimationStep';
import { AmbiguityModal } from './components/AmbiguityModal';
import { ResultsDashboard } from './components/ResultsDashboard';
import { HelpModal } from './components/HelpModal';
import {
  ExamFile,
  CalibrationParams,
  StudentResult,
  AmbiguityResolutionItem,
  QuestionStat,
} from './types';
import { releaseUnusedSources } from './utils/pdfProcessor';
import {
  releaseAllImages,
  releaseImage,
  releaseResultImages,
} from './utils/imageStore';
import { markBatch } from './utils/markingBatch';
import { MarkingClient } from './utils/markingClient';
import { gradeStudent, resolveStudentResponse } from './utils/grading';
import { calculateQuestionStats, decodeCVError } from './utils/omrEngine';

export function App() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [files, setFiles] = useState<ExamFile[]>([]);
  const [studentNamesText, setStudentNamesText] = useState<string>('');
  const [answerKeyText, setAnswerKeyText] = useState<string>('');

  // Default calibration parameters matching Python load_inputs
  const [params, setParams] = useState<CalibrationParams>({
    rect: [0, 0, 4800, 6840],
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
    outer: [],
    inner: [],
    fill_limit: 80,
    text_shift: [0, 0],
    font_size: 4,
    key: {},
    names: [],
  });

  const previousFiles = useRef<ExamFile[]>([]);
  const batchController = useRef<AbortController>();
  useEffect(() => {
    releaseUnusedSources(previousFiles.current, files);
    previousFiles.current = files;
  }, [files]);
  useEffect(
    () => () => {
      batchController.current?.abort();
      releaseUnusedSources(previousFiles.current, []);
      releaseAllImages();
    },
    [],
  );

  // Marking state
  const [markingPages, setMarkingPages] = useState<{
    active: number[];
    done: number[];
  }>({ active: [], done: [] });
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [markingStatusText, setMarkingStatusText] = useState<string>('');
  const [pageErrors, setPageErrors] = useState<string[]>([]);
  const [studentResults, setStudentResults] = useState<StudentResult[]>([]);

  // Ambiguity resolution state
  const [ambiguityQueue, setAmbiguityQueue] = useState<
    AmbiguityResolutionItem[]
  >([]);
  const [currentAmbiguityIdx, setCurrentAmbiguityIdx] = useState<number>(0);

  // Statistics
  const [examStats, setExamStats] = useState<QuestionStat[]>([]);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  // Parse candidate names list matching Python clean_names
  const getCandidateNames = (): string[] => {
    return studentNamesText
      .split('\n')
      .map((n) => n.replace(/[*	]/g, ' ').trim())
      .filter((n) => n.length > 0);
  };

  // Parse answer key into 0-indexed map matching Python: { 0: 'B', 1: 'A', ... }
  const getParsedKey = (): Record<number, string> => {
    const clean = answerKeyText.replace(/[^A-Za-z]/g, '').toUpperCase();
    const map: Record<number, string> = {};
    for (let i = 0; i < clean.length; i++) {
      map[i] = clean[i];
    }
    return map;
  };

  // Trigger grading process matching Python Student.get and Student.mark
  const startMarkingProcess = async () => {
    batchController.current?.abort();
    const controller = new AbortController();
    batchController.current = controller;
    releaseResultImages(studentResults);
    setStudentResults([]);
    setCurrentStep(3);
    setMarkingPages({ active: [], done: [] });
    setProgressPercent(0);
    setPageErrors([]);
    setMarkingStatusText('Initializing OMR heuristic engine...');

    const names = getCandidateNames();
    const key = getParsedKey();
    const results: StudentResult[] = [];
    const ambiguities: AmbiguityResolutionItem[] = [];

    const activeParams: CalibrationParams = {
      ...params,
      key,
      names,
    };

    try {
      const marked = await markBatch(
        files,
        names,
        activeParams,
        controller.signal,
        (progress) => {
          setMarkingPages({ active: progress.active, done: progress.done });
          setProgressPercent(
            Math.round((progress.completed / files.length) * 100),
          );
          setMarkingStatusText(
            `${progress.workers} background worker${progress.workers === 1 ? '' : 's'} · ${progress.message}`,
          );
        },
      );
      results.push(...marked);
      controller.signal.throwIfAborted();
      for (const res of results) {
        if (res.hasAmbiguity && res.incomplete.length > 0) {
          for (const q of res.incomplete) {
            ambiguities.push({
              studentIndex: res.index,
              studentName: res.name,
              questionNumber: q.number + 1,
              cropDataUrl:
                res.ambiguityCrops?.[q.number] ||
                res.rawDeskewedDataUrl ||
                res.annotatedDataUrl,
              currentResponse: false,
              detectedLetters: q.boxes
                .filter((b) => b.bool)
                .map((b) => b.letter),
              choicesCount: activeParams.choices || 4,
            });
          }
        }
      }

      setStudentResults(results);

      // If ambiguities exist, pop up resolution modal matching Python corrections
      if (ambiguities.length > 0) {
        setAmbiguityQueue(ambiguities);
        setCurrentAmbiguityIdx(0);
      } else {
        finishMarking(results, activeParams);
      }
    } catch (err) {
      releaseResultImages(results);
      if (controller.signal.aborted) return;
      const decoded = decodeCVError(null, err);
      console.error('Fatal error during marking process:', decoded, err);
      setPageErrors((prev) => [...prev, `Batch execution halted: ${decoded}`]);
    } finally {
      if (controller.signal.aborted) releaseResultImages(results);
    }
  };

  // Ambiguity resolution handler matching Python corrections & correction_update
  const handleResolveAmbiguity = async (resolvedChoice: string) => {
    const currentItem = ambiguityQueue[currentAmbiguityIdx];
    if (!currentItem) return;

    const studentIdx = currentItem.studentIndex;
    const qNum = currentItem.questionNumber - 1; // back to 0-indexed
    const key = getParsedKey();

    const updatedResults = [...studentResults];
    const targetStudent = updatedResults[studentIdx];

    if (targetStudent) {
      try {
        updatedResults[studentIdx] = resolveStudentResponse(
          targetStudent,
          qNum,
          resolvedChoice,
          key,
        );
      } catch (error) {
        setPageErrors((previous) => [
          ...previous,
          error instanceof Error
            ? error.message
            : 'Could not apply correction.',
        ]);
        return;
      }
    }

    setStudentResults(updatedResults);
    setAmbiguityQueue((queue) =>
      queue.map((item, index) =>
        index === currentAmbiguityIdx
          ? { ...item, currentResponse: resolvedChoice }
          : item,
      ),
    );

    // Next ambiguity or finish
    if (currentAmbiguityIdx + 1 < ambiguityQueue.length) {
      setCurrentAmbiguityIdx((prev) => prev + 1);
    } else {
      setAmbiguityQueue([]);
      // Final corrected sheets also render off the interface thread.
      let client: MarkingClient | undefined;
      const signal = batchController.current?.signal;
      const cancel = () => client?.dispose();
      try {
        signal?.throwIfAborted();
        client = new MarkingClient();
        signal?.addEventListener('abort', cancel, { once: true });
        const corrected = new Set(
          ambiguityQueue.map((item) => item.studentIndex),
        );
        for (const i of corrected) {
          const student = updatedResults[i];
          if (student.rawDeskewedDataUrl) {
            setMarkingStatusText(
              `Preparing corrected sheet for ${student.name}…`,
            );
            const oldImage = student.annotatedDataUrl;
            student.annotatedDataUrl = await client.annotate(student, {
              ...params,
              key,
            });
            signal?.throwIfAborted();
            if (oldImage !== student.rawDeskewedDataUrl) releaseImage(oldImage);
          }
        }
      } catch (error) {
        if (signal?.aborted) return;
        setPageErrors((previous) => [
          ...previous,
          `Could not prepare corrected sheets: ${error instanceof Error ? error.message : String(error)}`,
        ]);
        return;
      } finally {
        signal?.removeEventListener('abort', cancel);
        client?.dispose();
      }
      finishMarking(updatedResults, { ...params, key });
    }
  };

  const finishMarking = (
    results: StudentResult[],
    calibParams: CalibrationParams,
  ) => {
    const key = calibParams.key;
    const gradedResults = results.map((student) => gradeStudent(student, key));
    setStudentResults(gradedResults);
    const stats = calculateQuestionStats(
      gradedResults,
      key,
      calibParams.choices || 4,
    );
    setExamStats(stats);
    setCurrentStep(4);
  };

  const handleReset = () => {
    batchController.current?.abort();
    releaseResultImages(studentResults);
    releaseAllImages();
    setCurrentStep(1);
    setFiles([]);
    setStudentResults([]);
    setAmbiguityQueue([]);
    setExamStats([]);
    setMarkingPages({ active: [], done: [] });
    setProgressPercent(0);
  };

  return (
    <div className="min-h-screen bg-[#18090b] text-[#f3e7e9] flex flex-col selection:bg-[#8c1529] selection:text-white">
      {/* Top Navigation */}
      <Header currentStep={currentStep} onShowHelp={() => setShowHelp(true)} />

      {/* Main Content Area */}
      <main className="flex-1">
        {currentStep === 1 && (
          <UploadAndInputStep
            files={files}
            onFilesChange={(next) => {
              if (
                files[0]?.id !== next[0]?.id ||
                files[0]?.rotation !== next[0]?.rotation
              ) {
                setParams((previous) => ({
                  ...previous,
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
                }));
              }
              setFiles(next);
            }}
            studentNamesText={studentNamesText}
            onStudentNamesChange={setStudentNamesText}
            answerKeyText={answerKeyText}
            onAnswerKeyChange={setAnswerKeyText}
            params={params}
            onParamsChange={setParams}
            onContinue={() => setCurrentStep(2)}
          />
        )}

        {currentStep === 2 && files.length > 0 && (
          <CalibrationStep
            firstFile={files[0]}
            params={params}
            onParamsChange={setParams}
            onBack={() => setCurrentStep(1)}
            onProceedToMark={startMarkingProcess}
          />
        )}

        {currentStep === 3 && (
          <MarkingAnimationStep
            files={files}
            activePages={markingPages.active}
            completedPages={markingPages.done}
            progressPercent={progressPercent}
            statusText={markingStatusText}
            pageErrors={pageErrors}
            onBack={() => {
              batchController.current?.abort();
              setCurrentStep(1);
            }}
          />
        )}

        {currentStep === 4 && (
          <ResultsDashboard
            students={studentResults}
            stats={examStats}
            answerKey={getParsedKey()}
            onReset={handleReset}
          />
        )}
      </main>

      {/* Ambiguity Resolution Modal */}
      {ambiguityQueue.length > 0 && (
        <AmbiguityModal
          item={ambiguityQueue[currentAmbiguityIdx]}
          currentIndex={currentAmbiguityIdx}
          totalCount={ambiguityQueue.length}
          optionsCount={params.choices || 4}
          onResolve={handleResolveAmbiguity}
          onBack={() =>
            setCurrentAmbiguityIdx((index) => Math.max(0, index - 1))
          }
          onCancel={() => {
            batchController.current?.abort();
            releaseResultImages(studentResults);
            setStudentResults([]);
            setAmbiguityQueue([]);
            setCurrentStep(1);
          }}
        />
      )}

      {/* Help & Guide Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
