import type { AlignmentRect } from './alignmentReference';
export interface ManualPageAlignment {
  skip?: boolean;
  angle: number;
  /** Rectangle in the rotated page, expressed in canonical 4800×6840 coordinates. */
  rect: AlignmentRect;
}
export class AlignmentError extends Error {
  constructor(message: string) { super(message); this.name = 'AlignmentError'; }
}
export function validateManualAlignment(value: ManualPageAlignment): void {
  const [x,y,w,h] = value.rect;
  if (![value.angle,x,y,w,h].every(Number.isFinite) || Math.abs(value.angle)>360 ||
      x<0 || y<0 || w<50 || h<50 || x+w>4800.01 || y+h>6840.01)
    throw new Error('Draw an alignment rectangle inside the page, at least 50 pixels wide and high.');
}
export interface AlignmentRecoveryRequest { index: number; name: string; message: string }
export type AlignmentRecovery = (request: AlignmentRecoveryRequest, signal: AbortSignal) => Promise<ManualPageAlignment>;
