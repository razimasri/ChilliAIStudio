import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, RotateCcw, X } from 'lucide-react';
import { Dialog } from './Dialog';
import { CameraClient } from '../utils/camera/client';
import type { Corners } from '../utils/camera/geometry';
import type { PreparedPhoto, ScanPreview } from '../utils/camera/scanner';
function useBlobUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const url = URL.createObjectURL(blob); setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return url;
}
export default function CameraScanner({ file, onClose, onRetry, onConfirm }: {
  file: File; onClose: () => void; onRetry: () => void; onConfirm: (file: File, signal: AbortSignal) => Promise<void>;
}) {
  const client = useRef<CameraClient>();
  const lifetime = useRef<AbortController>();
  const [photo, setPhoto] = useState<PreparedPhoto>();
  const [preview, setPreview] = useState<ScanPreview>();
  const [corners, setCorners] = useState<Corners>();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(true);
  const [status, setStatus] = useState('Loading camera scanner…');
  const [error, setError] = useState('');
  const alive = useRef(true);
  const svg = useRef<SVGSVGElement>(null);
  const active = useRef<{ index: number; pointer: number }>();
  const originalUrl = useBlobUrl(photo?.original), previewUrl = useBlobUrl(preview?.preview);
  useEffect(() => {
    alive.current = true;
    const session = new CameraClient(); client.current = session;
    const controller = new AbortController(); lifetime.current = controller;
    void session.request<PreparedPhoto>({ type: 'prepare', input: file }, message => { if (alive.current && client.current === session) setStatus(message); }).then(result => {
      if (!alive.current || client.current !== session) return;
      setPhoto(result); setPreview(result); setCorners(result.corners);
      setEditing(result.needsCorners);
      setError(result.error || '');
    }).catch(err => { if (alive.current && client.current === session) setError(err.message); })
      .finally(() => { if (alive.current && client.current === session) setBusy(false); });
    return () => { alive.current = false; controller.abort(); session.dispose(); };
  }, [file]);
  async function update(rotation = preview?.rotation || 0) {
    if (!corners || !client.current) return;
    setBusy(true); setError('');
    try {
      const result = await client.current.request<ScanPreview>({ type: 'preview', corners, rotation }, setStatus);
      if (!alive.current) return;
      setPreview(result); setError(result.error || ''); setEditing(false);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'Could not update the preview.'); }
    finally { if (alive.current) setBusy(false); }
  }
  async function confirm() {
    if (!preview || !client.current || editing || busy) return;
    setBusy(true); setError('');
    try {
      const blob = await client.current.request<Blob>({ type: 'export', corners: preview.corners, rotation: preview.rotation }, setStatus);
      if (!alive.current) return;
      await onConfirm(new File([blob], `Camera-${file.name.replace(/\.[^.]+$/, '')}.png`, { type: 'image/png' }), lifetime.current!.signal);
    } catch (err) { if (alive.current) setError(err instanceof Error ? err.message : 'Could not save the corrected scan.'); }
    finally { if (alive.current) setBusy(false); }
  }
  function moveCorner(index: number, x: number, y: number) {
    setCorners(previous => previous?.map((p, i) => i === index ? { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) } : p) as Corners);
  }
  return <Dialog titleId="camera-title" onClose={onClose} className="max-w-3xl">
    <div className="p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id="camera-title" className="font-bold text-xl">Preview camera scan</h2>
        <button aria-label="Close camera scanner" className="min-h-11 min-w-11 flex items-center justify-center" onClick={onClose}><X /></button>
      </div>
      <p className="text-sm text-[#d8c7ca]">{editing ? 'Place each handle on the outer corner of the paper, not the printed answer grid. Drag with a finger or use arrow keys.' : 'Check that the entire sheet is upright and the answer boxes are sharp. Camera scans use your existing answer key and calibration flow.'}</p>
      {error && <p role="alert" className="rounded-xl bg-red-950/60 border border-red-800 p-3 text-red-200">{error}</p>}
      {preview?.warnings.map(warning => <p key={warning} className="text-sm text-amber-200">{warning}</p>)}
      <div aria-busy={busy} className="relative rounded-xl bg-[#18090b] overflow-hidden min-h-48 flex items-center justify-center">
        {editing && photo && corners ? <svg ref={svg} viewBox={`0 0 ${photo.width} ${photo.height}`} className="w-full max-h-[60dvh]" style={{ aspectRatio: `${photo.width}/${photo.height}`, touchAction: 'none' }}
          onPointerMove={event => {
            if (!active.current || event.pointerId !== active.current.pointer || busy) return;
            // SVG may be letterboxed by max-height; map through its actual viewBox.
            const matrix = svg.current!.getScreenCTM(); if (!matrix) return;
            const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
            moveCorner(active.current.index, point.x / photo.width, point.y / photo.height);
          }}
          onPointerUp={() => { active.current = undefined; }} onPointerCancel={() => { active.current = undefined; }}>
          <image href={originalUrl} width={photo.width} height={photo.height} />
          <polygon points={corners.map(p => `${p.x * photo.width},${p.y * photo.height}`).join(' ')} fill="#8c152922" stroke="#00dc9b" strokeWidth={4} />
          {corners.map((p, i) => <g key={i} role="slider" tabIndex={busy ? -1 : 0} aria-label={`Page corner ${i + 1}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.x * 100)} aria-valuetext={`${Math.round(p.x * 100)}% across, ${Math.round(p.y * 100)}% down`}
            onPointerDown={event => { if (busy) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); active.current = { index: i, pointer: event.pointerId }; }}
            onKeyDown={event => {
              if (busy || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
              event.preventDefault(); const step = event.shiftKey ? .01 : .002;
              moveCorner(i, p.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), p.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0));
            }}>
            <circle cx={p.x * photo.width} cy={p.y * photo.height} r={Math.max(photo.width, photo.height) * .065} fill="transparent" />
            <circle cx={p.x * photo.width} cy={p.y * photo.height} r={Math.max(photo.width, photo.height) * .016} fill="#00dc9b" stroke="white" strokeWidth={3} />
          </g>)}
        </svg> : previewUrl && <img src={previewUrl} alt="Perspective-corrected answer sheet" className="max-h-[60dvh] w-full object-contain" />}
        {busy && <div role="status" aria-live="polite" className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center gap-3 p-4 text-center"><LoaderCircle className="animate-spin" size={36} />{status}</div>}
      </div>
      <div className="flex flex-wrap gap-2 items-center sticky bottom-0 bg-[#240c10] py-2">
        <button onClick={onRetry} className="min-h-11 px-4 rounded-xl bg-[#571622]">Retake photo</button>
        {preview && <button disabled={busy} onClick={() => editing ? void update() : setEditing(true)} className="min-h-11 px-4 rounded-xl bg-[#571622] disabled:opacity-50">{editing ? 'Update preview' : 'Adjust corners'}</button>}
        {preview && !editing && <button disabled={busy} onClick={() => void update((preview.rotation + 1) % 4)} className="min-h-11 px-4 rounded-xl bg-[#571622] disabled:opacity-50 flex items-center gap-2"><RotateCcw size={18} />Rotate 90°</button>}
        <button disabled={busy || editing || Boolean(error) || !preview} onClick={() => void confirm()} className="min-h-11 px-5 rounded-xl bg-[#8c1529] font-bold disabled:opacity-40 ml-auto">Confirm scan</button>
      </div>
    </div>
  </Dialog>;
}
