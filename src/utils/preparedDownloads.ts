import type { StudentResult, QuestionStat } from "../types";
import { prepareAnnotatedPdf } from "./exportPdf";
import { exportArchive, type ArchiveEntry } from "./exportArchive";
import { exportStudentScoresCsv, exportQuestionStatsCsv } from "./omrEngine";

/** One PDF job followed by one ZIP job. Buttons share and retain the same promises. */
export class PreparedDownloads {
  readonly controller = new AbortController();
  private sheets?: Blob[];
  private pdfJob?: Promise<Blob>;
  private zipJob?: Promise<Blob>;
  onProgress?: (stage: "pdf" | "zip", percent: number) => void;
  constructor(
    private students: StudentResult[],
    private stats: QuestionStat[],
    private answerKey: Record<number, string>,
    private prepareSheets: () => Promise<void> = () => Promise.resolve(),
  ) {}
  pdf(): Promise<Blob> {
    this.controller.signal.throwIfAborted();
    if (!this.pdfJob) {
      const promise = this.prepareSheets().then(() => {
        this.controller.signal.throwIfAborted();
        return prepareAnnotatedPdf(
        {
          students: this.students.map(
            ({
              name,
              score,
              total,
              percentage,
              responses,
              annotatedDataUrl,
            }) => ({
              name,
              score,
              total,
              percentage,
              responses,
              annotatedDataUrl,
            }),
          ),
          stats: this.stats,
          answerKey: this.answerKey,
        },
        (percent) => this.onProgress?.("pdf", percent),
        this.controller.signal,
      );
      }).then(({ pdf, sheets }) => {
        this.controller.signal.throwIfAborted();
        if (sheets.length !== this.students.length) throw new Error("Missing JPEG sheets from PDF export.");
        this.sheets = sheets;
        this.onProgress?.("pdf", 100);
        return pdf;
      });
      this.pdfJob = promise;
      void promise.catch(() => {
        if (this.pdfJob === promise) this.pdfJob = undefined;
      });
    }
    return this.pdfJob;
  }
  all(): Promise<Blob> {
    this.controller.signal.throwIfAborted();
    if (!this.zipJob) {
      const promise = this.buildArchive();
      this.zipJob = promise;
      void promise.catch(() => {
        if (this.zipJob === promise) this.zipJob = undefined;
      });
    }
    return this.zipJob;
  }
  private async buildArchive(): Promise<Blob> {
    const pdf = await this.pdf(),
      signal = this.controller.signal;
    signal.throwIfAborted();
    this.onProgress?.("zip", 0);
    const folder = "ChilliMark_Annotated_Student_Sheets/";
    const entries: ArchiveEntry[] = [
      { name: folder + "ChilliMark_Annotated_Report.pdf", data: pdf },
    ];
    for (const [index, student] of this.students.entries()) {
      entries.push({
        name: `${folder}${String(index + 1).padStart(2, "0")}_${student.name.replace(/\s+/g, "_")}_Score_${student.score}of${student.total}.jpg`,
        data: this.sheets![index],
      });
    }
    entries.push({
      name: folder + "Class_Scores_Summary.csv",
      data: exportStudentScoresCsv(this.students, this.answerKey),
    });
    entries.push({
      name: folder + "Question_Statistics.csv",
      data: exportQuestionStatsCsv(this.stats),
    });
    return exportArchive(
      entries,
      (percent) => this.onProgress?.("zip", percent),
      signal,
    );
  }
  dispose(): void {
    this.controller.abort();
    this.onProgress = undefined;
    this.pdfJob = undefined;
    this.zipJob = undefined;
    this.sheets = undefined;
  }
}
