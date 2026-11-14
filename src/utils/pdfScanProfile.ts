import { OPS } from 'pdfjs-dist';
import type { PDFPageProxy } from 'pdfjs-dist';
import { SCAN_DPI } from './pageGeometry';

export interface ScanProfile { nativeDpi?: number; renderDpi: number; }
type Matrix = [number, number, number, number, number, number];
const identity = (): Matrix => [1,0,0,1,0,0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
}
/** Restrict optimisation to a single page-covering raster, never mixed/vector pages. */
export async function scanProfile(page: PDFPageProxy): Promise<ScanProfile> {
  const list = await page.getOperatorList();
  let matrix = identity();
  const stack: Matrix[] = [];
  let image: {matrix:Matrix;width:number;height:number} | undefined;
  const structural = new Set([OPS.dependency, OPS.setFillRGBColor, OPS.setStrokeRGBColor, OPS.setFillGray, OPS.setStrokeGray, OPS.setFillCMYKColor, OPS.setStrokeCMYKColor, OPS.beginMarkedContent, OPS.beginMarkedContentProps, OPS.endMarkedContent]);
  for (let i=0;i<list.fnArray.length;i++) {
    const op=list.fnArray[i], args=list.argsArray[i];
    if(op===OPS.save) stack.push([...matrix]);
    else if(op===OPS.restore) { if(!stack.length)return {renderDpi:SCAN_DPI}; matrix=stack.pop()!; }
    else if(op===OPS.transform) matrix=multiply(matrix,args as Matrix);
    else if(op===OPS.paintFormXObjectBegin) {stack.push([...matrix]);if(args[0])matrix=multiply(matrix,args[0]);}
    else if(op===OPS.paintFormXObjectEnd) {if(!stack.length)return {renderDpi:SCAN_DPI};matrix=stack.pop()!;}
    else if(op===OPS.paintImageXObject || op===OPS.paintInlineImageXObject) {
      if(image)return {renderDpi:SCAN_DPI};
      const width=op===OPS.paintInlineImageXObject?args[0]?.width:args[1];
      const height=op===OPS.paintInlineImageXObject?args[0]?.height:args[2];
      if(!(width>0&&height>0))return {renderDpi:SCAN_DPI};
      image={matrix:[...matrix],width,height};
    } else if(!structural.has(op)) return {renderDpi:SCAN_DPI};
  }
  if(!image || stack.length)return {renderDpi:SCAN_DPI};
  const [a,b,c,d,e,f]=image.matrix, [x1,y1,x2,y2]=page.view;
  const xs=[e,e+a,e+c,e+a+c],ys=[f,f+b,f+d,f+b+d];
  const coverage=Math.abs(a*d-b*c)/((x2-x1)*(y2-y1));
  if(coverage<0.95 || coverage>1.05 || Math.min(...xs)<x1-2 || Math.max(...xs)>x2+2 || Math.min(...ys)<y1-2 || Math.max(...ys)>y2+2)return {renderDpi:SCAN_DPI};
  const dpiX=image.width*72/(Math.hypot(a,b)*page.userUnit), dpiY=image.height*72/(Math.hypot(c,d)*page.userUnit);
  if(Math.abs(dpiX-dpiY)/Math.max(dpiX,dpiY)>0.01)return {renderDpi:SCAN_DPI};
  let dpi=Math.max(dpiX,dpiY);
  if(!Number.isFinite(dpi)||dpi<=0)return {renderDpi:SCAN_DPI};
  for(const standard of [150,200,300,400,600])if(Math.abs(dpi-standard)/standard<=0.005){dpi=standard;break;}
  // Below 300 DPI the simulations found extra alignment-induced reviews.
  // This is a deterministic compatibility policy, not a retry after failed marking.
  return {nativeDpi:dpi,renderDpi:dpi>=300&&dpi<594?dpi:SCAN_DPI};
}
