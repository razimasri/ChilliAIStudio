import type {
  AmbiguityResolutionItem,
  CalibrationParams,
  DetectedQuestion,
  StudentResult,
} from '../types';
/** Match click regions to the existing crop's detected answer centres. */
export function reviewItem(
  student: StudentResult,
  question: DetectedQuestion,
  params: CalibrationParams,
): AmbiguityResolutionItem {
  const boxes = [...question.boxes].sort((a, b) => a.xy[0] - b.xy[0]);
  let answerRegions: AmbiguityResolutionItem['answerRegions'];
  if (boxes.length) {
    const middle = Math.floor(
      (boxes[0].xy[0] + boxes[boxes.length - 1].xy[0]) / 2,
    );
    const left = Math.max(0, middle - 550 + params.x1),
      right = Math.min(4800, middle + 500 + params.x1);
    const centres = boxes.map(
      (box) => (box.xy[0] + params.x1 - left) / (right - left),
    );
    const edges = [
      0,
      ...centres
        .slice(1)
        .map((centre, index) =>
          Math.max(0, Math.min(1, (centre + centres[index]) / 2)),
        ),
      1,
    ];
    answerRegions = boxes.map((box, index) => ({
      letter: box.letter,
      left: edges[index],
      width: edges[index + 1] - edges[index],
    }));
  }
  return {
    studentIndex: student.index,
    studentName: student.name,
    questionNumber: question.number + 1,
    cropDataUrl:
      student.ambiguityCrops?.[question.number] ||
      student.rawDeskewedDataUrl ||
      student.annotatedDataUrl,
    currentResponse: false,
    reviewReason: question.reviewReason,
    detectedLetters: question.boxes
      .filter((box) => box.bool)
      .map((box) => box.letter),
    choicesCount: Math.max(params.choices || 4, boxes.length),
    answerRegions,
  };
}
