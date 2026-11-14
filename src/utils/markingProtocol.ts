import type { AlignmentOptions } from './omrEngine';
import type {
  CalibrationParams,
  StudentResult,
  MarkingGeometryOptions,
} from "../types";
export type MarkingRequest =
  | {
      type: "mark";
      input: Blob | ImageBitmap;
      name: string;
      index: number;
      params: CalibrationParams;
      geometry?: MarkingGeometryOptions;
      alignment?: AlignmentOptions;
    }
  | { type: "annotate"; student: StudentResult; params: CalibrationParams };
export interface PackedStudent {
  student: Omit<
    StudentResult,
    | "annotatedDataUrl"
    | "rawDeskewedDataUrl"
    | "originalDataUrl"
    | "ambiguityCrops"
  >;
  annotated: Blob;
  raw?: Blob;
  crops: Record<number, Blob>;
}
export type MarkingReply =
  | { type: "progress"; message: string }
  | { type: "marked"; result: PackedStudent }
  | { type: "annotated"; image: Blob }
  | { type: "error"; message: string };
