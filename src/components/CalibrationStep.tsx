import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  ArrowLeft,
  Crop,
  Square,
  CheckCircle2,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from 'lucide-react';
import { CalibrationParams, ExamFile } from '../types';
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
  onUpdateFile: (file: ExamFile) => void;
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
  const boxScrollContainerRef = useRef<HTMLDivElement>(null);

  // Calibration stages:
  // Stage 1: "Select the question area"
  // Stage 2: "Now select one empty box"
  const [step, setStep] = useState<'qArea' | 'sampleBox'>('qArea');
  const [isInitializingTemplate, setIsInitializingTemplate] = useState<boolean>(true);
  const [canonicalTemplateDataUrl, setCanonicalTemplateDataUrl] = useState<string | null>(null);

  // Zoom controls for Step 1 (Question Area)
  const [qZoom, setQZoom] = useState<number>(1.0);

  // Zoom controls for Step 2
  const [zoomLevel, setZoomLevel] = useState<number>(1.5);
  const [isSnapping, setIsSnapping] = useState<boolean>(false);
  const [snapStatus, setSnapStatus] = useState<string | null>(null);

  // Drawing state for Question Area (on canonical main canvas)
  const [isDrawingQ, setIsDrawingQ] = useState(false);
  const [qStart, setQStart] = useState<{ x: number; y: number } | null>(null);
  const [qCurrent, setQCurrent] = useState<{ x: number; y: number } | null>(null);

  // Drawing state for Sample Box (on cropped Q-Area canvas)
  const [isDrawingBox, setIsDrawingBox] = useState(false);
  const [boxStart, setBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [boxCurrent, setBoxCurrent] = useState<{ x: number; y: number } | null>(null);

  const [hasValidBox, setHasValidBox] = useState(params.w > 0 && params.h > 0);
  const [qAreaImage, setQAreaImage] = useState<HTMLCanvasElement | null>(null);
  const [boxPreviewDataUrl, setBoxPreviewDataUrl] = useState<string | null>(null);

  const [templateError, setTemplateError] = useState<string | null>(null);

  // Initialize canonical template & calculate calibration sheet's largest contour rect (Python lines 384-387)
  useEffect(() => {
    let isCancelled = false;
    async function initTemplate() {
      setIsInitializingTemplate(true);
      setTemplateError(null);
      setCanonicalTemplateDataUrl(null);
      setHasValidBox(false);
      try {
        const cv = await getCV();
        let rotatedMat: any = null;
        const rawMat = await renderToCanonicalMat(cv, firstFile.dataUrl);
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

        const dataUrl = canvas.toDataURL('image/png');
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
          setTemplateError(e?.message || 'Could not align the calibration page.');
        }
      } finally {
        setIsInitializingTemplate(false);
      }
    }

    initTemplate();
    return () => {
      isCancelled = true;
    };
  }, [firstFile.dataUrl]);

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
  }, [canonicalTemplateDataUrl, params.x1, params.y1, params.x2, params.y2, isDrawingQ, qStart, qCurrent]);

  useEffect(() => {
    renderMainCanvas();
  }, [renderMainCanvas]);

  // Update Cropped Question Area Canvas for Step 2
  const updateQAreaCanvas = useCallback(() => {
    const { x1, y1, x2, y2 } = params;
    const qw = Math.abs(x2 - x1);
    const qh = Math.abs(y2 - y1);
    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);

    if (qw <= 20 || qh <= 20 || !canonicalTemplateDataUrl) return;

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
    img.src = canonicalTemplateDataUrl;
  }, [canonicalTemplateDataUrl, params.x1, params.y1, params.x2, params.y2]);

  useEffect(() => {
    updateQAreaCanvas();
  }, [updateQAreaCanvas, step]);

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

      // Inner boundary rectangle (thickness ~ w/6)
      const borderWidth = Math.max(2, Math.floor(localW / 8));
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(
        localX + borderWidth,
        localY + borderWidth,
        Math.max(4, localW - borderWidth * 2),
        Math.max(4, localH - borderWidth * 2)
      );
      ctx.setLineDash([]);

      // Center crosshair exactly at box center
      const cx = localX + localW / 2;
      const cy = localY + localH / 2;
      ctx.fillStyle = '#10b981';
      ctx.fillRect(cx - 2, cy - localH / 2 - 8, 4, localH + 16);
      ctx.fillRect(cx - localW / 2 - 8, cy - 2, localW + 16, 4);
    }
  }, [qAreaImage, isDrawingBox, boxStart, boxCurrent, hasValidBox, params]);

  useEffect(() => {
    renderBoxCanvas();
  }, [renderBoxCanvas]);

  useEffect(() => {
    if (step === 'sampleBox') {
      updateQAreaCanvas();
      const timer = setTimeout(() => {
        renderBoxCanvas();
      }, 40);
      return () => clearTimeout(timer);
    }
  }, [step, updateQAreaCanvas, renderBoxCanvas]);

  // Main canvas mouse handlers (Question Area drag)
  const handleMainMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setIsDrawingQ(true);
    setQStart({ x, y });
    setQCurrent({ x, y });
  };

  const handleMainMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingQ || !qStart) return;
    const canvas = mainCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY));

    setQCurrent({ x, y });
  };

  const handleMainMouseUp = () => {
    if (!isDrawingQ || !qStart || !qCurrent) return;
    setIsDrawingQ(false);

    const x1 = Math.round(Math.min(qStart.x, qCurrent.x));
    const y1 = Math.round(Math.min(qStart.y, qCurrent.y));
    const x2 = Math.round(Math.max(qStart.x, qCurrent.x));
    const y2 = Math.round(Math.max(qStart.y, qCurrent.y));

    if (x2 - x1 > 200 && y2 - y1 > 200) {
      onParamsChange({
        ...params,
        x1,
        y1,
        x2,
        y2,
      });
      setStep('sampleBox');
      setZoomLevel(1.5);
    }
  };

  // Box canvas mouse handlers (Sample Box drag)
  const handleBoxMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = boxCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    setIsDrawingBox(true);
    setBoxStart({ x, y });
    setBoxCurrent({ x, y });
  };

  const handleBoxMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawingBox || !boxStart) return;
    const canvas = boxCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const x = Math.max(0, Math.min(canvas.width, (e.clientX - rect.left) * scaleX));
    const y = Math.max(0, Math.min(canvas.height, (e.clientY - rect.top) * scaleY));

    setBoxCurrent({ x, y });
  };

  const handleBoxMouseUp = async () => {
    if (!isDrawingBox || !boxStart || !boxCurrent || !canonicalTemplateDataUrl) return;
    setIsDrawingBox(false);

    const localX1 = Math.round(Math.min(boxStart.x, boxCurrent.x));
    const localY1 = Math.round(Math.min(boxStart.y, boxCurrent.y));
    const localX2 = Math.round(Math.max(boxStart.x, boxCurrent.x));
    const localY2 = Math.round(Math.max(boxStart.y, boxCurrent.y));
    const bw = localX2 - localX1;
    const bh = localY2 - localY1;

    if (bw > 10 && bh > 10) {
      setIsSnapping(true);
      setSnapStatus('Extracting box contours using Parameters.set_box...');

      try {
        const cv = await getCV();
        const tMat = await renderScanMat(cv, canonicalTemplateDataUrl);

        // Convert local coordinates in question area to page coordinates
        const pageBoxX1 = params.x1 + localX1;
        const pageBoxY1 = params.y1 + localY1;
        const pageBoxX2 = params.x1 + localX2;
        const pageBoxY2 = params.y1 + localY2;

        const boxResult = set_box(
          cv,
          tMat,
          pageBoxX1,
          pageBoxY1,
          pageBoxX2,
          pageBoxY2
        );
        tMat.delete();

        // Use exact detected outer contour bounding position if available, fallback to user drag
        const detectedBoxX1 = typeof boxResult.x === 'number' ? boxResult.x : pageBoxX1;
        const detectedBoxY1 = typeof boxResult.y === 'number' ? boxResult.y : pageBoxY1;

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

        if (qAreaImage) {
          const prevCanvas = document.createElement('canvas');
          prevCanvas.width = Math.max(10, boxResult.w);
          prevCanvas.height = Math.max(10, boxResult.h);
          const pCtx = prevCanvas.getContext('2d')!;
          const cropX = Math.max(0, detectedBoxX1 - params.x1);
          const cropY = Math.max(0, detectedBoxY1 - params.y1);
          pCtx.drawImage(
            qAreaImage,
            cropX,
            cropY,
            boxResult.w,
            boxResult.h,
            0,
            0,
            boxResult.w,
            boxResult.h
          );
          setBoxPreviewDataUrl(prevCanvas.toDataURL());
        }

        setHasValidBox(true);
        setSnapStatus('Box parameters successfully derived!');
      } catch (err: any) {
        console.error('Error during set_box:', err);
        setSnapStatus('Could not snap box contour. Please drag closely around the box.');
      } finally {
        setIsSnapping(false);
      }
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] bg-slate-900 text-slate-100 overflow-hidden">
      {/* Top Bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-900/90 backdrop-blur z-20">
        <div className="flex items-center space-x-4">
          <button
            onClick={onBack}
            className="flex items-center text-slate-400 hover:text-white transition-colors"
          >
            <ArrowLeft className="w-5 h-5 mr-1" />
            <span>Back</span>
          </button>
          <div className="h-4 w-px bg-slate-700" />
          <h2 className="text-lg font-semibold text-white">
            {step === 'qArea'
              ? 'Select Question Area'
              : 'Select Sample Empty Box'}
          </h2>
        </div>

        {/* Step Indicator */}
        <div className="flex items-center space-x-2 bg-slate-800/80 px-3 py-1.5 rounded-lg border border-slate-700">
          <button
            onClick={() => setStep('qArea')}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
              step === 'qArea'
                ? 'bg-[#8c1529] text-white shadow'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Crop className="w-3.5 h-3.5" />
            <span>1. Question Area</span>
          </button>
          <span className="text-slate-600">/</span>
          <button
            onClick={() => params.x2 > params.x1 && setStep('sampleBox')}
            disabled={isInitializingTemplate || !!templateError || !canonicalTemplateDataUrl || params.x2 <= params.x1}
            className={`flex items-center space-x-1.5 px-3 py-1 rounded text-xs font-medium transition-colors ${
              step === 'sampleBox'
                ? 'bg-[#8c1529] text-white shadow'
                : params.x2 > params.x1
                ? 'text-slate-400 hover:text-white'
                : 'text-slate-600 cursor-not-allowed'
            }`}
          >
            <Square className="w-3.5 h-3.5" />
            <span>2. Sample Box</span>
          </button>
        </div>

        {/* Action Button */}
        <div className="flex items-center space-x-3">
          {step === 'qArea' ? (
            <button
              onClick={() => setStep('sampleBox')}
              disabled={isInitializingTemplate || !!templateError || !canonicalTemplateDataUrl || params.x2 <= params.x1}
              className="px-5 py-2 bg-[#8c1529] hover:bg-[#a31a32] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg shadow-lg shadow-rose-950/30 transition-all flex items-center space-x-2"
            >
              <span>Next: Select Box</span>
            </button>
          ) : (
            <button
              onClick={onProceedToMark}
              disabled={isInitializingTemplate || !!templateError || !canonicalTemplateDataUrl || !hasValidBox}
              className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-lg shadow-emerald-950/30 transition-all flex items-center space-x-2"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Mark Exams</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {isInitializingTemplate && (
          <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm z-30 flex flex-col items-center justify-center space-y-3">
            <RefreshCw className="w-8 h-8 text-rose-500 animate-spin" />
            <p className="text-sm font-medium text-slate-300">
              Deskewing and calibrating canonical coordinate space...
            </p>
          </div>
        )}

        {templateError && (
          <div role="alert" className="absolute inset-0 bg-slate-900 z-30 flex items-center justify-center p-8 text-rose-300">
            Could not calibrate this page: {templateError} Go back to check the scan resolution and orientation.
          </div>
        )}

        {/* Step 1: Select Question Area on canonical page */}
        {step === 'qArea' && (
          <div className="flex-1 flex flex-col bg-slate-950/60 overflow-hidden">
            {/* Step 1 Toolbar */}
            <div className="flex items-center justify-between px-6 py-2 bg-slate-900/60 border-b border-slate-800 text-xs">
              <div className="flex items-center space-x-2 text-slate-300">
                <Crop className="w-4 h-4 text-rose-400" />
                <span>
                  Click and drag to select the complete <strong>question region</strong>. The entire page is visible below.
                </span>
              </div>

              {/* Zoom & Fit controls */}
              <div className="flex items-center space-x-3">
                {params.x2 > params.x1 && (
                  <button
                    onClick={() => {
                      onParamsChange({
                        ...params,
                        x1: 0,
                        y1: 0,
                        x2: 0,
                        y2: 0,
                      });
                    }}
                    className="text-xs text-rose-400 hover:text-rose-300 hover:underline"
                  >
                    Clear Selection
                  </button>
                )}
                <div className="flex items-center space-x-2 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                  <button
                    onClick={() => setQZoom((z) => Math.max(0.6, z - 0.2))}
                    className="p-1 hover:text-white text-slate-400"
                    title="Zoom Out"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-slate-300 font-mono text-[11px] min-w-[50px] text-center">
                    {qZoom === 1.0 ? 'Fit' : `${Math.round(qZoom * 100)}%`}
                  </span>
                  <button
                    onClick={() => setQZoom((z) => Math.min(2.5, z + 0.2))}
                    className="p-1 hover:text-white text-slate-400"
                    title="Zoom In"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setQZoom(1.0)}
                    className="p-1 hover:text-white text-slate-400 border-l border-slate-700 pl-2 text-[11px] font-medium"
                    title="Fit to Screen"
                  >
                    Fit Page
                  </button>
                </div>
              </div>
            </div>

            {/* Scrollable canvas workspace */}
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
              <div
                className="relative border border-slate-700 rounded-lg shadow-2xl bg-slate-900 inline-block transition-transform duration-100"
                style={{
                  transform: qZoom !== 1.0 ? `scale(${qZoom})` : undefined,
                  transformOrigin: 'top center',
                }}
              >
                <canvas
                  ref={mainCanvasRef}
                  width={4800}
                  height={6840}
                  onMouseDown={handleMainMouseDown}
                  onMouseMove={handleMainMouseMove}
                  onMouseUp={handleMainMouseUp}
                  className="cursor-crosshair block bg-white"
                  style={{
                    maxHeight: 'calc(100vh - 200px)',
                    maxWidth: 'calc(100vw - 80px)',
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    aspectRatio: '4800 / 6840',
                  }}
                />
              </div>
            </div>

            {/* Step 1 Bottom Status Bar */}
            <div className="bg-slate-900 border-t border-slate-800 px-6 py-2.5 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center space-x-3">
                {params.x2 > params.x1 ? (
                  <span className="text-emerald-400 font-medium">
                    Question Area Selected: <strong className="font-mono text-white">{params.x2 - params.x1} × {params.y2 - params.y1} px</strong>
                  </span>
                ) : (
                  <span>Drag across the question region above</span>
                )}
              </div>
              <span className="font-mono text-slate-500">
                Calibration Template: 4800 × 6840 px (from a 600 DPI scan)
              </span>
            </div>
          </div>
        )}

        {/* Step 2: Select Sample Empty Box */}
        {step === 'sampleBox' && (
          <div className="flex-1 flex flex-col bg-slate-950/60 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-6 py-2 bg-slate-900/60 border-b border-slate-800 text-xs">
              <div className="flex items-center space-x-2 text-slate-300">
                <Square className="w-4 h-4 text-rose-400" />
                <span>
                  Drag a snug rectangle around <strong>ONE empty answer box</strong> to derive contour dimensions and fill threshold.
                </span>
              </div>

              {/* Zoom controls */}
              <div className="flex items-center space-x-2 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                <button
                  onClick={() => setZoomLevel((z) => Math.max(0.75, z - 0.25))}
                  className="p-1 hover:text-white text-slate-400"
                  title="Zoom Out"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-slate-300 font-mono text-[11px] min-w-[40px] text-center">
                  {Math.round(zoomLevel * 100)}%
                </span>
                <button
                  onClick={() => setZoomLevel((z) => Math.min(3, z + 0.25))}
                  className="p-1 hover:text-white text-slate-400"
                  title="Zoom In"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setZoomLevel(1.5)}
                  className="p-1 hover:text-white text-slate-400 border-l border-slate-700 pl-2"
                  title="Reset Zoom"
                >
                  <Maximize2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Scrollable Box Canvas */}
            <div
              ref={boxScrollContainerRef}
              className="flex-1 overflow-auto p-6 flex items-start justify-center"
            >
              <div
                className="relative border border-slate-700 rounded-lg shadow-2xl bg-slate-900 inline-block transition-transform duration-100 origin-top"
                style={{
                  transform: `scale(${zoomLevel})`,
                  transformOrigin: 'top center',
                }}
              >
                <canvas
                  ref={boxCanvasRef}
                  onMouseDown={handleBoxMouseDown}
                  onMouseMove={handleBoxMouseMove}
                  onMouseUp={handleBoxMouseUp}
                  className="cursor-crosshair block"
                  style={{ imageRendering: 'pixelated' }}
                />
              </div>
            </div>

            {/* Bottom Status / Derived Parameters Card */}
            <div className="bg-slate-900 border-t border-slate-800 px-6 py-3 flex items-center justify-between">
              <div className="flex items-center space-x-4">
                {boxPreviewDataUrl && (
                  <div className="flex items-center space-x-2 bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-700">
                    <span className="text-xs text-slate-400">Sample Box:</span>
                    <img
                      src={boxPreviewDataUrl}
                      alt="Sample Box"
                      className="w-7 h-7 object-contain bg-white border border-slate-600 rounded"
                    />
                  </div>
                )}
                {hasValidBox && (
                  <div className="flex items-center space-x-3 text-xs text-slate-300">
                    <span>
                      Box Size: <strong className="text-white font-mono">{params.w} × {params.h} px</strong>
                    </span>
                    <span className="text-slate-600">•</span>
                    <span>
                      Fill Threshold: <strong className="text-emerald-400 font-mono">{Math.round(params.fill_limit)} px</strong>
                    </span>
                  </div>
                )}
                {snapStatus && (
                  <span className="text-xs text-rose-400 italic">
                    {snapStatus}
                  </span>
                )}
              </div>

              <div className="text-xs text-slate-400">
                Independent box detection and question layout will run on every scanned page during marking.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
