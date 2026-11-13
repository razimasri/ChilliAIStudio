import { PDFDocument, StandardFonts, rgb, PDFPage } from 'pdf-lib';
import type { PdfReport } from './exportPdf';

self.onmessage = async ({ data: report }: MessageEvent<PdfReport>) => {
  try {
    const pdf = await PDFDocument.create();
    pdf.setTitle('ChilliMark Annotated Work and Class Report');
    pdf.setCreator('ChilliMark Birdseye 2.3');
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const logoResponse = await fetch('/icons/printmark.png');
    const logo = logoResponse.ok ? await pdf.embedPng(await logoResponse.arrayBuffer()) : undefined;
    const burgundy = rgb(.55, .08, .16), green = rgb(0, .4, .2), red = rgb(.7, .1, .1);
    for (const [index, student] of report.students.entries()) {
      const response = await fetch(student.annotatedDataUrl);
      if (!response.ok) throw new Error(`Could not read marked sheet for ${student.name}`);
      const image = await pdf.embedPng(await response.arrayBuffer());
      const [width, height] = image.width > image.height ? [841.89, 595.28] : [595.28, 841.89];
      const page = pdf.addPage([width, height]);
      const size = image.scale(Math.min(width / image.width, height / image.height));
      page.drawImage(image, { x: (width-size.width)/2, y: (height-size.height)/2, ...size });
      // Release decoded RGB/alpha buffers before opening the next high-resolution sheet.
      await pdf.flush();
      self.postMessage({ percent: Math.round((index + 1) / Math.max(1, report.students.length) * 85) });
    }
    let page: PDFPage, y = 0, title = '';
    const newPage = (heading: string) => {
      title = heading; page = pdf.addPage([595.28, 841.89]); y = 775;
      if (logo) page.drawImage(logo, {x:36,y:796,...logo.scaleToFit(28,28)});
      page.drawText('ChilliMark | ' + heading, { x: 74, y: 805, size: 15, font: bold, color: burgundy });
      page.drawText('Birdseye 2.3 | Final marking results', { x: 36, y: 22, size: 8, font });
      page.drawText(String(pdf.getPageCount()), { x: 540, y: 22, size: 8, font });
    };
    // Canvas fallback preserves names outside the standard PDF font's character set.
    const text = async (value: string, x: number, baseline: number, size = 10, color = rgb(.1,.1,.1), strong = false) => {
      const chosen = strong ? bold : font;
      try { chosen.encodeText(value); page.drawText(value, { x, y: baseline, size, font: chosen, color }); }
      catch {
        const canvas = new OffscreenCanvas(1600, 64), context = canvas.getContext('2d')!;
        context.font = `${size * 3}px sans-serif`; context.fillStyle = `rgb(${color.red*255},${color.green*255},${color.blue*255})`;
        context.fillText(value, 0, size*3);
        const image = await pdf.embedPng(await (await canvas.convertToBlob({type:'image/png'})).arrayBuffer());
        page.drawImage(image, {x, y:baseline-size/3, width:1600/3, height:64/3});
        await pdf.flush();
      }
    };
    const line = async (value: string, strong = false) => {
      // Short wrapped lines keep long names, answer keys, and large cohorts printable.
      const words: string[] = []; let current = '';
      for (const character of value.replace(/\s+/g,' ')) {
        const candidate = current + character;
        let width: number;
        try { width = (strong ? bold : font).widthOfTextAtSize(candidate, 10); }
        catch { width = Array.from(candidate).reduce((sum,c)=>sum+(c.charCodeAt(0)>255?10:6),0); }
        if (width > 515 && current) { words.push(current); current = character; }
        else current = candidate;
      }
      if(current) words.push(current);
      for (const part of words) {
        if (y < 48) newPage(title);
        await text(part.trim(), 36, y, 10, undefined, strong); y -= 17;
      }
    };
    const students = report.students, count = students.length;
    newPage('Class Summary');
    const scores = students.map(s=>s.score).sort((a,b)=>a-b);
    const mean = count ? scores.reduce((a,b)=>a+b,0)/count : 0;
    const median = count ? (scores[Math.floor((count-1)/2)]+scores[Math.floor(count/2)])/2 : 0;
    await line(`Candidates: ${count} | Questions with keys: ${Object.keys(report.answerKey).length}`, true);
    await line(`Mean score: ${mean.toFixed(1)} | Median: ${median} | Lowest: ${scores[0] ?? 0} | Highest: ${scores[scores.length-1] ?? 0}`);
    await line(`Mean percentage: ${(count ? students.reduce((sum,s)=>sum+s.percentage,0)/count : 0).toFixed(1)}% | At least 50%: ${students.filter(s=>s.percentage>=50).length}/${count}`);
    await line('Score distribution (percentage bands)', true);
    for(let start=0;start<100;start+=10) await line(`${start}-${start===90?100:start+9}%: ${students.filter(s=>s.percentage>=start&&(start===90?s.percentage<=100:s.percentage<start+10)).length}`);
    const difficulty = [...report.stats].filter(s=>/^[A-Z]$/.test(s.correctAnswer)).sort((a,b)=>a.correctPercent-b.correctPercent);
    if(difficulty.length) {
      await line('Lowest accuracy: ' + difficulty.slice(0,5).map(s=>`Q${s.questionNumber} (${s.correctPercent}%)`).join(', '));
      await line('Highest accuracy: ' + difficulty.slice(-5).reverse().map(s=>`Q${s.questionNumber} (${s.correctPercent}%)`).join(', '));
    }
    await line('Student scores and incorrect / blank / unclear questions', true);
    for(const [i,s] of students.entries()) {
      const missed=Object.entries(report.answerKey).filter(([q,key])=>s.responses[Number(q)]!==key).map(([q])=>Number(q)+1);
      await line(`${i+1}. ${s.name} | ${s.score}/${s.total} (${s.percentage}%) | ${missed.length?missed.join(', '):'All correct'}`);
    }
    newPage('Question Analysis');
    await line('Counts include every candidate. Blank and unclear answers earn no marks.');
    await line('Correct percentage is based on the entire class, including blanks.');
    for(const stat of report.stats) {
      if(y < 110) newPage('Question Analysis');
      await line(`Q${stat.questionNumber} | Key: ${stat.correctAnswer || '-'} | Correct: ${stat.correctCount}/${count} (${stat.correctPercent}%) | Answered: ${stat.totalAnswered}`,true);
      await line(Object.entries(stat.distribution).map(([choice,n])=>`${choice}: ${n} (${stat.percentages[choice] ?? 0}%)`).join(' | '));
    }
    // Eight candidates per panel; repeat column headers whenever a panel spans pages.
    for(let start=0;start<count;start+=8) {
      const group=students.slice(start,start+8);
      const header=async()=>{
        newPage('Answer Comparison');
        await line('Green: matches key | Red: differs | -: blank | ?: unclear');
        for(const [i,s] of group.entries()) await line(`S${start+i+1}: ${s.name} | ${s.score}/${s.total} (${s.percentage}%)`);
        await text('Q / Key',36,y,10,burgundy,true);
        for(let i=0;i<group.length;i++) await text(`S${start+i+1}`,130+i*53,y,10,burgundy,true);
        y-=22;
      };
      await header();
      for(const stat of report.stats) {
        if(y<55) await header();
        await text(`${stat.questionNumber} / ${stat.correctAnswer || '-'}`,36,y);
        for(const [i,s] of group.entries()) {
          const answer=s.responses[stat.questionNumber-1];
          const shown=answer===false||answer==='Unclear'?'?':!answer||answer==='Blank'?'-':answer;
          await text(shown,130+i*53,y,10,answer===stat.correctAnswer?green:red);
        }
        y-=19;
      }
    }
    self.postMessage({percent:95});
    const bytes = await pdf.save();
    self.postMessage({ blob: new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }) });
  } catch(error) { self.postMessage({error: error instanceof Error ? error.message : 'Could not create PDF.'}); }
};
