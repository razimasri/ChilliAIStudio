import { useEffect, useRef, useState } from 'react';
import { Camera, LoaderCircle, X } from 'lucide-react';
import { Dialog } from './Dialog';
import { CameraClient } from '../utils/camera/client';
import { cameraError, collectedPage, photograph, placeCapture } from '../utils/camera/batchCapture';
import type { BatchPage } from '../utils/camera/batchCapture';
import type { CapturedPage } from '../utils/camera/scanner';
function useUrl(blob?: Blob) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    if (!blob) { setUrl(''); return; }
    const url = URL.createObjectURL(blob); setUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [blob]);
  return url;
}
function Thumbnail({ page, className = '' }: { page: BatchPage; className?: string }) {
  const url = useUrl(page.thumbnail);
  return <img src={url || undefined} alt="Corrected sheet thumbnail" loading="lazy" className={className} style={{ transform: `rotate(${page.rotation}deg)` }} />;
}
function LargePreview({ page, number, onClose }: { page: BatchPage; number: number; onClose: () => void }) {
  const url = useUrl(page.file);
  return <div className="space-y-2 rounded-xl border border-[#571622] p-3">
    <div className="flex items-center justify-between"><h3>Sheet {number}</h3><button onClick={onClose} className="min-h-11 px-3">Close preview</button></div>
    <img src={url || undefined} alt={`Corrected sheet ${number}`} className="w-full max-h-[55dvh] object-contain" style={{ transform: `rotate(${page.rotation}deg)` }} />
  </div>;
}
export default function BatchCameraScanner({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (pages: BatchPage[], signal: AbortSignal, progress: (message: string) => void) => Promise<void>;
}) {
  const [mode, setMode] = useState<'camera' | 'review'>('camera');
  const [pages, setPages] = useState<BatchPage[]>([]);
  const [recentId, setRecentId] = useState<string>();
  const [replaceId, setReplaceId] = useState<string>();
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Opening rear camera…'), [error, setError] = useState('');
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream>();
  const client = useRef<CameraClient>();
  const pending = useRef(false);
  const alive = useRef(false);
  const lifetime = useRef<AbortController>();
  useEffect(() => {
    alive.current = true; const controller = new AbortController(); lifetime.current = controller;
    return () => { alive.current = false; controller.abort(); };
  }, []);
  useEffect(() => {
    if (mode !== 'camera') return;
    const element = video.current;
    let cancelled = false;
    let current: MediaStream | undefined;
    const scanner = new CameraClient(); client.current = scanner;
    setReady(false); setError(''); setStatus('Opening rear camera…');
    const stop = () => { current?.getTracks().forEach(track => track.stop()); };
    void (async () => {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
          throw new Error('Live batch capture needs camera support and a secure HTTPS connection. Use Scan with Camera or Choose files instead.');
        current = await navigator.mediaDevices.getUserMedia({ audio: false, video: {
          facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 },
        } });
        if (cancelled) { stop(); return; }
        stream.current = current;
        const track = current.getVideoTracks()[0];
        if (!track) throw new Error('No video camera is available. Try another camera or Choose files.');
        track.addEventListener('ended', () => {
          if (!cancelled) { setReady(false); setError('The camera stopped. Previously captured sheets are safe. Try opening the camera again.'); }
        });
        if (!element) { stop(); return; }
        element.srcObject = current;
        await element.play();
        if (!cancelled) { setReady(true); setStatus('Place the full sheet in view, then tap Capture.'); }
      } catch (err) {
        stop();
        if (!cancelled) { setReady(false); setError(cameraError(err)); }
      }
    })();
    return () => {
      cancelled = true; stop(); scanner.dispose();
      if (stream.current === current) stream.current = undefined;
      if (client.current === scanner) client.current = undefined;
      if (element && element.srcObject === current) { element.pause(); element.srcObject = null; }
    };
  }, [mode, cameraAttempt]);
  async function capture() {
    if (pending.current || !ready || !video.current || !client.current || !stream.current) return;
    pending.current = true; setBusy(true); setError(''); setStatus('Capturing sheet. Keep it steady…');
    const replacement = replaceId;
    const scanner = client.current;
    try {
      const input = await photograph(video.current, stream.current.getVideoTracks()[0]);
      if (!alive.current) return;
      const captured = await scanner.request<CapturedPage>({ type: 'capture', input }, message => { if (alive.current) setStatus(message); });
      if (!alive.current) return;
      const page = collectedPage(captured);
      setPages(current => placeCapture(current, page, replacement));
      setReplaceId(undefined); setRecentId(replacement || page.id);
      setStatus(replacement ? 'Sheet replaced. Ready for the next sheet.' : 'Sheet added. Ready for the next sheet.');
    } catch (err) { if (alive.current) { setError(cameraError(err)); setStatus('No sheet added. Adjust the page and try again.'); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  function review() {
    if (pending.current || !pages.length) return;
    setReplaceId(undefined); setError(''); setMode('review');
  }
  function retake(id: string) {
    if (pending.current) return;
    setSelected(undefined); setReplaceId(id); setError(''); setMode('camera');
  }
  async function confirm() {
    if (pending.current || !pages.length) return;
    pending.current = true; setBusy(true); setError('');
    try {
      await onConfirm(pages, lifetime.current!.signal, message => { if (alive.current) setStatus(message); });
    } catch (err) { if (alive.current) setError(cameraError(err)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }
  const recent = pages.find(page => page.id === recentId) || pages[pages.length - 1];
  const selectedIndex = pages.findIndex(page => page.id === selected);
  const replacementIndex = pages.findIndex(page => page.id === replaceId);
  return <Dialog titleId="batch-title" onClose={onClose} className="max-w-4xl">
    <div className="p-4 sm:p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="batch-title" className="text-xl font-bold">{mode === 'camera' ? 'Batch Scan' : 'Review scanned sheets'}</h2>
        <button onClick={onClose} aria-label="Cancel batch scanning" className="min-h-11 min-w-11 flex items-center justify-center"><X /></button>
      </div>
      <p className="font-semibold text-[#f3b0ba]" aria-live="polite">{pages.length} sheet{pages.length === 1 ? '' : 's'} captured</p>
      {error && <p role="alert" className="rounded-xl border border-red-800 bg-red-950/60 p-3 text-red-200">{error}</p>}
      {mode === 'camera' ? <>
        <p className="text-sm text-[#d8c7ca]">Keep the entire sheet flat, upright and in focus on a contrasting surface. Capture each sheet, then move to the next. Review the batch when finished.</p>
        {replaceId && <p className="rounded-xl border border-amber-700 bg-amber-950/30 p-3 text-amber-200">Next capture replaces sheet {replacementIndex + 1}. The previous scan stays until the replacement succeeds.
          <button disabled={busy} onClick={() => setReplaceId(undefined)} className="min-h-11 px-3 underline">Keep previous scan</button></p>}
        <div className="relative rounded-xl overflow-hidden bg-black min-h-48">
          <video ref={video} autoPlay muted playsInline aria-label="Live rear camera" className="w-full max-h-[45dvh] object-contain" />
          {busy && <div className="absolute inset-0 bg-black/60 flex items-center justify-center"><LoaderCircle size={42} className="animate-spin" /></div>}
        </div>
        <div className="flex items-center gap-3 min-h-20">
          {recent && <Thumbnail page={recent} className="w-14 h-20 object-contain rounded bg-black" />}
          <p role="status" className={`text-sm ${status.includes('added') || status.includes('replaced') ? 'text-emerald-300' : 'text-[#d8c7ca]'}`}>{status}</p>
        </div>
        {!ready && !busy && <button onClick={() => setCameraAttempt(value => value + 1)} className="min-h-11 rounded-xl bg-[#571622] px-4">Try opening camera again</button>}
        <div className="sticky bottom-0 bg-[#240c10] py-2 flex flex-wrap gap-2">
          <button onClick={() => void capture()} disabled={busy || !ready} className="min-h-14 flex-1 rounded-xl bg-[#8c1529] px-6 text-lg font-bold flex gap-2 items-center justify-center disabled:opacity-40"><Camera />{replaceId ? 'Capture replacement' : 'Capture'}</button>
          <button onClick={() => recent && retake(recent.id)} disabled={busy || !pages.length} className="min-h-11 rounded-xl bg-[#571622] px-3 disabled:opacity-40">Retake Last Scan</button>
          <button onClick={review} disabled={busy || !pages.length} className="min-h-11 rounded-xl bg-emerald-900 px-4 font-semibold disabled:opacity-40">Finish Scanning</button>
          <button onClick={onClose} className="min-h-11 px-3">Cancel</button>
        </div>
      </> : <>
        <p className="text-sm text-[#d8c7ca]">Check sheet order and orientation. Remove or retake any unwanted scan. Confirming adds these pages to your exam; calibration and marking come afterwards.</p>
        {selectedIndex >= 0 && <LargePreview page={pages[selectedIndex]} number={selectedIndex + 1} onClose={() => setSelected(undefined)} />}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {pages.map((page, index) => <article key={page.id} aria-label={`Scanned sheet ${index + 1}`} className="rounded-xl border border-[#571622] bg-[#18090b] p-2 space-y-1">
            <button disabled={busy} onClick={() => setSelected(page.id)} aria-label={`Preview scanned sheet ${index + 1}`} className="w-full aspect-[2/3] block rounded bg-black overflow-hidden">
              <Thumbnail page={page} className="w-full h-full object-contain" />
            </button>
            <p className="font-semibold">Sheet {index + 1}</p>
            {page.warnings.map(warning => <p key={warning} className="text-xs text-amber-200">{warning}</p>)}
            <div className="flex flex-wrap">
              <button disabled={busy} onClick={() => retake(page.id)} className="min-h-11 px-2 text-sm">Retake</button>
              <button disabled={busy} onClick={() => setPages(current => current.map(p => p.id === page.id ? { ...p, rotation: (p.rotation + 180) % 360 } : p))} className="min-h-11 px-2 text-sm">Rotate 180°</button>
              <button disabled={busy} onClick={() => { setPages(current => current.filter(p => p.id !== page.id)); if (selected === page.id) setSelected(undefined); }} className="min-h-11 px-2 text-sm text-red-300">Remove</button>
            </div>
          </article>)}
        </div>
        <div className="sticky bottom-0 bg-[#240c10] py-2 flex flex-wrap items-center gap-2">
          <button disabled={busy} onClick={() => { setSelected(undefined); setMode('camera'); }} className="min-h-11 rounded-xl bg-[#571622] px-4 disabled:opacity-40">Add more sheets</button>
          <button onClick={() => void confirm()} disabled={busy || !pages.length} className="min-h-11 rounded-xl bg-[#8c1529] px-5 font-bold disabled:opacity-40 ml-auto">Confirm batch</button>
          <button onClick={onClose} className="min-h-11 px-3">Cancel</button>
        </div>
        {busy && <p role="status" className="flex gap-2 items-center"><LoaderCircle className="animate-spin" />{status}</p>}
      </>}
    </div>
  </Dialog>;
}
