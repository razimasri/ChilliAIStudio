/** A strict gate: coloured pixels and transparency always retain the colour path. */
export function isOpaqueMonochrome(cv: any, image: any): boolean {
  const channels = image.channels();
  if (image.depth() !== cv.CV_8U || !image.isContinuous() || (channels !== 3 && channels !== 4)) return false;
  const bytes = image.data;
  // Compare all RGB bytes with two XORs from a single load per RGBA pixel.
  // Keep the byte path on unaligned buffers or a big-endian host.
  if (channels === 4 && bytes.byteOffset % 4 === 0 &&
      new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {
    const pixels = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    for (let i = 0; i < pixels.length; i++) {
      const pixel = pixels[i];
      if (((pixel ^ (pixel >>> 8)) & 0xffff) !== 0 || (pixel >>> 24) !== 255) return false;
    }
    return true;
  }
  for (let i = 0; i < bytes.length; i += channels) {
    if (bytes[i] !== bytes[i + 1] || bytes[i] !== bytes[i + 2] || (channels === 4 && bytes[i + 3] !== 255)) return false;
  }
  return true;
}

/** Match OpenCV's nearest-even float-to-uint8 conversion. */
function cvRound(value: number): number {
  const rounded = Math.round(value);
  return Math.abs(value-rounded) === .5 && rounded % 2 !== 0 ? rounded-1 : rounded;
}

/**
 * Restore opaque-source alpha only around rotated page borders. This mirrors
 * OpenCV 5's float32 bilinear kernel in warp_kernels.simd.hpp and
 * warp_common.scalar.hpp, including nearest-even conversion to uint8.
 * Global coordinates avoid the rounding changes caused by translated tiles.
 */
function restoreOpaqueAlpha(image: any, destination: any, matrix: any): void {
  const m = Array.from(matrix.data64F) as number[];
  let determinant = m[0]*m[4]-m[1]*m[3];
  determinant = determinant !== 0 ? 1/determinant : 0;
  const a11=m[4]*determinant, a22=m[0]*determinant;
  m[0]=a11; m[1]*=-determinant; m[3]*=-determinant; m[4]=a22;
  const b1=-m[0]*m[2]-m[1]*m[5], b2=-m[3]*m[2]-m[4]*m[5];
  m[2]=b1;m[5]=b2;
  const f = Math.fround;
  for(let i=0;i<6;i++) m[i]=f(m[i]);
  const cols=image.cols, rows=image.rows, bytes=destination.data;
  const dx=new Float32Array(cols), dy=new Float32Array(cols);
  for(let x=0;x<cols;x++) {dx[x]=f(m[0]*x);dy[x]=f(m[3]*x);}
  // Our pinned SIMD build retains the scalar kernel's float32 association.
  const borderX=Math.min(cols,Math.ceil(Math.abs(m[0]-1)*cols/2+Math.abs(m[1])*rows/2)+4);
  const borderY=Math.min(rows,Math.ceil(Math.abs(m[3])*cols/2+Math.abs(m[4]-1)*rows/2)+4);
  for(let y=0;y<rows;y++) {
    const rowX=f(m[1]*y), rowY=f(m[4]*y);
    const write=(start:number,end:number)=>{
      let output=(y*cols+start)*4+3;
      for(let x=start;x<end;x++,output+=4) {
        const sourceX = f(f(dx[x]+rowX)+m[2]);
        const sourceY = f(f(dy[x]+rowY)+m[5]);
        const sx=Math.floor(sourceX), sy=Math.floor(sourceY);
        if(sx < -1 || sy < -1 || sx >= cols || sy >= rows) {bytes[output]=0;continue;}
        if(sx >= 0 && sy >= 0 && sx+1 < cols && sy+1 < rows) continue;
        const fx=f(sourceX-sx), fy=f(sourceY-sy);
        const p00=sx>=0&&sy>=0?255:0;
        const p01=sx+1<cols&&sy>=0?255:0;
        const p10=sx>=0&&sy+1<rows?255:0;
        const p11=sx+1<cols&&sy+1<rows?255:0;
        const v0=f(p00+f(fx*(p01-p00))), v1=f(p10+f(fx*(p11-p10)));
        bytes[output]=cvRound(f(v0+f(fy*f(v1-v0))));
      }
    };
    if(y<borderY||y>=rows-borderY) write(0,cols);
    else {write(0,borderX);write(Math.max(borderX,cols-borderX),cols);}
  }
}

/** Warp luminance once and restore the original channel count before annotation. */
export function warpMonochrome(cv: any, image: any, destination: any, matrix: any): void {
  const gray = new cv.Mat(), warped = new cv.Mat();
  try {
    cv.cvtColor(image, gray, image.channels() === 4 ? cv.COLOR_RGBA2GRAY : cv.COLOR_RGB2GRAY);
    cv.warpAffine(gray, warped, matrix, new cv.Size(image.cols, image.rows));
    cv.cvtColor(warped, destination, image.channels() === 4 ? cv.COLOR_GRAY2RGBA : cv.COLOR_GRAY2RGB);
    if (image.channels() === 4) restoreOpaqueAlpha(image,destination,matrix);
  } finally {gray.delete();warped.delete();}
}
