/// <reference lib="webworker" />
import { getCV } from "./cvLoader";
import {
  processStudentScan,
  renderStudentFinalAnnotation,
  decodeCVError,
} from "./omrEngine";
import { imageUrl, releaseAllImages } from "./imageStore";
import type {
  MarkingRequest,
  MarkingReply,
  PackedStudent,
} from "./markingProtocol";
import type { StudentResult } from "../types";
function send(reply: MarkingReply): void {
  self.postMessage(reply);
}
async function pack(result: StudentResult): Promise<PackedStudent> {
  const {
    annotatedDataUrl,
    rawDeskewedDataUrl,
    originalDataUrl,
    ambiguityCrops,
    ...student
  } = result;
  const blobs = new Map<string, Promise<Blob>>();
  const read = (url: string) => {
    let blob = blobs.get(url);
    if (!blob) {
      blob = fetch(url).then((response) => {
        if (!response.ok) throw new Error("Could not read worker output.");
        return response.blob();
      });
      blobs.set(url, blob);
    }
    return blob;
  };
  return {
    student,
    annotated: await read(annotatedDataUrl),
    raw: rawDeskewedDataUrl ? await read(rawDeskewedDataUrl) : undefined,
    crops: Object.fromEntries(
      await Promise.all(
        Object.entries(ambiguityCrops || {}).map(async ([number, url]) => [
          number,
          await read(url),
        ]),
      ),
    ),
  };
}
// The client sends at most one request at a time to each isolated OpenCV runtime.
let busy = false;
self.onmessage = async (event: MessageEvent<MarkingRequest>) => {
  if (busy) {
    send({
      type: "error",
      message: "Marking worker is already processing a page.",
    });
    return;
  }
  const bitmap =
    event.data.type === "mark" && event.data.input instanceof ImageBitmap
      ? event.data.input
      : undefined;
  busy = true;
  let cv: any;
  try {
    send({ type: "progress", message: "Preparing background marking engine…" });
    cv = await getCV();
    const request = event.data;
    if (request.type === "mark") {
      const result = await processStudentScan(
        cv,
        request.input instanceof Blob ? imageUrl(request.input) : request.input,
        request.name,
        request.index,
        request.params,
        (message) => send({ type: "progress", message }),
        request.geometry,
      );
      send({ type: "marked", result: await pack(result) });
    } else {
      const url = await renderStudentFinalAnnotation(
        cv,
        request.student,
        request.params,
      );
      send({ type: "annotated", image: await (await fetch(url)).blob() });
    }
  } catch (error) {
    send({ type: "error", message: decodeCVError(cv, error) });
  } finally {
    bitmap?.close();
    releaseAllImages();
    busy = false;
  }
};
