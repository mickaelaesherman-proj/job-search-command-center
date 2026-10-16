// Run from the repository root: node tests/alias_test.js
const fs=require('fs'),vm=require('vm'),path=require('path');
const code=fs.readFileSync(path.join(__dirname,'..','apps-script','JobSearch_Automation.gs'),'utf8');
const sheetWith=(hdrs)=>({getLastColumn:()=>hdrs.length,getRange:()=>({getValues:()=>[hdrs]})});
const ctx=vm.createContext({console,Object,String,Error});
vm.runInContext(code,ctx);
let ok=true; const t=(n,c)=>{ok=ok&&c;console.log((c?'PASS':'FAIL')+'  '+n)};
const run=(expr)=>vm.runInContext(expr,ctx);
ctx.__old=sheetWith(['Company','Fit Score (1-5)','Fit Rationale','Recommendation']);
ctx.__new=sheetWith(['Company','Rules-compliance Score (1-5)','Fit Rationale','Recommendation']);
ctx.__both=sheetWith(['Company','Rules-compliance Score (1-5)','Rules-compliance Rationale']);
t('old header: old name found', run('need_(headerMap_(__old,1),"Fit Score (1-5)")')===2);
t('old header: new name also resolves', run('need_(headerMap_(__old,1),"Rules-compliance Score (1-5)")')===2);
t('renamed score header: script still finds "Fit Score (1-5)"', run('need_(headerMap_(__new,1),"Fit Score (1-5)")')===2);
t('renamed score header: rationale untouched', run('need_(headerMap_(__new,1),"Fit Rationale")')===3);
t('both renamed: old names still resolve', run('need_(headerMap_(__both,1),"Fit Score (1-5)")')===2 && run('need_(headerMap_(__both,1),"Fit Rationale")')===3);
let threw=false; try{ run('need_(headerMap_(__old,1),"Some Other Column")'); }catch(e){ threw=/Column not found/.test(e.message); }
t('a genuinely missing column still errors loudly', threw);
console.log(ok?'ALL PASS':'FAILURES'); process.exit(ok?0:1);
