import {
  prepareCalibration,
  measureCalibration,
} from '../utils/calibrationClient';
import {
  alignQuestionArea,
  cropCalibrationView,
  CALIBRATION_PREVIEW_EDGE,
  CALIBRATION_PREVIEW_WIDTH,
} from '../utils/calibrationPreview';
import { useCanvasPointer } from '../utils/useCanvasPointer';
import React, {
  useRef,
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
} from 'react';
import { CalibrationParams, ExamFile } from '../types';
import { getExamPage } from '../utils/pdfProcessor';
import { imageUrl, releaseImage } from '../utils/imageStore';
import { loadImageElement } from '../utils/omrEngine';
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
  const latestParams = useRef(params);
  const latestChange = useRef(onParamsChange);
  latestParams.current = params;
  latestChange.current = onParamsChange;
  const qGesture = useRef(false);
  const boxGesture = useRef(false);
  const previewImage = useRef<{ url: string; image: HTMLImageElement } | null>(
    null,
  );
  const [sampleSelection, setSampleSelection] = useState<{
    area: { x1: number; y1: number; x2: number; y2: number };
    frame: 'preview' | 'aligned';
  } | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<{
    image: string;
    preview: string;
    rect: [number, number, number, number];
    angle: number;
    thumbnailImage: HTMLImageElement;
  } | null>(null);

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

  // Show the small raster before starting native rasterization/alignment.
  useEffect(() => {
    const controller = new AbortController();
    let releasePreview: (() => void) | undefined;
    const owned: string[] = [];
    setIsInitializingTemplate(true);
    setTemplateError(null);
    setPreviewUrl(null);
    setPrepared(null);
    setCanonicalTemplateDataUrl(null);
    setHasValidBox(false);
    setSampleSelection(null);
    setIsSnapping(false);
    previewImage.current = null;
    const prepare = async () => {
      try {
        setPreparation('Loading a quick page preview…');
        try {
          const preview = await getExamPage(
            firstFile,
            CALIBRATION_PREVIEW_EDGE,
            controller.signal,
          );
          if (controller.signal.aborted) {
            preview.release();
            return;
          }
          releasePreview = preview.release;
          const image = await loadImageElement(preview.url);
          controller.signal.throwIfAborted();
          previewImage.current = { url: preview.url, image };
          setPreviewUrl(preview.url);
          // Give React and the browser a paint before starting the larger work.
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        } catch (error) {
          if (controller.signal.aborted) return;
        }
        controller.signal.throwIfAborted();
        setPreparation('Preparing the 600-DPI detail view in the background…');
        const raster = await getExamPage(
          firstFile,
          undefined,
          controller.signal,
        );
        let result;
        try {
          const response = await fetch(raster.url, {
            signal: controller.signal,
          });
          if (!response.ok) throw new Error('Could not read calibration page.');
          result = await prepareCalibration(
            await response.blob(),
            controller.signal,
            setPreparation,
          );
        } finally {
          raster.release();
        }
        controller.signal.throwIfAborted();
        const image = imageUrl(result.image),
          preview = imageUrl(result.thumbnail);
        owned.push(image, preview);
        const thumbnailImage = await loadImageElement(preview);
        controller.signal.throwIfAborted();
        setPrepared({
          image,
          preview,
          rect: result.rect,
          angle: result.angle,
          thumbnailImage,
        });
      } catch (error) {
        if (!controller.signal.aborted) {
          setTemplateError(
            error instanceof Error
              ? error.message
              : 'Could not prepare the calibration page.',
          );
          setIsInitializingTemplate(false);
          setIsSnapping(false);
          setSnapStatus(
            'Could not prepare full-resolution detail. Go back and try again.',
          );
        }
      }
    };
    void prepare();
    return () => {
      controller.abort();
      releasePreview?.();
      owned.forEach(releaseImage);
    };
  }, [firstFile.id, firstFile.rotation, firstFile.dataUrl]);

  // A preview selection is in the unaligned template frame. Upgrade it using
  // the authoritative full-resolution transform, never a low-res contour fit.
  // Keep the frame stable until any active pointer gesture has ended.
  useEffect(() => {
    if (!prepared || qGesture.current || boxGesture.current) return;
    const current = latestParams.current;
    const area =
      current.questionAreaFrame === 'preview'
        ? alignQuestionArea(current, prepared.angle)
        : current;
    latestChange.current({
      ...current,
      ...area,
      questionAreaFrame: 'aligned',
      rect: prepared.rect,
      templateDataUrl: prepared.image,
    });
    if (sampleSelection?.frame === 'preview')
      setSampleSelection({
        area: alignQuestionArea(sampleSelection.area, prepared.angle),
        frame: 'aligned',
      });
    previewImage.current = {
      url: prepared.preview,
      image: prepared.thumbnailImage,
    };
    if (step === 'sampleBox')
      setQAreaImage(cropCalibrationView(prepared.thumbnailImage, area, false));
    setPreviewUrl(prepared.preview);
    setCanonicalTemplateDataUrl(prepared.image);
    setIsInitializingTemplate(false);
    setPrepared(null);
  }, [prepared, isDrawingQ, isDrawingBox]);

  // Draw Main Canvas (Step 1: Select Question Area on canonical template)
  const renderMainCanvas = useCallback(() => {
    const canvas = mainCanvasRef.current;
    if (!canvas || !previewUrl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = CALIBRATION_PREVIEW_WIDTH;
      canvas.height = CALIBRATION_PREVIEW_EDGE;
      ctx.scale(canvas.width / TEMPLATE_WIDTH, canvas.height / TEMPLATE_HEIGHT);
      ctx.drawImage(img, 0, 0, TEMPLATE_WIDTH, TEMPLATE_HEIGHT);

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
        ctx.fillRect(0, 0, TEMPLATE_WIDTH, y1);
        ctx.fillRect(0, y2, TEMPLATE_WIDTH, TEMPLATE_HEIGHT - y2);
        ctx.fillRect(0, y1, x1, y2 - y1);
        ctx.fillRect(x2, y1, TEMPLATE_WIDTH - x2, y2 - y1);

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
    img.src = previewUrl;
    return () => {
      img.onload = null;
    };
  }, [
    previewUrl,
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

  // Keep the preview visible while a sharper crop is decoded. Both displays
  // use the same logical selection coordinates, regardless of raster size.
  useEffect(() => {
    if (
      step !== 'sampleBox' ||
      params.x2 <= params.x1 ||
      params.y2 <= params.y1
    )
      return;
    const url = canonicalTemplateDataUrl || previewUrl;
    if (!url) return;
    let cancelled = false;
    const area = { x1: params.x1, y1: params.y1, x2: params.x2, y2: params.y2 };
    const paint = (image: HTMLImageElement) => {
      if (!cancelled)
        setQAreaImage(
          cropCalibrationView(image, area, !!canonicalTemplateDataUrl),
        );
    };
    if (!canonicalTemplateDataUrl && previewImage.current?.url === url)
      paint(previewImage.current.image);
    else
      void loadImageElement(url)
        .then(paint)
        .catch(() => {
          if (!cancelled)
            setSnapStatus(
              'Could not load the detailed view. Go back and try again.',
            );
        });
    return () => {
      cancelled = true;
    };
  }, [
    step,
    canonicalTemplateDataUrl,
    previewUrl,
    params.x1,
    params.y1,
    params.x2,
    params.y2,
  ]);

  useEffect(
    () => () => {
      if (qAreaImage) qAreaImage.width = qAreaImage.height = 0;
    },
    [qAreaImage],
  );

  // Draw Sample Box Canvas (Step 2: Select One Empty Box)
  const renderBoxCanvas = useCallback(() => {
    const canvas = boxCanvasRef.current;
    if (!canvas || !qAreaImage) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = qAreaImage.width;
    canvas.height = qAreaImage.height;

    // Image pixels and logical selection coordinates are independent.
    ctx.drawImage(qAreaImage, 0, 0);
    ctx.scale(
      canvas.width / (params.x2 - params.x1),
      canvas.height / (params.y2 - params.y1),
    );

    // Current drag or snapped box
    let bx1 = 0;
    let by1 = 0;
    let bx2 = 0;
    let by2 = 0;

    if (
      (isDrawingBox && boxStart && boxCurrent) ||
      (sampleSelection && !hasValidBox)
    ) {
      const start =
        isDrawingBox && boxStart
          ? boxStart
          : {
              x: sampleSelection!.area.x1 - params.x1,
              y: sampleSelection!.area.y1 - params.y1,
            };
      const end =
        isDrawingBox && boxCurrent
          ? boxCurrent
          : {
              x: sampleSelection!.area.x2 - params.x1,
              y: sampleSelection!.area.y2 - params.y1,
            };
      bx1 = Math.min(start.x, end.x);
      by1 = Math.min(start.y, end.y);
      bx2 = Math.max(start.x, end.x);
      by2 = Math.max(start.y, end.y);

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
  }, [
    qAreaImage,
    isDrawingBox,
    boxStart,
    boxCurrent,
    hasValidBox,
    sampleSelection,
    params,
  ]);

  useLayoutEffect(() => {
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
        columnLayout: undefined,
        questionAreaFrame: canonicalTemplateDataUrl ? 'aligned' : 'preview',
      });
      setZoomLevel(1.5);
    }
  };
  const commitBox = (
    start: { x: number; y: number },
    end: { x: number; y: number },
  ) => {
    if (isSnapping) return;
    const area = {
      x1: Math.round(params.x1 + Math.min(start.x, end.x)),
      y1: Math.round(params.y1 + Math.min(start.y, end.y)),
      x2: Math.round(params.x1 + Math.max(start.x, end.x)),
      y2: Math.round(params.y1 + Math.max(start.y, end.y)),
    };
    if (area.x2 - area.x1 <= 10 || area.y2 - area.y1 <= 10) return;
    setHasValidBox(false);
    setSampleSelection({
      area,
      frame: canonicalTemplateDataUrl ? 'aligned' : 'preview',
    });
    setIsSnapping(true);
    setSnapStatus(
      canonicalTemplateDataUrl
        ? 'Checking the empty box…'
        : 'Selection saved. Waiting for full-resolution detail…',
    );
  };

  useEffect(() => {
    if (
      !isSnapping ||
      !sampleSelection ||
      sampleSelection.frame !== 'aligned' ||
      !canonicalTemplateDataUrl ||
      step !== 'sampleBox'
    )
      return;
    const controller = new AbortController();
    const selection = sampleSelection.area,
      current = latestParams.current;
    setSnapStatus('Checking the empty box…');
    const measure = async () => {
      try {
        const response = await fetch(canonicalTemplateDataUrl, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Could not read the detailed page.');
        const { box, columnLayout } = await measureCalibration(
          await response.blob(),
          current,
          selection,
          controller.signal,
        );
        controller.signal.throwIfAborted();
        const x = typeof box.x === 'number' ? box.x : selection.x1;
        const y = typeof box.y === 'number' ? box.y : selection.y1;
        latestChange.current({
          ...latestParams.current,
          columnLayout,
          box_x1: x,
          box_y1: y,
          box_x2: x + box.w,
          box_y2: y + box.h,
          w: box.w,
          h: box.h,
          outer: box.outer,
          inner: box.inner,
          fill_limit: box.fill_limit,
          text_shift: box.text_shift,
          font_size: box.font_size,
        });
        setHasValidBox(true);
        setSnapStatus('Empty box ready');
      } catch (error) {
        if (!controller.signal.aborted)
          setSnapStatus(
            error instanceof Error
              ? error.message
              : 'Could not measure the empty box. Try another box.',
          );
      } finally {
        if (!controller.signal.aborted) setIsSnapping(false);
      }
    };
    void measure();
    return () => controller.abort();
  }, [isSnapping, sampleSelection, canonicalTemplateDataUrl, step]);

  const mainPointer = useCanvasPointer({
    mode: tool,
    disabled: !previewUrl || !!templateError,
    coordinateSize: { width: TEMPLATE_WIDTH, height: TEMPLATE_HEIGHT },
    viewport: workspaceRef,
    onPreview: (start, end, drawing) => {
      qGesture.current = drawing;
      setQStart(start);
      setQCurrent(end);
      setIsDrawingQ(drawing);
    },
    onCommit: commitArea,
  });
  const boxPointer = useCanvasPointer({
    mode: tool,
    disabled: isSnapping,
    coordinateSize: {
      width: params.x2 - params.x1,
      height: params.y2 - params.y1,
    },
    viewport: workspaceRef,
    onPreview: (start, end, drawing) => {
      boxGesture.current = drawing;
      setBoxStart(start);
      setBoxCurrent(end);
      setIsDrawingBox(drawing);
    },
    onCommit: (start, end) => {
      void commitBox(start, end);
    },
  });
  const nativeWidth =
    step === 'qArea' ? TEMPLATE_WIDTH : Math.max(1, params.x2 - params.x1);
  const nativeHeight =
    step === 'qArea' ? TEMPLATE_HEIGHT : Math.max(1, params.y2 - params.y1);
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
    if (next === 'qArea') {
      setQAreaImage(null);
      setSampleSelection(null);
      setIsSnapping(false);
    }
    if (next === 'sampleBox') {
      if (previewImage.current)
        setQAreaImage(
          cropCalibrationView(previewImage.current.image, params, false),
        );
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
    <div className="h-[calc(100dvh-4rem)] min-h-80 flex flex-col lg:flex-row lg:gap-4 lg:p-4 bg-[#18090b] text-[#f3e7e9]">
      <div
        ref={workspaceRef}
        role="region"
        aria-label="Scan workspace"
        className="order-3 lg:order-1 flex-1 min-h-0 min-w-0 overflow-auto overscroll-contain relative lg:rounded-2xl lg:border lg:border-[#571622]"
        aria-busy={isSnapping}
      >
        {(!previewUrl && !templateError) ||
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
            {step === 'qArea' &&
              params.x2 <= params.x1 &&
              !isDrawingQ &&
              tool === 'draw' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10 lg:hidden">
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
              className="relative shrink-0 m-auto shadow-xl"
              style={{
                width: Math.max(1, Math.round(nativeWidth * fit * zoom)),
                height: Math.max(1, Math.round(nativeHeight * fit * zoom)),
              }}
            >
              {step === 'qArea' ? (
                <canvas
                  ref={mainCanvasRef}
                  width={CALIBRATION_PREVIEW_WIDTH}
                  height={CALIBRATION_PREVIEW_EDGE}
                  data-frame={canonicalTemplateDataUrl ? 'aligned' : 'preview'}
                  data-coordinate-width={TEMPLATE_WIDTH}
                  data-coordinate-height={TEMPLATE_HEIGHT}
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
                  data-coordinate-width={Math.max(1, params.x2 - params.x1)}
                  data-coordinate-height={Math.max(1, params.y2 - params.y1)}
                  data-detail={
                    qAreaImage && qAreaImage.width >= params.x2 - params.x1
                      ? 'full'
                      : 'preview'
                  }
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
              {step === 'sampleBox' && isSnapping && sampleSelection && (
                <div
                  role="status"
                  aria-label="Calibrating selected box"
                  className="absolute pointer-events-none flex items-center justify-center border-2 border-rose-400 bg-rose-950/10"
                  style={{
                    left: `${((sampleSelection.area.x1 - params.x1) / nativeWidth) * 100}%`,
                    top: `${((sampleSelection.area.y1 - params.y1) / nativeHeight) * 100}%`,
                    width: `${((sampleSelection.area.x2 - sampleSelection.area.x1) / nativeWidth) * 100}%`,
                    height: `${((sampleSelection.area.y2 - sampleSelection.area.y1) / nativeHeight) * 100}%`,
                  }}
                >
                  <span
                    className="w-6 h-6 max-w-full max-h-full rounded-full border-[3px] border-rose-200/50 border-t-rose-600 animate-spin"
                    aria-hidden="true"
                  />
                  <span className="sr-only">
                    {snapStatus || 'Checking the empty box…'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <aside
        aria-label="Calibration controls"
        className="contents lg:flex lg:order-2 lg:w-[22rem] xl:w-[24rem] lg:shrink-0 lg:min-h-0 lg:flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-[#571622] lg:bg-[#240c10]"
      >
        <div className="contents lg:block lg:flex-1 lg:min-h-0 lg:overflow-y-auto">
          <div className="order-1 shrink-0 border-b border-[#571622] bg-[#240c10] px-4 py-2 flex flex-wrap items-center justify-between gap-2 lg:flex-col lg:items-stretch lg:p-4 lg:gap-2">
            <button
              onClick={onBack}
              className="min-h-11 px-2 rounded-lg hover:bg-[#571622]"
            >
              ← Back to setup
            </button>
            <h2 className="font-bold text-base lg:text-xl">
              {step === 'qArea'
                ? 'Select question area'
                : 'Select one empty box'}
            </h2>
            <p
              className="hidden lg:block text-sm text-[#b1a1a4] truncate"
              title={firstFile.name}
            >
              {firstFile.name}
            </p>
            <nav
              aria-label="Calibration steps"
              className="flex gap-2 w-full sm:w-auto lg:w-full"
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
                  !previewUrl || !!templateError || params.x2 <= params.x1
                }
                onClick={() => changeStep('sampleBox')}
                className={`min-h-11 flex-1 px-3 rounded-lg text-sm disabled:opacity-40 ${step === 'sampleBox' ? 'bg-[#8c1529]' : 'bg-[#18090b]'}`}
              >
                2. Empty box
              </button>
            </nav>
          </div>
          <div className="order-2 shrink-0 px-4 py-2 bg-[#240c10] border-b border-[#571622] space-y-2 lg:p-4 lg:space-y-3 lg:border-b-0">
            <p
              id="canvas-help"
              className={`text-sm text-[#d8c7ca] relative ${step === 'qArea' && params.x2 <= params.x1 && tool === 'draw' ? 'lg:pl-16' : ''}`}
            >
              {step === 'qArea' &&
                params.x2 <= params.x1 &&
                tool === 'draw' && (
                  <svg
                    viewBox="0 0 100 60"
                    className="hidden lg:block absolute left-0 top-1 w-12 h-9"
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
                )}
              {step === 'qArea'
                ? 'Draw a rectangle around the complete answer grid, then choose Next.'
                : 'Draw around one empty box. A little surrounding space is fine; the outline snaps to the box.'}
            </p>
            {isInitializingTemplate && previewUrl && !templateError && (
              <p
                id="calibration-preparation"
                role="status"
                className="text-sm text-[#b1a1a4]"
              >
                <span
                  className="inline-block w-3 h-3 mr-2 border-2 border-[#571622] border-t-[#f3b0ba] rounded-full animate-spin"
                  aria-hidden="true"
                />
                {preparation}{' '}
                {isSnapping
                  ? 'Your selection is saved.'
                  : step === 'qArea'
                    ? 'You can select the grid now.'
                    : 'You can select an empty box now.'}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 lg:flex-col lg:items-stretch lg:gap-2">
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
        </div>
        <div className="order-4 shrink-0 border-t border-[#571622] bg-[#240c10] px-4 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] flex flex-wrap items-center justify-between gap-2 lg:block lg:space-y-3 lg:p-4">
          <div
            role="status"
            className="text-sm min-w-0 lg:flex lg:items-center lg:gap-3"
          >
            {step === 'qArea' ? (
              <>
                <p>
                  {params.x2 > params.x1
                    ? 'Area selected. Review, then continue.'
                    : 'Draw around the grid. Use Pan to move a zoomed page.'}
                </p>
                {params.x2 > params.x1 && (
                  <button
                    onClick={() => {
                      setHasValidBox(false);
                      onParamsChange({ ...params, x1: 0, y1: 0, x2: 0, y2: 0 });
                    }}
                    className="min-h-11 text-rose-300 lg:shrink-0"
                  >
                    Clear selection
                  </button>
                )}
              </>
            ) : (
              <p className={hasValidBox ? 'text-emerald-300' : ''}>
                {isSnapping
                  ? snapStatus || 'Checking the empty box…'
                  : snapStatus || 'Select an empty box to enable marking.'}
              </p>
            )}
          </div>
          {step === 'qArea' ? (
            <button
              onClick={() => changeStep('sampleBox')}
              disabled={
                !previewUrl || !!templateError || params.x2 <= params.x1
              }
              className="min-h-12 w-full sm:w-auto lg:w-full px-5 bg-[#8c1529] rounded-xl font-semibold disabled:opacity-40"
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
                isDrawingBox ||
                isSnapping
              }
              className="min-h-12 w-full sm:w-auto lg:w-full px-5 bg-emerald-700 rounded-xl font-semibold disabled:opacity-40"
            >
              Mark Exams
            </button>
          )}
        </div>
      </aside>
    </div>
  );
};
