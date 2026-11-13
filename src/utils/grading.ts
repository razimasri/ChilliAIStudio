import type { StudentResult } from '../types';

/** Score finalized responses from scratch. Rendering never accumulates marks. */
export function calculateScore(
  responses: (string | false)[],
  key: Record<number, string>,
): number {
  return Object.entries(key).reduce(
    (score, [number, answer]) =>
      score +
      (/^[A-Z]$/.test(answer) && responses[Number(number)] === answer ? 1 : 0),
    0,
  );
}

export function gradeStudent(
  student: StudentResult,
  key: Record<number, string>,
): StudentResult {
  const total = Object.keys(key).length || student.responses.length;
  const score = calculateScore(student.responses, key);
  return {
    ...student,
    score,
    total,
    percentage: total ? Math.round((score / total) * 100) : 0,
  };
}

/** Keep the final response, selected box, review queue, and score together. */
export function resolveStudentResponse(
  student: StudentResult,
  number: number,
  choice: string,
  key: Record<number, string>,
): StudentResult {
  const next = {
    ...student,
    manualResponses: { ...student.manualResponses, [number]: choice },
    questions: structuredClone(student.questions),
    responses: [...student.responses],
  };
  const question = next.questions.find((q) => q.number === number);
  if (!question) throw new Error(`Question ${number + 1} is missing.`);
  if (choice !== 'Blank' && choice !== 'Unclear' && !/^[A-Z]$/.test(choice)) {
    throw new Error(`Invalid response for question ${number + 1}.`);
  }
  question.response = choice;
  question.reviewReason = undefined;
  next.responses[number] = choice;
  question.response_box = null;
  for (const box of question.boxes) {
    if (choice === 'Unclear') {
      box.colour = box.bool ? 'yellow' : null;
      continue;
    }
    box.bool = box.letter === choice;
    box.colour = box.bool ? (key[number] === choice ? 'green' : 'red') : null;
    if (box.bool) question.response_box = box;
  }
  next.incomplete = next.questions.filter((q) => q.response === false);
  next.hasAmbiguity = next.incomplete.length > 0;
  return gradeStudent(next, key);
}

/** Re-reading geometry must retain choices the teacher has already made. */
export function preserveManualResponses(
  student: StudentResult,
  previous: StudentResult | undefined,
  key: Record<number, string>,
): StudentResult {
  let result = student;
  for (const [number, choice] of Object.entries(
    previous?.manualResponses || {},
  ))
    result = resolveStudentResponse(result, Number(number), choice, key);
  return result;
}
