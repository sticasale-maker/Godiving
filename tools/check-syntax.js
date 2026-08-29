/* Syntax-check every inline <script> in the app's pages.
   These are single-file pages with one very large inline script, so a stray
   quote does not fail loudly — the whole block silently refuses to parse and
   the page loads looking almost normal until something is clicked. Cheap to
   run, and it catches that before a browser does:
       node tools/check-syntax.js                                          */
var fs=require('fs'), vm=require('vm');
var files=process.argv.slice(2);
if(!files.length)files=['arcade.html','ticket.html','rank.html','attract.html','simulator.html'];
var failed=0;
files.forEach(function(f){
  if(!fs.existsSync(f))return;
  var s=fs.readFileSync(f,'utf8'),
      re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, m, i=0, bad=0;
  while((m=re.exec(s))){
    i++;
    var line=s.slice(0,m.index).split('\n').length;
    try{ new vm.Script(m[1],{filename:f}); }
    catch(e){ bad++;failed++;console.log('  x '+f+' block #'+i+' (from line '+line+'): '+e.message); }
  }
  console.log((bad?'FAIL ':'ok   ')+f+'  ('+i+' inline block'+(i===1?'':'s')+')');
});
/* prize.js is a real module, so it can just be required */
try{ require(require('path').resolve('prize.js')); console.log('ok   prize.js'); }
catch(e){ failed++; console.log('  x prize.js: '+e.message); }
process.exit(failed?1:0);
