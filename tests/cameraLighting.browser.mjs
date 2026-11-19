import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false}});
await server.listen();
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]+'tests/fixtures/camera.html');
  const results = await page.evaluate(async () => {
    const { getCV } = await import('/src/utils/cvLoader.ts');
    const { whitenPaper } = await import('/src/utils/camera/lighting.ts');
    const cv = await getCV();
    const results = [];
    for (const [width,height] of [[842,1200],[4800,6840]]) {
      const image = new cv.Mat(height,width,cv.CV_8UC4);
      // Coloured ambient light, broad soft phone shadow, black print and faint pencil.
      for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
        const nx=x/width, ny=y/height;
        const shadow=.5+.5/(1+Math.exp(-(nx-.48)*45));
        const light=shadow*(.75+.15*ny);
        const pencil=ny>.62&&ny<.625&&nx>.15&&nx<.85;
        const ink=ny>.35&&ny<.354&&nx>.15&&nx<.85;
        const reflectance=ink?25:pencil?220:255;
        const i=(y*width+x)*4;
        for(let c=0;c<3;c++) image.data[i+c]=Math.round(reflectance*light*[1,.94,.88][c]);
        image.data[i+3]=255;
      }
      whitenPaper(cv,image);
      const pixel=(x,y)=>Array.from(image.ucharPtr(Math.floor(y*height),Math.floor(x*width))).slice(0,3);
      const paper=[pixel(.25,.5),pixel(.75,.5),pixel(.48,.5)];
      const pencil=[pixel(.25,.622),pixel(.75,.622)];
      const ink=pixel(.25,.352);
      if(paper.flat().some(v=>v<245)) throw Error('Paper/shadow not corrected: '+JSON.stringify(paper));
      if(pencil.flat().some(v=>v<205||v>235)) throw Error('Faint pencil contrast lost: '+JSON.stringify(pencil));
      if(ink.some(v=>v>40)) throw Error('Black print faded');
      results.push({width,height,paper,pencil,ink});
      image.delete();
    }
    return results;
  });
  assert.equal(results.length,2);
  console.log(JSON.stringify(results));
} finally { await browser.close(); await server.close(); }
