import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const patterns=[/sk-[A-Za-z0-9]{20,}/g,/(?:DEEPSEEK_API_KEY|OPENAI_API_KEY)\s*[:=]\s*['"]?[A-Za-z0-9_-]{20,}/g];
const skip=new Set(['node_modules','.next','.git','tmp','.pnpm-store']);const hits=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(skip.has(entry.name)||entry.name==='.env.local')continue;const p=path.join(dir,entry.name);if(entry.isDirectory())walk(p);else if(/\.(?:tsx?|mjs|json|md|txt|py|example|ya?ml|ps1)$/.test(entry.name)){const content=fs.readFileSync(p,'utf8');if(patterns.some(p=>{p.lastIndex=0;return p.test(content);}))hits.push({file:p});}}}walk('.');
let historyScanned=0;try{const revisions=execFileSync('git',['rev-list','--all'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);for(const revision of revisions){historyScanned++;try{const output=execFileSync('git',['grep','-I','-l','-E','sk-[A-Za-z0-9]{20,}',revision],{encoding:'utf8',stdio:['ignore','pipe','ignore']});if(output.trim())hits.push({revision,files:output.trim().split('\n')});}catch(e){if(e.status!==1)throw e;}}}catch{hits.push({error:'历史扫描未完成'});}
fs.mkdirSync('submission/evaluation',{recursive:true});const report={generatedAt:new Date().toISOString(),historyScanned,passed:hits.length===0,summary:`代码及${historyScanned}个历史版本的密钥模式扫描：${hits.length?'发现需复核项':'未发现匹配'}。扫描不输出真实密钥，不代表所有敏感信息都被识别。`,hits};fs.writeFileSync('submission/evaluation/secret-scan.json',JSON.stringify(report,null,2));console.log(report.summary);if(hits.length)process.exitCode=1;
