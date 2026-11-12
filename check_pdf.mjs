import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'fs';

async function checkPdf() {
  const data = new Uint8Array(fs.readFileSync('public/samples/IBSample.pdf'));
  const doc = await getDocument({ data }).promise;
  console.log('Pages:', doc.numPages);
  const p1 = await doc.getPage(1);
  const ops = await p1.getOperatorList();
  console.log('Total ops on page 1:', ops.fnArray.length);
  const fnCounts = {};
  for (const fn of ops.fnArray) {
    fnCounts[fn] = (fnCounts[fn] || 0) + 1;
  }
  console.log('fnCounts:', fnCounts);
  for (let i = 0; i < ops.argsArray.length; i++) {
    const args = ops.argsArray[i];
    if (args && args.length > 0) {
      const s = JSON.stringify(args);
      if (s.includes('paint') || s.includes('Image') || s.includes('img') || s.includes('g_')) {
        console.log(`Op ${i}: fn=${ops.fnArray[i]} args=`, args);
      }
    }
  }
}

checkPdf().catch(console.error);
