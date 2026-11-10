import { useState } from 'react';
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
import { getCV } from './utils/cvLoader';
import { gradeStudent, resolveStudentResponse } from './utils/grading';
import {
  processStudentScan,
  calculateQuestionStats,
  decodeCVError,
  renderStudentFinalAnnotation,
} from './utils/omrEngine';

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

  // Marking state
  const [markingIndex, setMarkingIndex] = useState<number>(0);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [markingStatusText, setMarkingStatusText] = useState<string>('');
  const [pageErrors, setPageErrors] = useState<string[]>([]);
  const [studentResults, setStudentResults] = useState<StudentResult[]>([]);

  // Ambiguity resolution state
  const [ambiguityQueue, setAmbiguityQueue] = useState<AmbiguityResolutionItem[]>([]);
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
    setCurrentStep(3);
    setMarkingIndex(0);
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
      const cv = await getCV();

      for (let i = 0; i < files.length; i++) {
        setMarkingIndex(i);
        const studentName = names[i] || `Student ${String(i + 1).padStart(2, '0')}`;
        setProgressPercent(Math.round(((i + 0.1) / files.length) * 100));

        const scanUrl = files[i].dataUrl;
        setMarkingStatusText(`Marking page ${i + 1} (${studentName})...`);

        try {
          const res = await processStudentScan(
            cv,
            scanUrl,
            studentName,
            i,
            activeParams,
            (stepMsg) => setMarkingStatusText(`Page ${i + 1} (${studentName}): ${stepMsg}`)
          );
          results.push(res);

          if (res.hasAmbiguity && res.incomplete.length > 0) {
            for (const q of res.incomplete) {
              const cropUrl =
                res.ambiguityCrops?.[q.number] ||
                res.rawDeskewedDataUrl ||
                res.annotatedDataUrl;
              ambiguities.push({
                studentIndex: i,
                studentName,
                questionNumber: q.number + 1,
                cropDataUrl: cropUrl,
                currentResponse: false,
                detectedLetters: q.boxes.filter((b) => b.bool).map((b) => b.letter),
                choicesCount: activeParams.choices || 4,
              });
            }
          }

          // Yield to event loop to allow UI updates and memory reclamation
          await new Promise((r) => setTimeout(r, 20));
        } catch (pageErr) {
          const decodedErr = decodeCVError(cv, pageErr);
          const errMsg = `Page ${i + 1} (${studentName}) error: ${decodedErr}`;
          console.error(errMsg, pageErr);
          setPageErrors((prev) => [...prev, errMsg]);

          // Create a graceful fallback result for this failed page so batch continues
          const keyLen = Object.keys(key).length || 40;
          results.push({
            id: `student-${i}`,
            index: i,
            name: studentName,
            score: 0,
            total: keyLen,
            percentage: 0,
            questions: [],
            responses: Array(keyLen).fill('Blank'),
            annotatedDataUrl: scanUrl,
            originalDataUrl: scanUrl,
            hasAmbiguity: false,
            incomplete: [],
          });
        }

        setProgressPercent(Math.round(((i + 1) / files.length) * 100));
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
      const decoded = decodeCVError(null, err);
      console.error('Fatal error during marking process:', decoded, err);
      setPageErrors((prev) => [...prev, `Batch execution halted: ${decoded}`]);
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
        updatedResults[studentIdx] = resolveStudentResponse(targetStudent, qNum, resolvedChoice, key);
      } catch (error) {
        setPageErrors(previous => [...previous, error instanceof Error ? error.message : 'Could not apply correction.']);
        return;
      }
    }

    setStudentResults(updatedResults);

    // Next ambiguity or finish
    if (currentAmbiguityIdx + 1 < ambiguityQueue.length) {
      setCurrentAmbiguityIdx((prev) => prev + 1);
    } else {
      setAmbiguityQueue([]);
      // Bake final annotations for all students matching ChilliMark.py correction_update()
      try {
        const cv = await getCV();
        for (let i = 0; i < updatedResults.length; i++) {
          const student = updatedResults[i];
          if (student.hasAmbiguity || student.rawDeskewedDataUrl) {
            student.annotatedDataUrl = await renderStudentFinalAnnotation(
              cv,
              student,
              { ...params, key }
            );
          }
        }
      } catch (annoErr) {
        console.error('Error rendering final annotations:', annoErr);
      }
      finishMarking(updatedResults, { ...params, key });
    }
  };

  const finishMarking = (results: StudentResult[], calibParams: CalibrationParams) => {
    const key = calibParams.key;
    const gradedResults = results.map(student => gradeStudent(student, key));
    setStudentResults(gradedResults);
    const stats = calculateQuestionStats(gradedResults, key, calibParams.choices || 4);
    setExamStats(stats);
    setCurrentStep(4);
  };

  const handleReset = () => {
    setCurrentStep(1);
    setFiles([]);
    setStudentResults([]);
    setAmbiguityQueue([]);
    setExamStats([]);
    setMarkingIndex(0);
    setProgressPercent(0);
  };

  const handleUpdateFirstFile = (updated: ExamFile) => {
    if (files.length === 0) return;
    const newFiles = [...files];
    newFiles[0] = updated;
    setFiles(newFiles);
  };

  const candidateNames = getCandidateNames();
  const currentMarkingName =
    candidateNames[markingIndex] || `Student ${String(markingIndex + 1).padStart(2, '0')}`;

  return (
    <div className="min-h-screen bg-[#18090b] text-[#f3e7e9] flex flex-col selection:bg-[#8c1529] selection:text-white">
      {/* Top Navigation */}
      <Header currentStep={currentStep} onShowHelp={() => setShowHelp(true)} />

      {/* Main Content Area */}
      <main className="flex-1">
        {currentStep === 1 && (
          <UploadAndInputStep
            files={files}
            onFilesChange={setFiles}
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
            onUpdateFile={handleUpdateFirstFile}
            onBack={() => setCurrentStep(1)}
            onProceedToMark={startMarkingProcess}
          />
        )}

        {currentStep === 3 && (
          <MarkingAnimationStep
            files={files}
            currentIndex={markingIndex}
            currentStudentName={currentMarkingName}
            progressPercent={progressPercent}
            statusText={markingStatusText}
            pageErrors={pageErrors}
          />
        )}

        {currentStep === 4 && (
          <ResultsDashboard
            students={studentResults}
            stats={examStats}
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
        />
      )}

      {/* Help & Guide Modal */}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default App;
