/* SVG -> print-ready PDF, via headless Chrome.
   ────────────────────────────────────────────────────────────────
   Chrome's PDF export keeps vectors as vectors and embeds the fonts it used,
   which is what a printer needs. It is doing the same job Illustrator would;
   it just happens to be the renderer that is installed.

   Two details matter and are easy to get wrong:

   PAGE SIZE. The poster carries 3mm bleed, so the PDF page must be the FULL
   426x600mm, not A2. Chrome sizes the page from CSS @page, so the wrapper
   below states it explicitly in millimetres and sets every margin to zero.
   Ask Chrome for "A2" instead and it trims the bleed off and scales the art.

   NO SCALING. --no-pdf-header-footer plus margin:0 and a body sized exactly
   to the page stops Chrome shrinking the drawing to fit a printable area.

       node tools/svg-to-pdf.js <in.svg> <out.pdf> <width-mm> <height-mm>   */
var fs = require('fs'), path = require('path'), cp = require('child_process');

var inSvg = process.argv[2], outPdf = process.argv[3];
var wmm = parseFloat(process.argv[4]), hmm = parseFloat(process.argv[5]);
if (!inSvg || !outPdf || !wmm || !hmm) {
  console.error('usage: node tools/svg-to-pdf.js in.svg out.pdf widthMm heightMm');
  process.exit(1);
}

var CANDIDATES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
];
var browser = CANDIDATES.filter(fs.existsSync)[0];
if (!browser) { console.error('no Chrome or Edge found'); process.exit(1); }

/* The SVG goes in as a data URI inside a page sized exactly to the sheet, so
   there is no HTML layout between the artwork and the paper. */
if (!fs.existsSync(inSvg)) {
  console.error('cannot find ' + path.resolve(inSvg));
  console.error('(run this from the repo root, or give absolute paths)');
  process.exit(1);
}
var svg = fs.readFileSync(inSvg);
var wrapper =
'<!doctype html><html><head><meta charset="utf-8"><style>\n' +
'  @page { size: ' + wmm + 'mm ' + hmm + 'mm; margin: 0; }\n' +
'  html, body { margin: 0; padding: 0; background: none; }\n' +
'  img { display: block; width: ' + wmm + 'mm; height: ' + hmm + 'mm; }\n' +
'</style></head><body>\n' +
'<img src="data:image/svg+xml;base64,' + svg.toString('base64') + '">\n' +
'</body></html>\n';

var tmpHtml = path.resolve(path.dirname(outPdf), '.svg2pdf.tmp.html');
fs.writeFileSync(tmpHtml, wrapper);

var args = [
  '--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  '--run-all-compositor-stages-before-draw', '--virtual-time-budget=10000',
  '--print-to-pdf=' + path.resolve(outPdf),
  'file:///' + tmpHtml.replace(/\\/g, '/')
];

console.log('renderer: ' + path.basename(browser));
var r = cp.spawnSync(browser, args, { encoding: 'utf8', timeout: 120000 });
try { fs.unlinkSync(tmpHtml); } catch (e) {}

if (!fs.existsSync(outPdf)) {
  console.error('FAILED — no PDF written');
  console.error((r.stderr || '').split('\n').slice(0, 12).join('\n'));
  process.exit(1);
}
console.log('');
console.log('  wrote  ' + path.resolve(outPdf));
console.log('  size   ' + Math.round(fs.statSync(outPdf).size / 1024) + ' KB');
console.log('');
