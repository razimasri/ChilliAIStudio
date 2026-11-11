import type { BoxAdjustment, CalibrationParams, StudentResult } from "../types";
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  return n
    ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2
    : 0;
};
function consensus(values: number[]) {
  const middle = median(values),
    mad = median(values.map((value) => Math.abs(value - middle)));
  const limit = Math.max(0.06, mad * 4.5);
  const inliers = values.filter((value) => Math.abs(value - middle) <= limit);
  return {
    mean: inliers.reduce((sum, value) => sum + value, 0) / inliers.length,
    mad,
    inliers: inliers.length,
  };
}
/** Compare dimensionless box positions after removing each block's translation and scale.
 * All pages vote once per slot; robust means prevent a crossed-out page moving the grid.
 */
export function geometryConsensus(
  results: StudentResult[],
  params: CalibrationParams,
): Map<number, BoxAdjustment[]> {
  const repairs = new Map<number, BoxAdjustment[]>(),
    layout = params.columnLayout;
  if (!layout || results.length < 4) return repairs;
  const blockCentres = [];
  for (let c = 0; c < layout.centres.length; c += layout.choices)
    blockCentres.push(median(layout.centres.slice(c, c + layout.choices)));
  type Sample = {
    index: number;
    question: number;
    letter: string;
    xy: [number, number];
    x: number;
    y: number;
    ox: number;
    oy: number;
    px: number;
    py: number;
  };
  const slots = new Map<string, Sample[]>();
  for (const result of results) {
    const blocks = blockCentres.map(() => [] as StudentResult["questions"]);
    for (const question of result.questions) {
      if (!question.boxes.length) continue;
      const x = median(question.boxes.map((box) => box.xy[0]));
      let block = 0;
      for (let b = 1; b < blockCentres.length; b++)
        if (Math.abs(x - blockCentres[b]) < Math.abs(x - blockCentres[block]))
          block = b;
      blocks[block].push(question);
    }
    const pitches = blocks.map((questions) => {
      const sorted = [...questions].sort((a, b) => a.number - b.number),
        gaps = [];
      for (let i = 1; i < sorted.length; i++) {
        const gap =
          (median(sorted[i].boxes.map((box) => box.xy[1])) -
            median(sorted[i - 1].boxes.map((box) => box.xy[1]))) /
          (sorted[i].number - sorted[i - 1].number);
        if (gap > 0) gaps.push(gap);
      }
      return median(gaps);
    });
    const fallbackPitch =
      median(pitches.filter((value) => value > 0)) || params.h;
    for (let block = 0; block < blocks.length; block++) {
      const questions = blocks[block],
        xGaps: number[] = [];
      for (const question of questions) {
        const boxes = [...question.boxes].sort((a, b) =>
          a.letter.localeCompare(b.letter),
        );
        for (let i = 0; i < boxes.length; i++)
          for (let j = i + 1; j < boxes.length; j++) {
            const gap =
              (boxes[j].xy[0] - boxes[i].xy[0]) /
              (boxes[j].letter.charCodeAt(0) - boxes[i].letter.charCodeAt(0));
            if (gap > 0) xGaps.push(gap);
          }
      }
      const px = median(xGaps),
        py = pitches[block] || fallbackPitch;
      if (!px || !py) continue;
      const ox = median(
        questions.flatMap((q) =>
          q.boxes.map(
            (box) => box.xy[0] - (box.letter.charCodeAt(0) - 65) * px,
          ),
        ),
      );
      const oy = median(
        questions.flatMap((q) =>
          q.boxes.map((box) => box.xy[1] - q.number * py),
        ),
      );
      for (const q of questions)
        for (const box of q.boxes) {
          const key = `${q.number}:${box.letter}`,
            samples = slots.get(key) || [];
          samples.push({
            index: result.index,
            question: q.number,
            letter: box.letter,
            xy: box.xy,
            x: (box.xy[0] - ox) / px,
            y: (box.xy[1] - oy) / py,
            ox,
            oy,
            px,
            py,
          });
          slots.set(key, samples);
        }
    }
  }
  for (const samples of slots.values()) {
    if (samples.length < 4) continue;
    const cx = consensus(samples.map((s) => s.x)),
      cy = consensus(samples.map((s) => s.y));
    if (cx.inliers < 3 || cy.inliers < 3) continue;
    for (const s of samples) {
      const dx = s.x - cx.mean,
        dy = s.y - cy.mean;
      const badX =
        Math.abs(dx) > Math.max(0.12, (params.w / s.px) * 0.25, cx.mad * 6);
      const badY =
        Math.abs(dy) > Math.max(0.12, (params.h / s.py) * 0.25, cy.mad * 6);
      if (!badX && !badY) continue;
      const adjustments = repairs.get(s.index) || [];
      adjustments.push({
        question: s.question,
        letter: s.letter,
        from: [...s.xy],
        to: [
          badX ? Math.round(s.ox + cx.mean * s.px) : s.xy[0],
          badY ? Math.round(s.oy + cy.mean * s.py) : s.xy[1],
        ],
        deviation: [dx, dy],
      });
      repairs.set(s.index, adjustments);
    }
  }
  return repairs;
}
