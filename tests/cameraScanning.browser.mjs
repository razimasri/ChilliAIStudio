import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build, createServer, preview } from 'vite';
let server;
if (process.env.CAMERA_TEST_BUILD) {
  const outDir = 'work/camera-test-dist';
  await build({ build: { outDir, rollupOptions: { input: 'tests/fixtures/camera.html' } } });
  server = await preview({ build: { outDir }, preview: { host: '127.0.0.1', port: 0 } });
} else { server = await createServer({ server: { host: '127.0.0.1', port: 0, hmr: false } }); await server.listen(); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await browser.newPage();
  page.on('console', message => { if (message.text().startsWith('camera:')) console.log(message.text()); });
  await page.goto(server.resolvedUrls.local[0] + 'tests/fixtures/camera.html');
  await page.waitForFunction(() => window.cameraFixture);
  const qualityOnly = Boolean(process.env.CAMERA_QUALITY_ONLY);
  const report = await page.evaluate(async ({ qualityOnly }) => {
    const { e, setup, getCV, getExamPage, loadExamFile, releaseUnusedSources, CameraClient, CameraProcessor, drawMat, releaseResultImages } = window.cameraFixture;
    const cv = await getCV(), reports = [];
    const check = (condition, message) => { if (!condition) throw Error(message); };
    const encode = async mat => { const canvas = document.createElement('canvas'); try { drawMat(cv,canvas,mat); return await new Promise(resolve => canvas.toBlob(resolve,'image/png')); } finally { canvas.width = canvas.height = 0; } };
    for (const name of (qualityOnly ? [] : ['IBSample', 'IGSample'])) {
      const { pages, params } = await setup(name);
      const lease = await getExamPage(pages[0]);
      const baseline = await e.processStudentScan(cv, lease.url, 'Camera test', 0, params);
      check(baseline.responses.length === Object.keys(params.key).length, 'flatbed baseline lost questions');
      const original = await e.renderScanMat(cv, lease.url); lease.release();
      for (const variant of name === 'IBSample' ? ['overhead','oblique','rotated','lighting'] : ['overhead','oblique']) {
        const width = 3500, height = 4800;
        let photo = new cv.Mat();
        const points = variant === 'overhead' ? [240,180,3260,180,3260,4620,240,4620] : [410,180,3180,420,3290,4510,180,4610];
        const source = cv.matFromArray(4,1,cv.CV_32FC2,[0,0,original.cols-1,0,original.cols-1,original.rows-1,0,original.rows-1]);
        const destination = cv.matFromArray(4,1,cv.CV_32FC2,points);
        const matrix = cv.getPerspectiveTransform(source,destination);
        cv.warpPerspective(original,photo,matrix,new cv.Size(width,height),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(45,55,65,255));
        source.delete(); destination.delete(); matrix.delete();
        if (variant === 'lighting') {
          const data = photo.data;
          for (let y=0; y<photo.rows; y++) for (let x=0; x<photo.cols; x++) {
            const offset=(y*photo.cols+x)*4, gain=.68+.28*x/photo.cols;
            for(let c=0;c<3;c++) data[offset+c]=Math.round(data[offset+c]*gain);
          }
        }
        if (variant === 'rotated') { const turned = new cv.Mat(); cv.rotate(photo,turned,cv.ROTATE_90_CLOCKWISE); photo.delete(); photo=turned; }
        const input = await encode(photo); photo.delete();
        const client = new CameraClient();
        try {
          let prepared = await client.request({type:'prepare',input},()=>{});
          check(!prepared.error, `${name}/${variant}: ${prepared.error}`);
          // Geometric orientation is automatic; semantic upside-down is resolved in preview.
          const blob = await client.request({type:'export',corners:prepared.corners,rotation:prepared.rotation},()=>{});
          const correctedPages = await loadExamFile(new File([blob],'camera.png',{type:'image/png'}));
          check(correctedPages[0].width===4800 && correctedPages[0].height===6840,'canonical dimensions');
          const correctedLease = await getExamPage(correctedPages[0]);
          const result = await e.processStudentScan(cv,correctedLease.url,'Camera test',0,params);
          correctedLease.release(); releaseUnusedSources(correctedPages,[]);
          check(result.responses.length === baseline.responses.length, `${name}/${variant}: lost questions (${result.responses.length}/${baseline.responses.length})`);
          check(result.score === baseline.score, `${name}/${variant}: score changed (${result.score}/${baseline.score})`);
          const changes=result.responses.flatMap((answer,i)=>answer===baseline.responses[i]?[]:[i+1]);
          reports.push({name,variant,changes,score:result.score,baseline:baseline.score});
          console.log('camera: '+JSON.stringify(reports.at(-1)));
          releaseResultImages([result]);
          check(changes.length===0,`${name}/${variant}: answers changed at ${changes}`);
        } finally { client.dispose(); }
      }
      original.delete(); releaseResultImages([baseline]); releaseUnusedSources(pages,[]);
    }
    const blank = new cv.Mat(2000,1600,cv.CV_8UC4,new cv.Scalar(240,240,240,255));
    const scanner = new CameraProcessor();
    try { const result = await scanner.prepare(await encode(blank)); check(Boolean(result.error),'blank page should require retry'); }
    finally { blank.delete(); scanner.dispose(); }
    for (const variant of ['low-resolution', 'blurred', 'clipped']) {
      const canvas = document.createElement('canvas');
      canvas.width = variant === 'low-resolution' ? 600 : 2400;
      canvas.height = variant === 'low-resolution' ? 850 : 3400;
      const context = canvas.getContext('2d');
      const k = canvas.width / 2400;
      context.scale(k,k); context.fillStyle = '#253540'; context.fillRect(0,0,2400,3400);
      context.fillStyle = 'white'; context.fillRect(variant === 'clipped' ? -150 : 200,200,2000,3000);
      context.lineWidth=6;
      for(let y=800;y<2900;y+=90)for(let x=400;x<1900;x+=150)context.strokeRect(x,y,100,65);
      let output=canvas;
      if(variant==='blurred') {
        output=document.createElement('canvas');output.width=2400;output.height=3400;
        const blurred=output.getContext('2d');blurred.filter='blur(25px)';blurred.drawImage(canvas,0,0);
      }
      const photo = await new Promise(resolve=>output.toBlob(resolve));
      canvas.width=canvas.height=output.width=output.height=0;
      const scanner = new CameraProcessor();
      try {
        const result = await scanner.prepare(photo);
        if(variant==='clipped') check(result.needsCorners,'clipped page should not select an internal printed rectangle');
        else {
          const checked = await scanner.preview([{x:200/2400,y:200/3400},{x:2200/2400,y:200/3400},{x:2200/2400,y:3200/3400},{x:200/2400,y:3200/3400}],0);
          check(Boolean(checked.error), `${variant}: should block weak capture`);
        }
        let rejected=false;
        try { await scanner.preview([{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],0); } catch { rejected=true; }
        check(rejected,'crossed corners must be rejected');
      } finally { scanner.dispose(); }
    }
    // JPEG EXIF orientation 6 must be applied by the browser decoder before detection.
    const orientedCanvas=document.createElement('canvas');orientedCanvas.width=2000;orientedCanvas.height=1400;
    const orientedContext=orientedCanvas.getContext('2d');orientedContext.fillStyle='white';orientedContext.fillRect(0,0,2000,1400);
    const jpeg=await new Promise(resolve=>orientedCanvas.toBlob(resolve,'image/jpeg'));
    orientedCanvas.width=orientedCanvas.height=0;
    const bytes=new Uint8Array(await jpeg.arrayBuffer());
    const exif=new Uint8Array([255,225,0,34,69,120,105,102,0,0,73,73,42,0,8,0,0,0,1,0,18,1,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
    const exifClient=new CameraClient();
    try {
      const prepared=await exifClient.request({type:'prepare',input:new Blob([bytes.slice(0,2),exif,bytes.slice(2)],{type:'image/jpeg'})},()=>{});
      check(prepared.height>prepared.width,'EXIF orientation was ignored');
    } finally { exifClient.dispose(); }
    console.log('camera: blank, clipped, low-resolution, blurry, crossed-corner and EXIF orientation checks passed');
    return reports;
  }, { qualityOnly });
  assert.equal(report.length,qualityOnly ? 0 : 6);
  console.log(qualityOnly ? 'Camera capture-quality checks passed.' : 'Camera correction and marking parity passed: ' + JSON.stringify(report));
} finally { await browser.close(); await server.close(); }
