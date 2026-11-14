import type { AlignmentOptions } from './omrEngine';
import type { MarkingGeometryOptions, CalibrationParams, StudentResult } from "../types";
import type {
  MarkingRequest,
  MarkingReply,
  PackedStudent,
} from "./markingProtocol";
import { imageUrl } from "./imageStore";
function unpack(packed: PackedStudent): StudentResult {
  const urls = new Map<Blob, string>();
  const own = (blob: Blob) => {
    let url = urls.get(blob);
    if (!url) {
      url = imageUrl(blob);
      urls.set(blob, url);
    }
    return url;
  };
  return {
    ...packed.student,
    annotatedDataUrl: own(packed.annotated),
    rawDeskewedDataUrl: packed.raw ? own(packed.raw) : undefined,
    originalDataUrl: "",
    ambiguityCrops: Object.fromEntries(
      Object.entries(packed.crops).map(([number, blob]) => [number, own(blob)]),
    ),
  };
}
/** One active page per worker. Terminating also interrupts synchronous native CV. */
export class MarkingClient {
  private worker: Worker;
  private closed: Error | DOMException | undefined;
  private pending:
    | {
        resolve: (reply: MarkingReply) => void;
        reject: (error: Error | DOMException) => void;
        progress: (message: string) => void;
      }
    | undefined;
  constructor() {
    if (
      typeof Worker === "undefined" ||
      typeof OffscreenCanvas === "undefined" ||
      typeof createImageBitmap === "undefined"
    )
      throw new Error(
        "Background marking needs a browser with Worker, OffscreenCanvas and createImageBitmap support.",
      );
    this.worker = new Worker(new URL("./marking.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<MarkingReply>) => {
      const pending = this.pending;
      if (!pending) return;
      const reply = event.data;
      if (reply.type === "progress") {
        pending.progress(reply.message);
        return;
      }
      this.pending = undefined;
      if (reply.type === "error") pending.reject(new Error(reply.message));
      else pending.resolve(reply);
    };
    this.worker.onerror = (event) =>
      this.dispose(
        new Error(event.message || "Background marking worker failed."),
      );
    this.worker.onmessageerror = () =>
      this.dispose(new Error("Could not read background marking output."));
  }
  private request(
    request: MarkingRequest,
    progress: (message: string) => void,
  ): Promise<MarkingReply> {
    if (this.closed) return Promise.reject(this.closed);
    if (this.pending)
      return Promise.reject(new Error("Marking worker is busy."));
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject, progress };
      try {
        this.worker.postMessage(
          request,
          request.type === "mark" && request.input instanceof ImageBitmap
            ? [request.input]
            : [],
        );
      } catch (error) {
        this.pending = undefined;
        reject(error);
      }
    });
  }
  async mark(
    input: Blob | ImageBitmap,
    name: string,
    index: number,
    params: CalibrationParams,
    progress: (message: string) => void,
    geometry?: MarkingGeometryOptions,
    alignment?: AlignmentOptions,
  ): Promise<StudentResult> {
    const reply = await this.request(
      { type: "mark", input, name, index, params, geometry, alignment },
      progress,
    );
    if (reply.type !== "marked") throw new Error("Unexpected marking reply.");
    return unpack(reply.result);
  }
  async annotate(
    student: StudentResult,
    params: CalibrationParams,
  ): Promise<string> {
    const reply = await this.request(
      { type: "annotate", student, params },
      () => {},
    );
    if (reply.type !== "annotated")
      throw new Error("Unexpected annotation reply.");
    return imageUrl(reply.image);
  }
  dispose(
    error: Error | DOMException = new DOMException("Cancelled", "AbortError"),
  ): void {
    if (this.closed) return;
    this.closed = error;
    this.worker.terminate();
    this.pending?.reject(error);
    this.pending = undefined;
  }
}
