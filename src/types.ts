export interface ContourPoint {
  x: number;
  y: number;
}

export interface ExamFile {
  id: string;
  name: string;
  size: number;
  dataUrl: string; // Display placeholder for deferred files; legacy images remain supported
  sourceFile?: File;
  isSample?: boolean;
  sourceKind?: 'pdf' | 'image';
  rotation: number;
  pageIndex: number;
  totalPages: number;
  width: number; // PDF 600-DPI reference width for memory planning; images use native pixels
  height: number; // Swapped with width on manual 90-degree rotation
}

export interface QuestionBox {
  xy: [number, number]; // [x, y] center coordinate relative to question area
  letter: string; // 'A', 'B', 'C', 'D', ...
  colour: 'green' | 'red' | 'yellow' | null;
  inkCount?: number; // Existing thresholded pixel count, retained only for review hints
  bool: boolean; // True if filled
}

export interface DetectedQuestion {
  number: number; // 0-indexed question number (r in Python)
  response: string | false; // Letter/Blank, or false while multiple/no-mark detection needs review
  reviewReason?: 'multiple-marks' | 'no-mark';
  response_box: QuestionBox | null;
  boxes: QuestionBox[];
  questionNumber?: number;
  finalResponse?: string;
  correctAnswer?: string;
  isCorrect?: boolean;
}

export interface BoxAdjustment {
  question: number;
  letter: string;
  from: [number, number];
  to: [number, number];
  deviation: [number, number]; // Relative deviations in column/row spacing units.
}
export interface MarkingGeometryOptions {
  learnColumnLayout?: boolean;
  adjustments?: BoxAdjustment[];
  reviewQuestions?: number[];
}
export interface StudentResult {
  id: string;
  index: number;
  name: string;
  score: number;
  total: number;
  percentage: number;
  questions: DetectedQuestion[];
  responses: (string | false)[];
  annotatedDataUrl: string;
  originalDataUrl: string;
  annotationPending?: boolean; // Scores are final; native corrected sheet is still being rendered
  rawDeskewedDataUrl?: string; // Lossless, registered 4800 × 6840 scan for corrections
  hasAmbiguity: boolean;
  incomplete: DetectedQuestion[];
  ambiguityCrops?: Record<number, string>;
  manualResponses?: Record<number, string>;
  learnedColumnLayout?: CalibrationParams['columnLayout'];
  geometryCheck?: { pagesCompared: number; boxesTracked: number; adjustments: BoxAdjustment[] };
}

export interface AmbiguityResolutionItem {
  studentIndex: number;
  studentName: string;
  questionNumber: number;
  cropDataUrl: string;
  currentResponse: string | false;
  detectedLetters: string[];
  reviewReason?: DetectedQuestion['reviewReason'];
  suggestedResponse?: 'Blank' | 'Unclear';
  choicesCount: number;
  answerRegions?: {letter:string;left:number;width:number}[];
}

export interface CalibrationParams {
  // Stored bounding rectangle of the calibration sheet's largest contour: [x, y, w, h]
  rect: [number, number, number, number];
  // Question Area coordinates on the canonical 4800x6840 page
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  questionAreaFrame?: 'preview' | 'aligned';
  // Selection box coordinates on canonical 4800x6840 page
  box_x1: number;
  box_y1: number;
  box_x2: number;
  box_y2: number;
  // Box geometry derived from Parameters.set_box()
  w: number;
  h: number;
  outer: ContourPoint[]; // Centred outer contour (outer - contour_center(outer))
  inner: ContourPoint[]; // Centred inner contour (inner - contour_center(inner))
  fill_limit: number;
  text_shift: [number, number];
  font_size: number;
  key: Record<number, string>;
  names: string[];
  templateDataUrl?: string;
  totalQuestions?: number;

  // Reference columns learned during marking, relative to the question area.
  columnLayout?: { centres: number[]; choices: number };

  // Runtime per-page fields (calculated independently during each page's marking)
  col_avg?: number[];
  row_avg?: number[];
  x_jump?: number;
  y_jump?: number;
  choices?: number;
}

export interface QuestionStat {
  questionNumber: number;
  correctAnswer: string;
  totalAnswered: number;
  distribution: Record<string, number>;
  percentages: Record<string, number>;
  correctCount: number;
  correctPercent: number;
}

export type MarkingConcurrency = 'auto' | 1 | 2 | 4;
