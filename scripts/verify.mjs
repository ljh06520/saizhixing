import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
const checks = [['typecheck','node_modules/typescript/bin/tsc','--noEmit'],['chunk','scripts/check-chunk.mjs'],['legacy','scripts/check-competition.mjs'],['rules','scripts/check-release.mjs'],['api','scripts/check-chat.mjs'],['storage','scripts/check-storage.mjs'],['secrets','scripts/scan-secrets.mjs'],['assets','scripts/prepare-assets.mjs'],['production','node_modules/next/dist/bin/next','build']];
const results=[];
for(const [name,...args] of checks){const start=Date.now();const result=spawnSync(process.execPath,args,{encoding:'utf8',stdio:'pipe'});console.log(name,result.status===0?'PASS':'FAIL');if(result.status!==0)console.error(result.stdout,result.stderr);results.push({name,passed:result.status===0,elapsedMs:Date.now()-start});if(result.status!==0)break;}
const report={generatedAt:new Date().toISOString(),summary:`${results.filter(r=>r.passed).length}/${checks.length}组验收检查通过。规则/引用/隔离用例数量见verification.json；浏览器和模型检查单独归档。`,passed:results.every(r=>r.passed)&&results.length===checks.length,checks:results};
fs.mkdirSync('submission/evaluation',{recursive:true});fs.writeFileSync('submission/evaluation/acceptance.json',JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
