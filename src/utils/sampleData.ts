export const CAMBRIDGE_SAMPLE_STUDENTS = [
  'Alexander Ward',
  'Beatrice Chen',
  'Cameron Diaz',
  'Daniel Foster',
  'Eleanor Rigby',
  'Felix Kruger',
  'Gabriel Montez',
  'Hannah Abbott',
  'Isabella Rossi',
  'Jonathan Crane',
  'Katherine Pierce',
  'Liam Hemsworth',
  'Madeline Stowe',
  'Nicholas Brody',
];

export const IBDP_SAMPLE_STUDENTS = [
  'Ariadne Vance',
  'Benjamin Linus',
  'Clara Oswald',
  'Desmond Hume',
  'Emily Thorne',
  'Finnick Odair',
  'Genevieve Lacroix',
  'Hector Salamanca',
  'Iris West',
  'Julian Bashir',
  'Kiera Cameron',
];

export const SAMPLE_STUDENT_NAMES = CAMBRIDGE_SAMPLE_STUDENTS;

export const SAMPLE_ANSWER_KEY_40 = 'BACDBCADAABDCADBCAADBCADBCADAABDCADBCADB';

export const REAL_SAMPLE_CONFIGS = {
  cambridge: {
    name: 'IGSample.pdf',
    label: 'Cambridge IGCSE 0620 (14 Sheets)',
    badge: '14 Authenticated Scans',
    url: '/assets/aistudio/IGSample_bab86a83.pdf',
    totalQuestions: 27,
    choices: 4,
    answerKey: SAMPLE_ANSWER_KEY_40.slice(0, 27),
    studentNames: CAMBRIDGE_SAMPLE_STUDENTS,
    defaultParams: {
      x1: 200,
      y1: 1100,
      x2: 4400,
      y2: 6100,
      w: 60,
      h: 45,
      choices: 4,
      totalQuestions: 27,
      fill_limit: 75,
    },
  },
  ibdp: {
    name: 'IBSample.pdf',
    label: 'IBDP Examination Paper 1 (11 Sheets)',
    badge: '11 Authenticated Scans',
    url: '/assets/aistudio/IBSample_719b8592.pdf',
    totalQuestions: 30,
    choices: 4,
    answerKey: SAMPLE_ANSWER_KEY_40.slice(0, 30),
    studentNames: IBDP_SAMPLE_STUDENTS,
    defaultParams: {
      x1: 250,
      y1: 1150,
      x2: 4350,
      y2: 5950,
      w: 55,
      h: 42,
      choices: 4,
      totalQuestions: 30,
      fill_limit: 75,
    },
  },
};

/**
 * Creates a synthetic multiple-choice answer sheet strictly matching either
 * Cambridge IGCSE (2 columns of 20, shaded boxes) or
 * IBDP (4 columns of 10, square boxes with pencil "X" marks).
 */
export function generateSyntheticExamSheet(
  studentName: string,
  answers: Record<number, string>,
  fillRates: Record<number, string>,
  sheetVariant: 'cambridge' | 'ibdp' = 'cambridge'
): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1700;
  const ctx = canvas.getContext('2d')!;

  // Clean paper background with realistic warm paper tint
  ctx.fillStyle = '#fdfcfa';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Outer paper frame border
  ctx.strokeStyle = '#2d2d2d';
  ctx.lineWidth = 2;
  ctx.strokeRect(60, 45, 1080, 1610);

  // Header Title
  ctx.fillStyle = '#111111';
  ctx.font = 'bold 24px "Times New Roman", serif';

  if (sheetVariant === 'cambridge') {
    ctx.fillText('CAMBRIDGE ASSESSMENT INTERNATIONAL EDUCATION', 90, 100);
    ctx.font = '16px "Times New Roman", serif';
    ctx.fillText('International General Certificate of Secondary Education (IGCSE)', 90, 130);
    ctx.font = 'italic 13px sans-serif';
    ctx.fillStyle = '#444444';
    ctx.fillText('Science Multiple Choice Answer Sheet (Paper 1 / Paper 2) — 40 Questions', 90, 155);
  } else {
    ctx.fillText('INTERNATIONAL BACCALAUREATE DIPLOMA PROGRAMME', 90, 100);
    ctx.font = '16px "Times New Roman", serif';
    ctx.fillText('Diploma Programme Examination — Multiple Choice Answer Sheet (Section A)', 90, 130);
    ctx.font = 'italic 13px sans-serif';
    ctx.fillStyle = '#444444';
    ctx.fillText('Mark an [X] in the box of the chosen answer. 4 columns of 10 questions.', 90, 155);
  }

  // Candidate Details Card
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(90, 175, 1020, 60);

  ctx.fillStyle = '#222222';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('CANDIDATE NAME:', 105, 210);
  ctx.font = 'bold 18px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(studentName.toUpperCase(), 235, 212);

  ctx.font = 'bold 12px sans-serif';
  ctx.fillText('CENTRE NO: EX902', 740, 210);
  ctx.fillText('CANDIDATE NO: 0021', 890, 210);

  // Instructions
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#333333';
  if (sheetVariant === 'cambridge') {
    ctx.fillText(
      '• Use soft HB pencil. Shade one box [A, B, C, D] completely. Erase thoroughly to change.',
      90,
      265
    );
  } else {
    ctx.fillText(
      '• Use soft HB pencil. Mark a distinct cross [X] in the box. To cancel, blacken the box and mark an [X] in your new choice.',
      90,
      265
    );
  }

  // The large questions area box
  const qAreaX = 90;
  const qAreaY = 285;
  const qAreaW = 1020;
  const qAreaH = 1320;

  ctx.strokeStyle = '#222222';
  ctx.lineWidth = 3;
  ctx.strokeRect(qAreaX, qAreaY, qAreaW, qAreaH);

  if (sheetVariant === 'cambridge') {
    // -------------------------------------------------------------
    // CAMBRIDGE IGCSE LAYOUT: 2 Columns of 20 questions (1-20, 21-40)
    // -------------------------------------------------------------
    const colW = qAreaW / 2;
    const rowH = qAreaH / 20.8;

    for (let q = 1; q <= 40; q++) {
      const colIdx = q <= 20 ? 0 : 1;
      const rowIdx = (q - 1) % 20;

      const startX = qAreaX + colIdx * colW;
      const startY = qAreaY + (rowIdx + 0.35) * rowH;

      // Question Number
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`${q < 10 ? '  ' + q : q}.`, startX + 25, startY + 22);

      const options = ['A', 'B', 'C', 'D'];
      const chosenLetter = fillRates[q] || answers[q];

      for (let o = 0; o < 4; o++) {
        const letter = options[o];
        // Authentic Cambridge IGCSE rectangular answer slot
        const boxW = 34;
        const boxH = 18;
        const boxX = startX + 100 + o * 78;
        const boxY = startY + 6;

        // Draw Box Outline
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // Letter inside box
        ctx.fillStyle = '#555555';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(letter, boxX + 12, boxY + 14);

        // Solid graphite shading for Cambridge
        if (chosenLetter && chosenLetter.includes(letter)) {
          ctx.fillStyle = '#262626';
          ctx.fillRect(boxX + 2, boxY + 2, boxW - 4, boxH - 4);

          // Graphite pencil texture sheen
          ctx.strokeStyle = '#111111';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(boxX + 3, boxY + 3);
          ctx.lineTo(boxX + boxW - 3, boxY + boxH - 3);
          ctx.stroke();
        }
      }
    }

    // Column Divider
    ctx.strokeStyle = '#cccccc';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(qAreaX + colW, qAreaY + 15);
    ctx.lineTo(qAreaX + colW, qAreaY + qAreaH - 15);
    ctx.stroke();
  } else {
    // -------------------------------------------------------------
    // IBDP EXAMINATION LAYOUT: 3 UNEVEN COLUMNS (1-15, 16-30, 31-40)
    // Marked with pencil Cross [X] inside rectangular boxes
    // -------------------------------------------------------------
    const colW = qAreaW / 3;
    const maxRows = 15;
    const rowH = (qAreaH - 60) / maxRows;

    // Draw Column Headers: Question No. and Options A B C D
    for (let c = 0; c < 3; c++) {
      const startX = qAreaX + c * colW;
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 13px sans-serif';
      ctx.fillText('No.', startX + 18, qAreaY + 30);
      ctx.fillText('A', startX + 80, qAreaY + 30);
      ctx.fillText('B', startX + 135, qAreaY + 30);
      ctx.fillText('C', startX + 190, qAreaY + 30);
      ctx.fillText('D', startX + 245, qAreaY + 30);

      // Header underline
      ctx.strokeStyle = '#666666';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(startX + 10, qAreaY + 38);
      ctx.lineTo(startX + colW - 10, qAreaY + 38);
      ctx.stroke();
    }

    for (let q = 1; q <= 40; q++) {
      let colIdx = 0;
      let rowIdx = 0;

      if (q <= 15) {
        colIdx = 0;
        rowIdx = q - 1;
      } else if (q <= 30) {
        colIdx = 1;
        rowIdx = q - 16;
      } else {
        colIdx = 2;
        rowIdx = q - 31;
      }

      const startX = qAreaX + colIdx * colW;
      const startY = qAreaY + 48 + rowIdx * rowH;

      // Question Number
      ctx.fillStyle = '#111111';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(`${q < 10 ? '  ' + q : q}`, startX + 18, startY + 24);

      const options = ['A', 'B', 'C', 'D'];
      const chosenLetter = fillRates[q] || answers[q];

      for (let o = 0; o < 4; o++) {
        const letter = options[o];
        // IBDP Rectangular Box dimensions (width 32px, height 22px)
        const boxW = 32;
        const boxH = 22;
        const boxX = startX + 70 + o * 55;
        const boxY = startY + 6;

        // Box border
        ctx.strokeStyle = '#333333';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        // IBDP Marking: Candidates mark an [X] inside the rectangular box!
        if (chosenLetter && chosenLetter.includes(letter)) {
          ctx.strokeStyle = '#1e1e1e';
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(boxX + 5, boxY + 4);
          ctx.lineTo(boxX + boxW - 5, boxY + boxH - 4);
          ctx.moveTo(boxX + boxW - 5, boxY + 4);
          ctx.lineTo(boxX + 5, boxY + boxH - 4);
          ctx.stroke();
        }
      }
    }

    // Dividers between the 3 columns
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1.5;
    for (let c = 1; c < 3; c++) {
      ctx.beginPath();
      ctx.moveTo(qAreaX + c * colW, qAreaY + 15);
      ctx.lineTo(qAreaX + c * colW, qAreaY + qAreaH - 15);
      ctx.stroke();
    }
  }

  return canvas.toDataURL('image/png');
}

/**
 * Generates sample demo batch
 */
export async function generateSampleDemoBatch(variant: 'cambridge' | 'ibdp' = 'cambridge'): Promise<{
  pages: { name: string; dataUrl: string; expectedScore: number }[];
  studentNames: string[];
  answerKey: string;
  variant: 'cambridge' | 'ibdp';
  defaultParams: {
    qArea: { x1: number; y1: number; x2: number; y2: number };
    sampleBox: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
    w: number;
    h: number;
    fill_limit: number;
    choices: number;
  };
}> {
  const answerKeyArray = SAMPLE_ANSWER_KEY_40.split('');
  const keyMap: Record<number, string> = {};
  answerKeyArray.forEach((letter, i) => {
    keyMap[i + 1] = letter;
  });

  const pages = SAMPLE_STUDENT_NAMES.map((studentName, idx) => {
    const studentChoices: Record<number, string> = {};
    let scoreCount = 0;
    const targetScore = Math.max(20, 40 - idx * 2 - (idx % 3));

    for (let q = 1; q <= 40; q++) {
      const correct = keyMap[q];
      if (scoreCount < targetScore && Math.random() < targetScore / 40) {
        studentChoices[q] = correct;
        scoreCount++;
      } else {
        const options = ['A', 'B', 'C', 'D'];
        const wrongOptions = options.filter((o) => o !== correct);
        studentChoices[q] = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
      }
    }

    // Add ambiguous mark on student 2 (marked both B and C)
    if (idx === 1) {
      studentChoices[12] = 'BC';
    }

    const dataUrl = generateSyntheticExamSheet(studentName, keyMap, studentChoices, variant);

    return {
      name: studentName,
      dataUrl,
      expectedScore: scoreCount,
    };
  });

  const defaultParams =
    variant === 'cambridge'
      ? {
          qArea: { x1: 90, y1: 285, x2: 1110, y2: 1605 },
          sampleBox: { x1: 190, y1: 295, x2: 224, y2: 313, w: 34, h: 18 },
          w: 34,
          h: 18,
          inner_w: 26,
          inner_h: 12,
          fill_limit: 65,
          choices: 4,
        }
      : {
          qArea: { x1: 90, y1: 285, x2: 1110, y2: 1605 },
          sampleBox: { x1: 168, y1: 340, x2: 193, y2: 365, w: 25, h: 25 },
          w: 25,
          h: 25,
          inner_w: 18,
          inner_h: 18,
          fill_limit: 75,
          choices: 4,
        };

  return {
    pages,
    studentNames: SAMPLE_STUDENT_NAMES,
    answerKey: SAMPLE_ANSWER_KEY_40,
    variant,
    defaultParams,
  };
}

