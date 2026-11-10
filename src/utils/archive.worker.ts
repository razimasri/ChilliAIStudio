/// <reference lib="webworker" />
import JSZip from "jszip";
self.onmessage = async (
  event: MessageEvent<{ entries: { name: string; data: Blob | string }[] }>,
) => {
  try {
    const zip = new JSZip();
    for (const entry of event.data.entries) {
      zip.file(
        entry.name,
        typeof entry.data === "string"
          ? entry.data
          : await entry.data.arrayBuffer(),
      );
    }
    const blob = await zip.generateAsync({ type: "blob" }, (progress) =>
      self.postMessage({ percent: progress.percent }),
    );
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : "Could not create archive.",
    });
  }
};
