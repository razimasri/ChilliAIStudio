import { measureSelectedBox } from '../utils/calibrationSelection';
import { useCanvasPointer } from '../utils/useCanvasPointer';
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { CalibrationParams, ExamFile } from '../types';
import { getExamPage } from '../utils/pdfProcessor';
import { canvasImage, releaseImage } from '../utils/imageStore';
import { getCV } from '../utils/cvLoader';
import {
  renderToCanonicalMat,
  renderScanMat,
  rotation,
  set_box,
} from '../utils/omrEngine';
import { TEMPLATE_HEIGHT, TEMPLATE_WIDTH } from '../utils/pageGeometry';

interface CalibrationStepProps {
  firstFile: ExamFile;
  params: CalibrationParams;
  onParamsChange: (params: CalibrationParams) => void;
  onBack: () => void;
  onProceedToMark: () => void;
}

export const CalibrationStep: React.FC<CalibrationStepProps> = ({
  firstFile,
  params,
  onParamsChange,
  onBack,
  onProceedToMark,
}) => {
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const boxCanvasRef = useRef<HTMLCanvasElement>(null);

  // Calibration stages:
  // Stage 1: "Select the question area"
  // Stage 2: "Now select one empty box"
  const [step, setStep] = useState<'qArea' | 'sampleBox'>('qArea');
  const [isInitializingTemplate, setIsInitializingTemplate] =
    useState<boolean>(true);
  const [canonicalTemplateDataUrl, setCanonicalTemplateDataUrl] = useState<
    string | null
  >(null);

  // Zoom controls for Step 1 (Question Area)
  const [qZoom, setQZoom] = useState<number>(1.0);

  // Zoom controls for Step 2
  const [zoomLevel, setZoomLevel] = useState<number>(1.5);
  const [preparation, setPreparation] = useState('Loading the marking engine…');
  const [isSnapping, setIsSnapping] = useState<boolean>(false);
  const [snapStatus, setSnapStatus] = useState<string | null>(null);

  // Drawing state for Question Area (on canonical main canvas)
  const [isDrawingQ, setIsDrawingQ] = useState(false);
  const [qStart, setQStart] = useState<{ x: number; y: number } | null>(null);
  const [qCurrent, setQCurrent] = useState<{ x: number; y: number } | null>(
    null,
  );

  // Drawing state for Sample Box (on cropped Q-Area canvas)
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [boxCurrent, setBoxCurrent] = useState<{ x: number; y: number } | null>(
    null,
  );

  const [hasValidBox, setHasValidBox] = useState(params.w > 0 && params.h > 0);
  const [qAreaImage, setQAreaImage] = useState<HTMLCanvasElement | null>(null);

  const [templateError, setTemplateError] = useState<string | null>(null);

  // Initialize canonical template & calculate calibration sheet's largest contour rect (Python lines 384-387)
  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    let templateUrl: string | undefined;
    async function initTemplate() {
      setIsInitializingTemplate(true);
      setTemplateError(null);
      setCanonicalTemplateDataUrl(null);
      setHasValidBox(false);
      try {
        setPreparation('Loading the marking engine…');
        const cv = await getCV();
        if (isCancelled) return;
        setPreparation('Rendering the first page at 600 DPI…');
        let rotatedMat: any = null;
        const raster = await getExamPage(
          firstFile,
          undefined,
          controller.signal,
        );
        let rawMat: any;
        try {
          rawMat = await renderToCanonicalMat(cv, raster.url);
        } finally {
          raster.release();
        }
        setPreparation('Aligning the first page…');
        await new Promise((resolve) => setTimeout(resolve, 0));
        let sheetRect: [number, number, number, number];
        try {
          const rotRes = rotation(cv, rawMat);
          rotatedMat = rotRes.rotated;
          sheetRect = rotRes.rect;
        } finally {
          rawMat.delete();
        }

        if (isCancelled) {
          if (rotatedMat) rotatedMat.delete();
          return;
        }

        const canvas = document.createElement('canvas');
        cv.imshow(canvas, rotatedMat);
        rotatedMat.delete();

        let dataUrl: string;
        try {
          dataUrl = await canvasImage(canvas);
        } finally {
          canvas.width = 0;
          canvas.height = 0;
        }
        if (isCancelled) {
          releaseImage(dataUrl);
          return;
        }
        templateUrl = dataUrl;
        canvas.width = 0;
        canvas.height = 0;
        setCanonicalTemplateDataUrl(dataUrl);

        onParamsChange({
          ...params,
          rect: sheetRect, // [rx, ry, rw, rh] from calibration sheet
          templateDataUrl: dataUrl,
        });
      } catch (e: any) {
        console.error('Failed to initialize calibration template:', e);
        if (!isCancelled) {
          // A raw 600-DPI page is not in template coordinates. Do not let a
          // failed initialization accept selections in a different frame.
          setTemplateError(
            e?.message || 'Could not align the calibration page.',
          );
        }
      } finally {
        if (!isCancelled) setIsInitializingTemplate(false);
      }
    }

    initTemplate();
    return () => {
      isCancelled = true;
      controller.abort();
      releaseImage(templateUrl);
    };
  }, [firstFile.id, firstFile.rotation, firstFile.dataUrl]);

  // Draw Main Canvas (Step 1: Select Question Area on canonical template)
  const renderMainCanvas = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas || !canonicalTemplateDataUrl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = TEMPLATE_WIDTH;
      canvas.height = TEMPLATE_HEIGHT;

      // Draw canonical 4800x6840 deskewed scan
      ctx.drawImage(img, 0, 0);

      // Current drag or existing Q-Area
      let x1 = params.x1;
      let y1 = params.y1;
      let x2 = params.x2;
      let y2 = params.y2;

      if (isDrawingQ && qStart && qCurrent) {
        x1 = Math.min(qStart.x, qCurrent.x);
        y1 = Math.min(qStart.y, qCurrent.y);
        x2 = Math.max(qStart.x, qCurrent.x);
        y2 = Math.max(qStart.y, qCurrent.y);
      }

      if (x2 > x1 && y2 > y1) {
        // Dim area outside selection
        ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
        ctx.fillRect(0, 0, canvas.width, y1);
        ctx.fillRect(0, y2, canvas.width, canvas.height - y2);
        ctx.fillRect(0, y1, x1, y2 - y1);
        ctx.fillRect(x2, y1, canvas.width - x2, y2 - y1);

        // Dashed bounding rectangle matching Gui.py
        ctx.strokeStyle = '#f3b0ba';
        ctx.lineWidth = 6;
        ctx.setLineDash([30, 20]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);

        // Label
        ctx.fillStyle = '#8c1529';
        ctx.fillRect(x1, Math.max(0, y1 - 60), 280, 60);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 32px sans-serif';
        ctx.fillText('Question Area', x1 + 20, Math.max(42, y1 - 18));
      }
    };
    img.src = canonicalTemplateDataUrl;
    return () => {
      img.onload = null;
    };
  }, [
    canonicalTemplateDataUrl,
    params.x1,
    params.y1,
    params.x2,
    params.y2,
    isDrawingQ,
    qStart,
    qCurrent,
  ]);

  useEffect(() => {
    return renderMainCanvas();
  }, [renderMainCanvas, step, isInitializingTemplate]);

  // Update Cropped Question Area Canvas for Step 2
  const updateQAreaCanvas = useCallback(() => {
    const { x1, y1, x2, y2 } = params;
    const qw = Math.abs(x2 - x1);
    const qh = Math.abs(y2 - y1);
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);

    if (qw <= 20 || qh <= 20 || !canonicalTemplateDataUrl) return;

    setQAreaImage(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const qCanvas = document.createElement('canvas');
      qCanvas.width = qw;
      qCanvas.height = qh;
      const qCtx = qCanvas.getContext('2d');
      if (!qCtx) return;
      qCtx.drawImage(img, minX, minY, qw, qh, 0, 0, qw, qh);
      setQAreaImage(qCanvas);

      // If boxCanvas is currently mounted, paint immediately to prevent blank frame
      if (boxCanvasRef.current) {
        boxCanvasRef.current.width = qw;
        boxCanvasRef.current.height = qh;
        const bCtx = boxCanvasRef.current.getContext('2d');
        if (bCtx) {
          bCtx.drawImage(qCanvas, 0, 0);
        }
      }
    };
    img.onerror = () =>
      setTemplateError(
        'Could not prepare the selected grid. Go back and select the area again.',
      );
    img.src = canonicalTemplateDataUrl;
    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [canonicalTemplateDataUrl, params.x1, params.y1, params.x2, params.y2]);

  useEffect(() => {
    return updateQAreaCanvas();
  }, [updateQAreaCanvas]);

  // Draw Sample Box Canvas (Step 2: Select One Empty Box)
  const renderBoxCanvas = useCallback(() => {
    const canvas = boxCanvasRef.current;
    if (!canvas || !qAreaImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = qAreaImage.width;
    canvas.height = qAreaImage.height;

    // Draw cropped question area
    ctx.drawImage(qAreaImage, 0, 0);

    // Current drag or snapped box
    let bx1 = 0;
    let by1 = 0;
    let bx2 = 0;
    let by2 = 0;

    if (isDrawingBox && boxStart && boxCurrent) {
      bx1 = Math.min(boxStart.x, boxCurrent.x);
      by1 = Math.min(boxStart.y, boxCurrent.y);
      bx2 = Math.max(boxStart.x, boxCurrent.x);
      by2 = Math.max(boxStart.y, boxCurrent.y);

      ctx.strokeStyle = '#e11d48';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);
      ctx.setLineDash([]);
    } else if (hasValidBox && params.box_x1 > 0) {
      const localW = params.w;
      const localH = params.h;
      const localX = params.box_x1 - params.x1;
      const localY = params.box_y1 - params.y1;

      // Draw clean bounding rectangle for the box
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 4;
      ctx.strokeRect(localX, localY, localW, localH);

      // Preview the measured cavity rather than an invented inset rectangle.
      const cx = localX + localW / 2;
      const cy = localY + localH / 2;
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      if (params.inner.length) {
        ctx.beginPath();
        params.inner.forEach((point, index) => {
          if (index === 0) ctx.moveTo(cx + point.x, cy + point.y);
          else ctx.lineTo(cx + point.x, cy + point.y);
        });
        ctx.closePath();
        ctx.stroke();
      }
      ctx.setLineDash([]);

      // Center crosshair
      ctx.fillStyle = '#10b981';
      ctx.fillRect(cx - 2, cy - localH / 2 - 8, 4, localH + 16);
      ctx.fillRect(cx - localW / 2 - 8, cy - 2, localW + 16, 4);
    }
  }, [qAreaImage, isDrawingBox, boxStart, boxCurrent, hasValidBox, params]);

  useEffect(() => {
    renderBoxCanvas();
  }, [renderBoxCanvas, step]);

  const [tool, setTool] = useState<'draw' | 'pan'>('draw');
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [workspace, setWorkspace] = useState({ width: 600, height: 600 });
  useEffect(() => {
    const element = workspaceRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setWorkspace({
        width: element.clientWidth,
        height: element.clientHeight,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const commitArea = (
    qStart: { x: number; y: number },
    qCurrent: { x: number; y: number },
  ) => {
    const x1 = Math.round(Math.min(qStart.x, qCurrent.x));
    const y1 = Math.round(Math.min(qStart.y, qCurrent.y));
    const x2 = Math.round(Math.max(qStart.x, qCurrent.x));
    const y2 = Math.round(Math.max(qStart.y, qCurrent.y));

    if (x2 - x1 > 200 && y2 - y1 > 200) {
      setHasValidBox(false);
      onParamsChange({
        ...params,
        x1,
        y1,
        x2,
        y2,
      });
      setZoomLevel(1.5);
    }
  };
  const commitBox = async (
    boxStart: { x: number; y: number },
    boxCurrent: { x: number; y: number },
  ) => {
    if (!canonicalTemplateDataUrl || isSnapping) return;
    setHasValidBox(false);
    setSnapStatus(null);
    const localX1 = Math.round(Math.min(boxStart.x, boxCurrent.x));
    const localY1 = Math.round(Math.min(boxStart.y, boxCurrent.y));
    const localX2 = Math.round(Math.max(boxStart.x, boxCurrent.x));
    const localY2 = Math.round(Math.max(boxStart.y, boxCurrent.y));
    const bw = localX2 - localX1;
    const bh = localY2 - localY1;

    if (bw > 10 && bh > 10) {
      setIsSnapping(true);
      setSnapStatus('Checking the empty box…');

      try {
        const cv = await getCV();
        const tMat = await renderScanMat(cv, canonicalTemplateDataUrl);

        // Convert local coordinates in question area to page coordinates
        const pageBoxX1 = params.x1 + localX1;
        const pageBoxY1 = params.y1 + localY1;
        const pageBoxX2 = params.x1 + localX2;
        const pageBoxY2 = params.y1 + localY2;

        let boxResult: ReturnType<typeof set_box>;
        try {
          boxResult = measureSelectedBox(
            cv,
            tMat,
            pageBoxX1,
            pageBoxY1,
            pageBoxX2,
            pageBoxY2,
          );
        } finally {
          tMat.delete();
        }

        // Use exact detected outer contour bounding position if available, fallback to user drag
        const detectedBoxX1 =
          typeof boxResult.x === 'number' ? boxResult.x : pageBoxX1;
        const detectedBoxY1 =
          typeof boxResult.y === 'number' ? boxResult.y : pageBoxY1;

        onParamsChange({
          ...params,
          box_x1: detectedBoxX1,
          box_y1: detectedBoxY1,
          box_x2: detectedBoxX1 + boxResult.w,
          box_y2: detectedBoxY1 + boxResult.h,
          w: boxResult.w,
          h: boxResult.h,
          outer: boxResult.outer,
          inner: boxResult.inner,
          fill_limit: boxResult.fill_limit,
          text_shift: boxResult.text_shift,
          font_size: boxResult.font_size,
        });

        setHasValidBox(true);
        setSnapStatus('Empty box ready');
      } catch (err: any) {
        console.error('Error during set_box:', err);
        setSnapStatus(
          err instanceof Error
            ? err.message
            : 'Could not extract the box contour. Please select another empty box.',
        );
      } finally {
        setIsSnapping(false);
      }
    }
  };
  const mainPointer = useCanvasPointer({
    mode: tool,
    disabled: isInitializingTemplate || !!templateError,
    viewport: workspaceRef,
    onPreview: (start, end, drawing) => {
      setQStart(start);
      setQCurrent(end);
      setIsDrawingQ(drawing);
    },
    onCommit: commitArea,
  });
  const boxPointer = useCanvasPointer({
    mode: tool,
    disabled: isSnapping,
    viewport: workspaceRef,
    onPreview: (start, end, drawing) => {
      setBoxStart(start);
      setBoxCurrent(end);
      setIsDrawingBox(drawing);
    },
    onCommit: (start, end) => {
      void commitBox(start, end);
    },
  });
  const nativeWidth =
    step === 'qArea' ? TEMPLATE_WIDTH : qAreaImage?.width || 1;
  const nativeHeight =
    step === 'qArea' ? TEMPLATE_HEIGHT : qAreaImage?.height || 1;
  const fit = Math.min(
    1,
    Math.max(1, workspace.width - 32) / nativeWidth,
    Math.max(1, workspace.height - 32) / nativeHeight,
  );
  const zoom = step === 'qArea' ? qZoom : zoomLevel;
  const setZoom = step === 'qArea' ? setQZoom : setZoomLevel;
  const changeStep = (next: 'qArea' | 'sampleBox') => {
    setTool('draw');
    setStep(next);
    if (next === 'sampleBox') {
      const scale = Math.min(
        1,
        (workspace.width - 32) / Math.max(1, params.x2 - params.x1),
        (workspace.height - 32) / Math.max(1, params.y2 - params.y1),
      );
      setZoomLevel(Math.min(32, Math.max(1, 1 / scale)));
    }
    if (workspaceRef.current) {
      workspaceRef.current.scrollLeft = 0;
      workspaceRef.current.scrollTop = 0;
    }
  };

  return (
    <div className="h-[calc(100dvh-4rem)] min-h-80 flex flex-col bg-[#18090b] text-[#f3e7e9]">
      <div className="shrink-0 border-b border-[#571622] bg-[#240c10] px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onBack}
          className="min-h-11 px-2 rounded-lg hover:bg-[#571622]"
        >
          ← Back to setup
        </button>
        <h2 className="font-bold text-base">
          {step === 'qArea' ? 'Select question area' : 'Select one empty box'}
        </h2>
        <nav
          aria-label="Calibration steps"
          className="flex gap-2 w-full sm:w-auto"
        >
          <button
            aria-current={step === 'qArea' ? 'step' : undefined}
            onClick={() => changeStep('qArea')}
            className={`min-h-11 flex-1 px-3 rounded-lg text-sm ${step === 'qArea' ? 'bg-[#8c1529]' : 'bg-[#18090b]'}`}
          >
            1. Question area
          </button>
          <button
            aria-current={step === 'sampleBox' ? 'step' : undefined}
            disabled={
              isInitializingTemplate ||
              !!templateError ||
              params.x2 <= params.x1
            }
            onClick={() => changeStep('sampleBox')}
            className={`min-h-11 flex-1 px-3 rounded-lg text-sm disabled:opacity-40 ${step === 'sampleBox' ? 'bg-[#8c1529]' : 'bg-[#18090b]'}`}
          >
            2. Empty box
          </button>
        </nav>
      </div>
      <div className="shrink-0 px-4 py-2 bg-[#240c10] border-b border-[#571622] space-y-2">
        <p id="canvas-help" className="text-sm text-[#d8c7ca]">
          {step === 'qArea'
            ? 'Draw a rectangle around the complete answer grid, then choose Next.'
            : 'Draw around one empty box. A little surrounding space is fine; the outline snaps to the box.'}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Canvas tool"
          >
            <button
              aria-pressed={tool === 'draw'}
              onClick={() => setTool('draw')}
              className={`min-h-11 px-3 rounded-lg ${tool === 'draw' ? 'bg-[#8c1529]' : 'bg-[#18090b]'}`}
            >
              Draw
            </button>
            <button
              aria-pressed={tool === 'pan'}
              onClick={() => setTool('pan')}
              className={`min-h-11 px-3 rounded-lg ${tool === 'pan' ? 'bg-[#8c1529]' : 'bg-[#18090b]'}`}
            >
              Pan
            </button>
          </div>
          <div
            className="flex items-center gap-1"
            role="group"
            aria-label="Zoom"
          >
            <button
              title="Zoom Out"
              aria-label="Zoom out"
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
              className="min-h-11 min-w-11 rounded-lg bg-[#18090b]"
            >
              −
            </button>
            <span className="min-w-12 text-sm text-center">
              {Math.round(fit * zoom * 100)}%
            </span>
            <button
              title="Zoom In"
              aria-label="Zoom in"
              onClick={() => setZoom((z) => Math.min(32, z + 0.5))}
              className="min-h-11 min-w-11 rounded-lg bg-[#18090b]"
            >
              +
            </button>
            <button
              onClick={() => setZoom(1)}
              className="min-h-11 px-3 rounded-lg bg-[#18090b]"
            >
              Fit
            </button>
            {step === 'sampleBox' && (
              <button
                onClick={() => changeStep('sampleBox')}
                className="min-h-11 px-3 rounded-lg bg-[#18090b]"
              >
                Box view
              </button>
            )}
          </div>
        </div>
      </div>
      <div
        ref={workspaceRef}
        className="flex-1 min-h-0 overflow-auto overscroll-contain relative"
        aria-busy={isInitializingTemplate || isSnapping}
      >
        {isInitializingTemplate ||
        (step === 'sampleBox' && !qAreaImage && !templateError) ? (
          <div role="status" className="p-8 text-center">
            <span
              className="inline-block w-8 h-8 border-4 border-[#571622] border-t-[#f3b0ba] rounded-full animate-spin mb-3"
              aria-hidden="true"
            />
            <p>
              {step === 'sampleBox' && !isInitializingTemplate
                ? 'Preparing the empty-box view…'
                : preparation}
            </p>
          </div>
        ) : templateError ? (
          <div role="alert" className="p-8 text-rose-300">
            Could not prepare this page: {templateError} Go back and check the
            scan orientation and resolution.
          </div>
        ) : (
          <div className="min-h-full min-w-full w-max p-4 flex">
            {step === 'qArea' && params.x2 <= params.x1 && !isDrawingQ && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                <div className="bg-[#240c10]/95 border border-[#8c1529] rounded-xl p-4 text-center shadow-xl">
                  <svg
                    viewBox="0 0 100 60"
                    className="w-28 h-16 mx-auto"
                    aria-hidden="true"
                  >
                    <rect
                      x="8"
                      y="8"
                      width="84"
                      height="44"
                      rx="4"
                      fill="none"
                      stroke="#f3b0ba"
                      strokeWidth="3"
                      strokeDasharray="12 5"
                      className="selection-demo"
                    />
                    <circle cx="92" cy="52" r="5" fill="#f3b0ba" />
                  </svg>
                  <p className="text-sm">Drag to frame the answer grid</p>
                </div>
              </div>
            )}
            <div
              className="shrink-0 m-auto shadow-xl"
              style={{
                width: Math.max(1, Math.round(nativeWidth * fit * zoom)),
                height: Math.max(1, Math.round(nativeHeight * fit * zoom)),
              }}
            >
              {step === 'qArea' ? (
                <canvas
                  ref={mainCanvasRef}
                  width={TEMPLATE_WIDTH}
                  height={TEMPLATE_HEIGHT}
                  {...mainPointer}
                  aria-label="Question area selection"
                  aria-describedby="canvas-help"
                  className="block bg-white w-full h-full"
                  style={{
                    touchAction: 'none',
                    cursor: tool === 'pan' ? 'grab' : 'crosshair',
                  }}
                />
              ) : (
                <canvas
                  ref={boxCanvasRef}
                  {...boxPointer}
                  aria-label="Empty box selection"
                  aria-describedby="canvas-help"
                  className="block bg-white w-full h-full"
                  style={{
                    touchAction: 'none',
                    cursor: tool === 'pan' ? 'grab' : 'crosshair',
                  }}
                />
              )}
            </div>
          </div>
        )}
      </div>
      <div className="shrink-0 border-t border-[#571622] bg-[#240c10] px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-wrap items-center justify-between gap-2">
        <div role="status" className="text-sm min-w-0">
          {step === 'qArea' ? (
            <>
              <p>
                {params.x2 > params.x1
                  ? 'Question area selected. Review it, then continue.'
                  : 'Use Draw to select the answer grid. Use Pan to move a zoomed page.'}
              </p>
              {params.x2 > params.x1 && (
                <button
                  onClick={() => {
                    setHasValidBox(false);
                    onParamsChange({ ...params, x1: 0, y1: 0, x2: 0, y2: 0 });
                  }}
                  className="min-h-11 text-rose-300"
                >
                  Clear selection
                </button>
              )}
            </>
          ) : (
            <p className={hasValidBox ? 'text-emerald-300' : ''}>
              {isSnapping
                ? 'Checking the empty box…'
                : snapStatus || 'Select an empty box to enable marking.'}
            </p>
          )}
        </div>
        {step === 'qArea' ? (
          <button
            onClick={() => changeStep('sampleBox')}
            disabled={
              isInitializingTemplate ||
              !!templateError ||
              !canonicalTemplateDataUrl ||
              params.x2 <= params.x1
            }
            className="min-h-12 w-full sm:w-auto px-5 bg-[#8c1529] rounded-xl font-semibold disabled:opacity-40"
          >
            Next: Select Box
          </button>
        ) : (
          <button
            onClick={onProceedToMark}
            disabled={
              isInitializingTemplate ||
              !!templateError ||
              !canonicalTemplateDataUrl ||
              !hasValidBox ||
              isSnapping
            }
            className="min-h-12 w-full sm:w-auto px-5 bg-emerald-700 rounded-xl font-semibold disabled:opacity-40"
          >
            Mark Exams
          </button>
        )}
      </div>
    </div>
  );
};
