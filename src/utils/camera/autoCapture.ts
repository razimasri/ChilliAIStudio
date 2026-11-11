import type { Corners, Point } from './geometry';
export const AUTO_INTERVAL = 250;
const COLS = 32, ROWS = 24;
export interface SceneFrame { width: number; height: number; corners?: Corners; pixels: Uint8Array }
export type AutoState = 'READY' | 'DETECTING' | 'CAPTURING' | 'WAITING_FOR_REMOVAL';
export interface AutoDecision { state: AutoState; message: string; capture: boolean }
/** Small colour thumbnail. Kept only for the current stability/removal decision. */
export function scenePixels(frame: ImageData): Uint8Array {
  const output = new Uint8Array(COLS * ROWS * 3);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const px = Math.round(x * (frame.width - 1) / (COLS - 1));
    const py = Math.round(y * (frame.height - 1) / (ROWS - 1));
    for (let c = 0; c < 3; c++) {
      let sum = 0, count = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const sx = Math.max(0, Math.min(frame.width - 1, px + dx));
        const sy = Math.max(0, Math.min(frame.height - 1, py + dy));
        sum += frame.data[(sy * frame.width + sx) * 4 + c]; count++;
      }
      output[(y * COLS + x) * 3 + c] = Math.round(sum / count);
    }
  }
  return output;
}
function median(values: number[]) { values.sort((a, b) => a - b); return values[Math.floor(values.length / 2)] || 0; }
function border(pixels: Uint8Array): number[] {
  return [0, 1, 2].map(c => {
    const values: number[] = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++)
      if (x === 0 || x === COLS - 1 || y === 0 || y === ROWS - 1) values.push(pixels[(y * COLS + x) * 3 + c]);
    return median(values);
  });
}
function inside(p: Point, corners: Corners) {
  return corners.every((a, i) => { const b = corners[(i + 1) % 4]; return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0; });
}
export function uprightPage(corners: Corners, width: number, height: number): boolean {
  const distance = (a: Point, b: Point) => Math.hypot((a.x - b.x) * width, (a.y - b.y) * height);
  const w = (distance(corners[0], corners[1]) + distance(corners[3], corners[2])) / 2;
  const h = (distance(corners[0], corners[3]) + distance(corners[1], corners[2])) / 2;
  return w / h >= .53 && w / h <= .86 &&
    Math.abs((corners[1].y - corners[0].y) * height) < w * .25 &&
    Math.abs((corners[3].x - corners[0].x) * width) < h * .25;
}
function displacement(a: Corners, b: Corners) { return Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))); }
function changed(a: Uint8Array, b: Uint8Array, offset = [0, 0, 0], mask?: Corners) {
  let differences = 0, count = 0;
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (mask && !inside({ x: x / (COLS - 1), y: y / (ROWS - 1) }, mask)) continue;
    const i = (y * COLS + x) * 3; count++;
    if ([0, 1, 2].some(c => Math.abs(a[i + c] - b[i + c] - offset[c]) > 14)) differences++;
  }
  return differences / Math.max(1, count);
}
/** Pure deterministic gate. Failed edge detection alone can never unlock a captured page. */
export class AutoCaptureGate {
  state: AutoState = 'READY';
  private anchor?: SceneFrame;
  private last?: SceneFrame;
  private candidate?: SceneFrame;
  private captured?: SceneFrame;
  private background?: Uint8Array;
  private backgroundColour?: number[];
  private stableSince = 0;
  private clearSince?: number;
  private lastTime = 0;
  private samples = 0;
  private retryAfter = 0;
  private message = 'Place sheet in view';
  private paused = false;
  setPaused(paused: boolean) { this.paused = paused; this.resetTiming(); }
  private resetTiming() { this.anchor = this.last = undefined; this.clearSince = undefined; this.samples = 0; this.lastTime = 0; }
  private decision(capture = false): AutoDecision { return { state: this.state, message: this.paused ? 'Paused' : this.message, capture }; }
  private backgroundMatches(frame: SceneFrame, colour: number[], reference?: Uint8Array) {
    const current = border(frame.pixels), offset = current.map((v, c) => v - colour[c]);
    // An extreme exposure change is uncertainty, never proof that the desk is clear.
    if (offset.some(v => Math.abs(v) > 35) || current.reduce((a, b) => a + b) < 60) return false;
    if (reference) return changed(frame.pixels, reference, offset) < .005;
    let foreground = 0;
    for (let i = 0; i < frame.pixels.length; i += 3)
      if ([0, 1, 2].some(c => Math.abs(frame.pixels[i + c] - offset[c] - colour[c]) > 24)) foreground++;
    return foreground / (COLS * ROWS) < .005;
  }
  observe(frame: SceneFrame, now: number): AutoDecision {
    if (this.paused || this.state === 'CAPTURING') return this.decision();
    if (now - this.lastTime > 750) { this.anchor = this.last = undefined; this.samples = 0; this.clearSince = undefined; }
    this.lastTime = now;
    if (this.state === 'WAITING_FOR_REMOVAL') {
      const captured = this.captured;
      const clear = captured && !frame.corners && this.backgroundColour &&
        this.backgroundMatches(frame, this.backgroundColour, this.background) &&
        changed(frame.pixels, captured.pixels, [0, 0, 0], captured.corners) >= (captured.corners ? .75 : .12);
      if (clear) {
        this.clearSince ??= now;
        if (now - this.clearSince >= 1000) {
          this.state = 'READY'; this.message = 'Ready for next sheet';
          this.background = frame.pixels.slice(); this.backgroundColour = border(frame.pixels);
          this.captured = undefined; this.resetTiming();
        }
      } else this.clearSince = undefined;
      return this.decision();
    }
    if (!frame.corners) {
      this.state = 'READY'; this.anchor = this.last = undefined; this.samples = 0;
      const colour = border(frame.pixels);
      if (this.backgroundMatches(frame, colour)) {
        this.background = frame.pixels.slice(); this.backgroundColour = colour;
        if (this.message !== 'Ready for next sheet') this.message = 'Place sheet in view';
      } else this.message = 'Show whole page';
      return this.decision();
    }
    this.state = 'DETECTING'; this.message = 'Hold still';
    if (!uprightPage(frame.corners, frame.width, frame.height)) {
      this.anchor = this.last = undefined; this.samples = 0; this.message = 'Position sheet upright'; return this.decision();
    }
    const colour = border(frame.pixels), pageLight: number[] = [];
    // A sheet briefly filling the lens must not become the stored empty-desk reference.
    // This runs only before capture; a removal latch never discards its reference.
    if (this.backgroundColour && colour.some((value, c) => Math.abs(value - this.backgroundColour![c]) > 35)) {
      this.background = undefined; this.backgroundColour = undefined;
    }
    for (let y = 1; y < ROWS - 1; y++) for (let x = 1; x < COLS - 1; x++) {
      if (!inside({ x: x / (COLS - 1), y: y / (ROWS - 1) }, frame.corners)) continue;
      const i = (y * COLS + x) * 3;
      pageLight.push((frame.pixels[i] + frame.pixels[i + 1] + frame.pixels[i + 2]) / 3);
    }
    if (median(pageLight) - colour.reduce((a, b) => a + b) / 3 < 40) {
      this.anchor = this.last = undefined; this.samples = 0; this.message = 'Use a contrasting surface'; return this.decision();
    }
    if (now < this.retryAfter) return this.decision();
    if (!this.anchor?.corners || !this.last?.corners || displacement(frame.corners, this.anchor.corners) > .009 ||
      displacement(frame.corners, this.last.corners) > .006 || changed(frame.pixels, this.last.pixels) > .025) {
      this.anchor = frame; this.stableSince = now; this.samples = 1;
    } else this.samples++;
    this.last = frame;
    if (this.samples >= 4 && now - this.stableSince >= 1000) {
      this.candidate = frame; this.state = 'CAPTURING'; this.message = 'Capturing…'; return this.decision(true);
    }
    return this.decision();
  }
  manual(frame: SceneFrame) { this.candidate = frame; this.state = 'CAPTURING'; this.message = 'Capturing…'; }
  succeeded() {
    this.captured = this.candidate;
    if (!this.backgroundColour && this.captured) this.backgroundColour = border(this.captured.pixels);
    this.candidate = undefined; this.state = 'WAITING_FOR_REMOVAL'; this.message = 'Captured — remove sheet'; this.resetTiming();
  }
  failed(now: number) {
    this.candidate = undefined; this.state = this.captured ? 'WAITING_FOR_REMOVAL' : 'DETECTING';
    this.message = this.captured ? 'Captured — remove sheet' : 'Adjust sheet and try again'; this.retryAfter = now + 1500; this.resetTiming();
  }
}
