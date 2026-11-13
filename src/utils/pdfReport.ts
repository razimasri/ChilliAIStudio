import {
  PDFDocument,
  PDFPage,
  PDFFont,
  PDFImage,
  rgb,
  type RGB,
} from "pdf-lib";
import type { PdfReport } from "./exportPdf";
import { APP_VERSION, RELEASE_NAME } from "./release";
const INK = rgb(0.08, 0.16, 0.27),
  BLUE = rgb(0.1, 0.29, 0.46),
  MUTED = rgb(0.4, 0.45, 0.52);
const PALE = rgb(0.95, 0.965, 0.98),
  RULE = rgb(0.86, 0.89, 0.92),
  GREEN = rgb(0.04, 0.43, 0.27),
  RED = rgb(0.72, 0.14, 0.15);
const GOOD = rgb(0.88, 0.95, 0.9),
  BAD = rgb(0.99, 0.89, 0.89),
  WHITE = rgb(1, 1, 1);
const LEFT = 40,
  WIDTH = 515,
  BOTTOM = 52;
type Cell = { value: string; fill?: RGB; color?: RGB; bold?: boolean };

/** Printable tables follow the supplied marking report, with the app's richer data. */
export async function appendPdfReport(
  pdf: PDFDocument,
  report: PdfReport,
  logo?: PDFImage,
): Promise<void> {
  const { StandardFonts } = await import("pdf-lib");
  const font = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage,
    y = 0,
    title = "",
    subtitle = "";
  const width = (value: string, size: number, face: PDFFont = font) => {
    try {
      return face.widthOfTextAtSize(value, size);
    } catch {
      const c = new OffscreenCanvas(1, 1),
        ctx = c.getContext("2d")!;
      ctx.font = `${face === bold ? "bold " : ""}${size}px sans-serif`;
      return ctx.measureText(value).width;
    }
  };
  const wrap = (value: string, max: number, size = 9, face = font) => {
    const lines: string[] = [];
    let line = "";
    for (const c of value.replace(/\s+/g, " ")) {
      if (line && width(line + c, size, face) > max) {
        lines.push(line.trim());
        line = c;
      } else line += c;
    }
    if (line) lines.push(line.trim());
    return lines.length ? lines : [""];
  };
  const text = async (
    value: string,
    x: number,
    baseline: number,
    size = 9,
    color = INK,
    strong = false,
  ) => {
    const face = strong ? bold : font;
    try {
      face.encodeText(value);
      page.drawText(value, { x, y: baseline, size, font: face, color });
    } catch {
      const canvas = new OffscreenCanvas(
        Math.max(1, Math.ceil(width(value, size, face) * 3) + 6),
        Math.ceil(size * 4.5),
      );
      const ctx = canvas.getContext("2d")!;
      ctx.font = `${strong ? "bold " : ""}${size * 3}px sans-serif`;
      ctx.fillStyle = `rgb(${color.red * 255},${color.green * 255},${color.blue * 255})`;
      ctx.fillText(value, 0, size * 3);
      const image = await pdf.embedPng(
        await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer(),
      );
      page.drawImage(image, {
        x,
        y: baseline - size / 2,
        width: canvas.width / 3,
        height: canvas.height / 3,
      });
      await pdf.flush();
    }
  };
  const newPage = async (heading = title, sub = subtitle) => {
    title = heading;
    subtitle = sub;
    page = pdf.addPage([595.28, 841.89]);
    y = 750;
    await text(heading.toUpperCase(), LEFT, 794, 18, INK, true);
    await text(sub, LEFT, 773, 8.5, MUTED);
    page.drawLine({
      start: { x: LEFT, y: 760 },
      end: { x: LEFT + WIDTH, y: 760 },
      thickness: 0.8,
      color: RULE,
    });
    if (logo)
      page.drawImage(logo, { x: 528, y: 797, ...logo.scaleToFit(24, 24) });
    await text(
      `ChilliMark ${RELEASE_NAME} ${APP_VERSION} | Original annotated scans precede this report`,
      LEFT,
      27,
      7.5,
      MUTED,
    );
    await text(String(pdf.getPageCount()), 540, 27, 8, MUTED);
  };
  const note = async (value: string, strong = false) => {
    for (const line of wrap(value, WIDTH, 9, strong ? bold : font)) {
      if (y < BOTTOM + 16) await newPage();
      await text(line, LEFT, y, 9, strong ? INK : MUTED, strong);
      y -= 15;
    }
  };
  const section = async (value: string) => {
    if (y < BOTTOM + 45) await newPage();
    y -= 12;
    await note(value, true);
    y -= 3;
  };
  const table = async (
    headers: string[],
    sizes: number[],
    rows: Cell[][],
    size = 9,
    dense = false,
  ) => {
    const draw = async (cells: Cell[], header = false, index = 0) => {
      const lines = cells.map((c, i) =>
        wrap(
          c.value,
          sizes[i] - 16,
          header ? 7.5 : size,
          c.bold || header ? bold : font,
        ),
      );
      const height = Math.max(
        header ? 30 : dense ? 20 : 29,
        Math.max(...lines.map((l) => l.length)) *
          (header ? 10 : dense ? size + 2 : size + 4) +
          (dense && !header ? 8 : 14),
      );
      let x = LEFT;
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        page.drawRectangle({
          x,
          y: y - height,
          width: sizes[i],
          height,
          color: header ? BLUE : cell.fill || (index % 2 ? PALE : WHITE),
          borderWidth: dense ? 0.3 : 0,
          borderColor: dense ? RULE : undefined,
        });
        for (let j = 0; j < lines[i].length; j++)
          await text(
            lines[i][j],
            x + 8,
            y - 12 - j * (header ? 10 : dense ? size + 2 : size + 4),
            header ? 7.5 : size,
            header ? WHITE : cell.color || INK,
            header || !!cell.bold,
          );
        x += sizes[i];
      }
      page.drawLine({
        start: { x: LEFT, y: y - height },
        end: { x: LEFT + WIDTH, y: y - height },
        thickness: 0.4,
        color: RULE,
      });
      y -= height;
    };
    await draw(
      headers.map((value) => ({ value })),
      true,
    );
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const height = Math.max(
        dense ? 20 : 29,
        Math.max(
          ...row.map(
            (c, j) =>
              wrap(c.value, sizes[j] - 16, size, c.bold ? bold : font).length,
          ),
        ) *
          (dense ? size + 2 : size + 4) +
          (dense ? 8 : 14),
      );
      if (y - height < BOTTOM) {
        await newPage();
        await draw(
          headers.map((value) => ({ value })),
          true,
        );
      }
      await draw(row, false, i);
    }
    y -= 12;
  };
  const { students, stats, answerKey } = report,
    count = students.length;
  const scores = students.map((s) => s.score).sort((a, b) => a - b),
    sum = scores.reduce((a, b) => a + b, 0);
  const mean = count ? sum / count : 0,
    median = count
      ? (scores[Math.floor((count - 1) / 2)] + scores[Math.floor(count / 2)]) /
        2
      : 0;
  await newPage(
    "Marking Summary",
    "Final student responses | 1 point per matching answer, no penalty",
  );
  await note(
    `Candidates: ${count} | Questions with keys: ${Object.keys(answerKey).length}`,
    true,
  );
  await note(
    `Mean score: ${mean.toFixed(1)} | Median: ${median} | Lowest: ${scores[0] ?? 0} | Highest: ${scores[scores.length - 1] ?? 0}`,
  );
  await note(
    `Mean percentage: ${(count ? students.reduce((n, s) => n + s.percentage, 0) / count : 0).toFixed(1)}%`,
  );
  y -= 10;
  await table(
    [
      "#",
      "CANDIDATE",
      "SCORE",
      "PERCENT",
      "INCORRECT / BLANK / UNCLEAR QUESTIONS",
    ],
    [30, 137, 61, 58, 229],
    students.map((s, i) => {
      const missed = Object.entries(answerKey)
        .filter(([q, key]) => s.responses[Number(q)] !== key)
        .map(([q]) => Number(q) + 1);
      return [
        { value: String(i + 1), bold: true },
        { value: s.name, bold: true },
        { value: `${s.score} / ${s.total}`, bold: true, color: INK },
        { value: `${s.percentage}%` },
        { value: missed.length ? missed.join(", ") : "All correct" },
      ];
    }),
  );
  await section("ANSWER KEY");
  const keys = Object.entries(answerKey).sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  );
  for (let start = 0; start < keys.length; start += 10) {
    if (y < BOTTOM + 15) await newPage();
    for (const [i, [q, answer]] of keys.slice(start, start + 10).entries())
      await text(
        `${Number(q) + 1}: ${answer}`,
        LEFT + (i * WIDTH) / 10,
        y,
        8,
        MUTED,
      );
    y -= 16;
  }
  await section("MARKING NOTES");
  await note(
    "Blank and unclear responses receive no mark. Manual corrections are included in the final scores.",
  );
  await note(
    "Incorrect question numbers include blank and unclear responses.",
  );
  await newPage(
    "Question Analysis",
    "Accuracy and answer-choice counts across the entire class, including blanks",
  );
  const choices = [
    ...new Set(stats.flatMap((s) => Object.keys(s.distribution))),
  ];
  // Wide option sets are split into panels so every answer distribution remains readable.
  for (let start = 0; start < choices.length; start += 6) {
    if (start) await newPage();
    const options = choices.slice(start, start + 6);
    const fixed = [30, 33, 67, 57],
      optionWidth =
        (WIDTH - fixed.reduce((a, b) => a + b, 0)) /
        Math.max(1, options.length);
    await table(
      [
        "Q",
        "KEY",
        "CORRECT",
        "ANSWERED",
        ...options.map((s) => s.toUpperCase()),
      ],
      [...fixed, ...options.map(() => optionWidth)],
      stats.map((s) => [
        { value: String(s.questionNumber), bold: true },
        { value: s.correctAnswer || "-", bold: true },
        {
          value: `${s.correctCount}/${count} (${s.correctPercent}%)`,
          color: INK,
          bold: true,
        },
        { value: String(s.totalAnswered) },
        ...options.map((option) => ({
          value: `${s.distribution[option] ?? 0} (${s.percentages[option] ?? 0}%)`,
        })),
      ]),
      8,
    );
  }
  await section("SCORE DISTRIBUTION");
  await note(
    Array.from({ length: 10 }, (_, i) => {
      const from = i * 10,
        to = i === 9 ? 100 : from + 9;
      return `${from}-${to}%: ${students.filter((s) => s.percentage >= from && s.percentage <= to).length}`;
    }).join("   |   "),
  );
  const difficulty = [...stats]
    .filter((s) => /^[A-Z]$/.test(s.correctAnswer))
    .sort((a, b) => a.correctPercent - b.correctPercent);
  await note(
    "Lowest accuracy: " +
      difficulty
        .slice(0, 5)
        .map((s) => `Q${s.questionNumber} (${s.correctPercent}%)`)
        .join(", "),
  );
  await note(
    "Highest accuracy: " +
      difficulty
        .slice(-5)
        .reverse()
        .map((s) => `Q${s.questionNumber} (${s.correctPercent}%)`)
        .join(", "),
  );
  for (let start = 0; start < count; start += 8) {
    const group = students.slice(start, start + 8);
    await newPage(
      "Question-by-question Comparison",
      "Green = matches key | Red = differs | - = blank | ? = unclear",
    );
    for (let i = 0; i < group.length; i += 2) {
      const pair = group
        .slice(i, i + 2)
        .map((s, j) =>
          wrap(`S${start + i + j + 1}: ${s.name}`, WIDTH / 2 - 12, 8),
        );
      const height = Math.max(...pair.map((lines) => lines.length)) * 12;
      if (y - height < BOTTOM + 50) await newPage();
      for (let c = 0; c < pair.length; c++)
        for (let row = 0; row < pair[c].length; row++)
          await text(
            pair[c][row],
            LEFT + (c * WIDTH) / 2,
            y - row * 12,
            8,
            MUTED,
          );
      y -= height;
    }
    y -= 8;
    const sizes = [48, 36, ...group.map(() => (WIDTH - 84) / group.length)];
    const rows: Cell[][] = stats.map((s) => [
      { value: String(s.questionNumber), bold: true },
      { value: s.correctAnswer || "-", bold: true },
      ...group.map((student) => {
        const answer = student.responses[s.questionNumber - 1],
          shown =
            answer === false || answer === "Unclear"
              ? "?"
              : !answer || answer === "Blank"
                ? "-"
                : answer,
          correct = answer === s.correctAnswer;
        return {
          value: shown,
          color: correct ? GREEN : RED,
          fill: correct ? GOOD : BAD,
          bold: true,
        };
      }),
    ]);
    rows.push([
      { value: "TOTAL", fill: BLUE, color: WHITE, bold: true },
      {
        value: String(Object.keys(answerKey).length),
        fill: BLUE,
        color: WHITE,
        bold: true,
      },
      ...group.map((s) => ({
        value: String(s.score),
        fill: BLUE,
        color: WHITE,
        bold: true,
      })),
    ]);
    await table(
      ["Q", "KEY", ...group.map((_, i) => `S${start + i + 1}`)],
      sizes,
      rows,
      9,
      true,
    );
  }
}
