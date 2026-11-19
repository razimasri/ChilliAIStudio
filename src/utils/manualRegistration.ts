import type { AlignmentRect } from './alignmentReference';
import { TEMPLATE_WIDTH, TEMPLATE_HEIGHT } from './pageGeometry';

/** Manual selections may differ substantially from the reference. Write directly
 * to the bounded output canvas rather than allocating an arbitrarily enlarged page.
 */
export function registerManualPage(cv: any, image: any, rect: AlignmentRect, reference: AlignmentRect): any {
  const [x,y,w,h]=rect, [rx,ry,rw,rh]=reference;
  const sx=rw/w, sy=rh/h;
  const dx=rx-Math.round(x*sx), dy=ry-Math.round(y*sy);
  // Match resize's rounded dimensions and half-pixel centre convention.
  const ax=Math.max(1,Math.round(image.cols*sx))/image.cols;
  const ay=Math.max(1,Math.round(image.rows*sy))/image.rows;
  const matrix=cv.matFromArray(2,3,cv.CV_64F,[ax,0,dx+(ax-1)/2,0,ay,dy+(ay-1)/2]);
  const output=new cv.Mat();
  try {
    cv.warpAffine(image,output,matrix,new cv.Size(TEMPLATE_WIDTH,TEMPLATE_HEIGHT),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(255,255,255,255));
    return output;
  } catch(error){output.delete();throw error;}
  finally{matrix.delete();}
}
