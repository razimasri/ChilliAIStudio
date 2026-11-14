import { PDFDocument } from 'pdf-lib';
import { pdfPageJpeg } from './pdfPageImage';
import { appendPdfReport } from './pdfReport';
import {APP_VERSION,RELEASE_NAME} from './release';
import type { PdfReport } from './exportPdf';

self.onmessage = async ({ data: report }: MessageEvent<PdfReport>) => {
  try {
    const pdf = await PDFDocument.create();
    pdf.setTitle('ChilliMark Annotated Work and Class Report');
    pdf.setCreator(`ChilliMark ${RELEASE_NAME} ${APP_VERSION}`);
    const logoResponse = await fetch('/icons/printmark.png');
    const logo = logoResponse.ok ? await pdf.embedPng(await logoResponse.arrayBuffer()) : undefined;
    for (const [index, student] of report.students.entries()) {
      const response = await fetch(student.annotatedDataUrl);
      if (!response.ok) throw new Error(`Could not read marked sheet for ${student.name}`);
      const jpeg = await pdfPageJpeg(await response.blob());
      const image = await pdf.embedJpg(await jpeg.arrayBuffer());
      const [width, height] = image.width > image.height ? [841.89, 595.28] : [595.28, 841.89];
      const page = pdf.addPage([width, height]);
      const size = image.scale(Math.min(width / image.width, height / image.height));
      page.drawImage(image, { x: (width-size.width)/2, y: (height-size.height)/2, ...size });
      // Flush each compressed page before opening the next high-resolution sheet.
      await pdf.flush();
      self.postMessage({ percent: Math.round((index + 1) / Math.max(1, report.students.length) * 85) });
    }
    await appendPdfReport(pdf, report, logo);
    self.postMessage({percent:95});
    const bytes = await pdf.save();
    self.postMessage({ blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) });
  } catch(error) { self.postMessage({error: error instanceof Error ? error.message : 'Could not create PDF.'}); }
};
