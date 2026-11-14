import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {createServer} from 'vite';
const reference=process.env.PDF_EXPORT_REFERENCE_JPEG ? await readFile(process.env.PDF_EXPORT_REFERENCE_JPEG) : undefined;
const server=await createServer({optimizeDeps:{include:['pdf-lib']},plugins:[{name:'test-reference-image',configureServer(server){if(reference) server.middlewares.use('/__reference.jpg',(_req,res)=>{res.setHeader('Content-Type','image/jpeg');res.end(reference);});}}],server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();await page.goto(server.resolvedUrls.local[0]);
  const report=await page.evaluate(async hasReference=>{
    const {pdfPageJpeg}=await import('/src/utils/pdfPageImage.ts');
    const {exportAnnotatedPdf}=await import('/src/utils/exportPdf.ts');
    const {PDFDocument,PDFName,PDFRawStream}=await import('/tests/helpers/pdfInspection.ts');
    const canvas=new OffscreenCanvas(1024,1459),ctx=canvas.getContext('2d');
    if(hasReference){
      const image=await createImageBitmap(await (await fetch('/__reference.jpg')).blob());
      canvas.width=image.width;canvas.height=image.height;ctx.drawImage(image,0,0);image.close();
    }else{
      const pixels=ctx.createImageData(canvas.width,canvas.height);let seed=17;
      for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)|0;const grey=232+(seed>>>28);pixels.data.set([grey,grey,grey,255],i);}
      ctx.putImageData(pixels,0,0);
    }
    // Representative annotation colours must survive JPEG compression.
    ctx.fillStyle='#ff0000';ctx.fillRect(10,10,40,40);ctx.fillStyle='#00aa00';ctx.fillRect(70,10,40,40);
    const png=await canvas.convertToBlob({type:'image/png'});
    const jpeg=await pdfPageJpeg(png),decoded=await createImageBitmap(jpeg);
    const check=(ok,message)=>{if(!ok)throw Error(message);};
    check(decoded.width===canvas.width&&decoded.height===canvas.height,'Compression must retain native dimensions');
    ctx.drawImage(decoded,0,0);decoded.close();
    const red=ctx.getImageData(30,30,1,1).data,green=ctx.getImageData(90,30,1,1).data;
    check(red[0]>220&&red[1]<30&&green[1]>140&&green[0]<30,'Red and green annotations must remain distinct');
    const baseline=await PDFDocument.create(),lossless=await baseline.embedPng(await png.arrayBuffer());
    baseline.addPage([595.28,841.89]).drawImage(lossless,{x:0,y:0,width:595.28,height:841.89});
    await baseline.flush();const losslessBytes=(await baseline.save()).length;
    const url=URL.createObjectURL(png);
    const blob=await exportAnnotatedPdf({students:[{name:'Compression check',score:1,total:1,percentage:100,responses:['A'],annotatedDataUrl:url}],stats:[],answerKey:{0:'A'}},()=>{});
    URL.revokeObjectURL(url);
    const pdf=await PDFDocument.load(await blob.arrayBuffer());
    const images=pdf.context.enumerateIndirectObjects().map(([,obj])=>obj).filter(obj=>obj instanceof PDFRawStream&&obj.dict.get(PDFName.of('Subtype'))===PDFName.of('Image'));
    const native=images.find(image=>image.dict.get(PDFName.of('Width'))?.asNumber()===canvas.width&&image.dict.get(PDFName.of('Height'))?.asNumber()===canvas.height);
    check(native?.dict.get(PDFName.of('Filter'))===PDFName.of('DCTDecode'),'PDF must embed the full-resolution JPEG');
    // Transparent input must produce a white printable background.
    const transparent=new OffscreenCanvas(10,10),whiteCtx=transparent.getContext('2d');
    const white=await createImageBitmap(await pdfPageJpeg(await transparent.convertToBlob()));
    whiteCtx.drawImage(white,0,0);white.close();
    check(whiteCtx.getImageData(5,5,1,1).data[0]>250,'Transparent backgrounds must print white');
    return {width:canvas.width,height:canvas.height,losslessPdfBytes:losslessBytes,jpegReportBytes:blob.size,jpegImageBytes:jpeg.size,pages:pdf.getPageCount(),annotationColours:true,whiteBackground:true};
  },!!reference);
  assert.ok(report.jpegReportBytes<report.losslessPdfBytes*0.5,'JPEG report should be substantially smaller even including stats pages');
  console.log(report);
} finally {await browser.close();await server.close();}
