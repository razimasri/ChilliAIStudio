import React, { useEffect, useRef, useState } from "react";
import { ExamFile } from "../types";
import { getExamPage } from "../utils/pdfProcessor";

export function PagePreview({
  file,
  alt,
  className,
  edge = 360,
}: {
  file: ExamFile;
  alt: string;
  className?: string;
  edge?: number;
}) {
  const ref = useRef<HTMLImageElement>(null);
  const [url, setUrl] = useState(file.dataUrl);
  useEffect(() => {
    setUrl(file.dataUrl);
    if (!file.sourceFile) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void getExamPage(file, edge, controller.signal)
        .then((image) => {
          if (controller.signal.aborted) {
            image.release();
            return;
          }
          release = image.release;
          setUrl(image.url);
        })
        .catch((error) => {
          if (!controller.signal.aborted)
            console.warn("Preview unavailable", error);
        });
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        load();
      }
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      observer.disconnect();
      controller.abort();
      release?.();
    };
  }, [file.id, file.rotation, file.sourceFile, file.dataUrl, edge]);
  return <img ref={ref} src={url} alt={alt} className={className} />;
}
