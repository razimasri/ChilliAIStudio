import {getCV, getCVRuntimeInfo} from '../../src/utils/cvLoader';
self.onmessage = async () => {
  try {
    const cv = await getCV();
    const image = new cv.Mat(16,16,cv.CV_8UC1,new cv.Scalar(255));
    const count = cv.countNonZero(image); image.delete();
    const source = cv.matFromArray(1,16,cv.CV_32F,[.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5,128.5,129.5,130.5,131.5,252.5,253.5,254.5,255.5]);
    const converted = new cv.Mat();
    source.convertTo(converted,cv.CV_8U);
    const rounded = Array.from(converted.data);
    source.delete(); converted.delete();
    self.postMessage({info:getCVRuntimeInfo(cv),count,rounded});
  } catch(error) {self.postMessage({error:String(error)});}
};
