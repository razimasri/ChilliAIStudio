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
  MarkingConcurrency,
} from './types';
import { releaseUnusedSources, warmExamPage } from './utils/pdfProcessor';
import {
  releaseAllImages,
  releaseImage,
  releaseResultImages,
} from './utils/imageStore';
import { markBatch } from './utils/markingBatch';
import { canPrepareAhead } from './utils/pageLookahead';
import { reviewItem } from './utils/reviewQueue';
import {
  gradeStudent,
  resolveStudentResponse,
  preserveManualResponses,
} from './utils/grading';
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

  // Prepare just the first page while the teacher enters names/key. Its compressed
  // raster is shared with calibration; no batch of native bitmaps is retained.
  useEffect(() => {
    if (!files.length || !files[0].sourceFile || !canPrepareAhead(files[0])) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void warmExamPage(files[0], controller.signal).catch(() => {
        // Speculation is optional; requested page loading reports any real error.
      });
    }, 400);
    return () => {clearTimeout(timer); controller.abort();};
  }, [files]);

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
  const [markingConcurrency, setMarkingConcurrency] =
    useState<MarkingConcurrency>('auto');
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

  type Session = {
    controller: AbortController;
    results: StudentResult[];
    queue: AmbiguityResolutionItem[];
    cursor: number;
    done: boolean;
    finalizing: boolean;
    params: CalibrationParams;
  };
  const sessionRef = useRef<Session>();
  const [batchDone, setBatchDone] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const syncReview = (session: Session) => {
    if (sessionRef.current !== session || session.controller.signal.aborted)
      return;
    setStudentResults(session.results.filter(Boolean));
    setAmbiguityQueue([...session.queue]);
    setCurrentAmbiguityIdx(session.cursor);
  };
  const cancelSession = () => {
    batchController.current?.abort();
    if (sessionRef.current)
      releaseResultImages(sessionRef.current.results.filter(Boolean));
    sessionRef.current = undefined;
    setStudentResults([]);
    setAmbiguityQueue([]);
    setFinalizing(false);
    setCurrentStep(1);
  };
  const startMarkingProcess = async () => {
    batchController.current?.abort();
    releaseResultImages(studentResults);
    const controller = new AbortController();
    batchController.current = controller;
    const activeParams = {
      ...params,
      key: getParsedKey(),
      names: getCandidateNames(),
    };
    const session: Session = {
      controller,
      params: activeParams,
      results: [],
      queue: [],
      cursor: 0,
      done: false,
      finalizing: false,
    };
    sessionRef.current = session;
    setStudentResults([]);
    setAmbiguityQueue([]);
    setCurrentAmbiguityIdx(0);
    setBatchDone(false);
    setFinalizing(false);
    setCurrentStep(3);
    setMarkingPages({ active: [], done: [] });
    setProgressPercent(0);
    setPageErrors([]);
    setMarkingStatusText('Starting background marking…');
    try {
      const checkedResults = await markBatch(
        files,
        activeParams.names,
        activeParams,
        controller.signal,
        (progress) => {
          if (sessionRef.current !== session) return;
          setMarkingPages({ active: progress.active, done: progress.done });
          setProgressPercent(
            Math.round((progress.completed / files.length) * 100),
          );
          setMarkingStatusText(
            `${progress.workers} background worker${progress.workers === 1 ? '' : 's'} · ${progress.message}`,
          );
        },
        markingConcurrency === 'auto' ? undefined : markingConcurrency,
        (incoming, previous) => {
          if (sessionRef.current !== session || controller.signal.aborted)
            return;
          let result = incoming;
          if (previous) {
            result = preserveManualResponses(
              result,
              session.results[result.index],
              activeParams.key,
            );
            // Keep review history and cursor stable while refreshing repaired crops.
            session.queue = session.queue.map((item) => {
              if (item.studentIndex !== result.index) return item;
              const question = result.questions.find(
                (q) => q.number === item.questionNumber - 1,
              );
              if (!question) return item;
              return {
                ...reviewItem(result, question, activeParams),
                currentResponse: result.responses[question.number],
              };
            });
          }
          session.results[result.index] = result;
          for (const question of result.incomplete) {
            if (
              !session.queue.some(
                (item) =>
                  item.studentIndex === result.index &&
                  item.questionNumber === question.number + 1,
              )
            )
              session.queue.push(reviewItem(result, question, activeParams));
          }
          syncReview(session);
          return result;
        },
      );
      controller.signal.throwIfAborted();
      if (sessionRef.current !== session) return;
      for (const result of checkedResults)
        session.results[result.index].geometryCheck = result.geometryCheck;
      session.done = true;
      setBatchDone(true);
      syncReview(session);
      if (!session.queue.length) finishMarking(session.results, activeParams);
    } catch (error) {
      if (controller.signal.aborted || sessionRef.current !== session) return;
      controller.abort();
      releaseResultImages(session.results.filter(Boolean));
      setStudentResults([]);
      setAmbiguityQueue([]);
      setPageErrors([`Marking stopped: ${decodeCVError(null, error)}`]);
    }
  };
  const handleResolveAmbiguity = (choice: string) => {
    const session = sessionRef.current,
      item = session?.queue[session.cursor];
    if (
      !session ||
      !item ||
      session.finalizing ||
      session.controller.signal.aborted
    )
      return;
    try {
      session.results[item.studentIndex] = resolveStudentResponse(
        session.results[item.studentIndex],
        item.questionNumber - 1,
        choice,
        session.params.key,
      );
      session.queue[session.cursor] = { ...item, currentResponse: choice };
      session.cursor++;
      syncReview(session);
    } catch (error) {
      setPageErrors((previous) => [
        ...previous,
        error instanceof Error ? error.message : String(error),
      ]);
    }
  };
  const previousCorrection = () => {
    const session = sessionRef.current;
    if (!session || session.finalizing) return;
    session.cursor = Math.max(0, session.cursor - 1);
    syncReview(session);
  };
  const nextCorrection = () => {
    const session = sessionRef.current;
    if (!session || !session.queue[session.cursor]?.currentResponse) return;
    session.cursor++;
    syncReview(session);
  };
  const finishReview = async () => {
    const session = sessionRef.current;
    if (
      !session ||
      !session.done ||
      session.finalizing ||
      session.queue.some((item) => !item.currentResponse)
    )
      return;
    session.finalizing = true;
    setFinalizing(true);
    try {
      session.controller.signal.throwIfAborted();
      const corrected = [...new Set(session.queue.map(item => item.studentIndex))]
        .map(index => session.results[index]);
      for (const student of corrected) student.annotationPending = true;
      finishMarking(session.results, session.params);
    } catch (error) {
      if (!session.controller.signal.aborted)
        setPageErrors([
          `Could not prepare corrected sheets: ${error instanceof Error ? error.message : String(error)}`,
        ]);
    } finally {
      session.finalizing = false;
      setFinalizing(false);
    }
  };

  useEffect(() => {
    if (currentStep !== 3 || !batchDone || finalizing || pageErrors.length)
      return;
    const session = sessionRef.current;
    if (
      !session ||
      session.cursor < session.queue.length ||
      session.queue.some((item) => !item.currentResponse)
    )
      return;
    void finishReview();
  }, [
    currentStep,
    batchDone,
    currentAmbiguityIdx,
    ambiguityQueue,
    finalizing,
    pageErrors,
  ]);

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
    sessionRef.current = undefined;
    setStudentNamesText('');
    setAnswerKeyText('');
    setParams((previous) => ({
      ...previous,
      key: {},
      names: [],
      x1: 0,
      y1: 0,
      x2: 0,
      y2: 0,
      w: 0,
      h: 0,
      columnLayout: undefined,
    }));
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
                  columnLayout: undefined,
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
            markingConcurrency={markingConcurrency}
            onMarkingConcurrencyChange={setMarkingConcurrency}
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
            onBack={cancelSession}
          />
        )}

        {currentStep === 4 && (
          <ResultsDashboard
            students={studentResults}
            params={sessionRef.current?.params ?? params}
            stats={examStats}
            answerKey={getParsedKey()}
            onReset={handleReset}
          />
        )}
      </main>

      {currentStep === 3 &&
        ambiguityQueue.length > 0 &&
        !ambiguityQueue[currentAmbiguityIdx] && (
          <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#571622] bg-[#240c10] p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex flex-wrap justify-center items-center gap-3">
            <p role="status">
              {finalizing
                ? markingStatusText
                : batchDone
                  ? 'Preparing results…'
                  : 'Corrections up to date. More pages are marking in the background…'}
            </p>
            <button
              disabled={finalizing}
              onClick={previousCorrection}
              className="min-h-12 px-4 rounded-xl bg-[#571622] disabled:opacity-40"
            >
              Previous correction
            </button>
            {pageErrors.length > 0 && !finalizing && (
              <button
                onClick={() => {
                  setPageErrors([]);
                  void finishReview();
                }}
                className="min-h-12 px-5 rounded-xl bg-emerald-700 font-bold"
              >
                Retry preparing results
              </button>
            )}
          </div>
        )}
      {currentStep === 3 && ambiguityQueue[currentAmbiguityIdx] && (
        <AmbiguityModal
          item={ambiguityQueue[currentAmbiguityIdx]}
          currentIndex={currentAmbiguityIdx}
          totalCount={ambiguityQueue.length}
          optionsCount={params.choices || 4}
          onResolve={handleResolveAmbiguity}
          onBack={previousCorrection}
          onNext={nextCorrection}
          backgroundStatus={
            batchDone
              ? 'All pages marked'
              : `Background marking: ${markingPages.done.length} of ${files.length} pages complete`
          }
          onCancel={cancelSession}
        />
      )}

      {/* Help & Guide Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
