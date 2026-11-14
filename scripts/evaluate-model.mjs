import fs from 'node:fs';
const fixtures = JSON.parse(fs.readFileSync('submission/evaluation/fixtures.json','utf8'));
const cases = [
 [0,'团队人数范围是多少？',['2-5']], [0,'演示视频格式是什么？',['MP4']], [0,'作品提交截止日期？',['2026','11','18']],
 [1,'最多多少人参加一队？',['4']], [1,'技术文档最多几页？',['25']], [1,'仓库包含什么说明？',['安装','开源']],
 [2,'团队至少多少人？',['2']], [2,'在线演示是否必交？',['可选']], [2,'普通本科可报名什么组？',['B组']],
 [3,'二等奖比例有什么冲突？',['20%','25%']], [4,'省赛一等奖比例是多少？',['10%']], [0,'火星矿物有哪些？',[]],
];
const records = []; let modelCalls = 0;
for (const mode of ['baseline','final']) for (let i=0;i<cases.length;i++) {
 const [fixture,question,expected] = cases[i]; const start=Date.now();
 const response=await fetch('http://127.0.0.1:3002/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({workspaceId:`eval-${mode}-${i}`,stage:'省赛',documents:fixtures[fixture].documents,profile:{education:'本科生',school:'普通本科',members:3},messageId:`eval-${i}`,messages:[{role:'user',content:question}],evaluationMode:mode}),signal:AbortSignal.timeout(65000)});
 const raw=await response.text(); let text=''; const events=[];
 for(const line of raw.split('\n')) { try {if(line.startsWith('0:'))text+=JSON.parse(line.slice(2));if(line.startsWith('2:'))events.push(...JSON.parse(line.slice(2)));}catch{} }
 const validation=events.find(e=>e.type==='validation'); const evidence=events.find(e=>e.type==='evidence')?.evidence??[];
 modelCalls+=validation?.calls??0;
 const result={mode,index:i+1,fixture:fixtures[fixture].name,question,expected,pass:expected.length?expected.every(s=>text.includes(s)): /未检索|证据不足/.test(text),citationValid:validation?.valid??null,returnedEvidence:evidence.length,elapsedMs:Date.now()-start,modelCalls:validation?.calls??0,promptTokens:validation?.promptTokens??0,completionTokens:validation?.completionTokens??0,answer:text,events};
 records.push(result);console.log(`${mode} ${i+1}/12 ${result.pass?'PASS':'REVIEW'} ${result.elapsedMs}ms`);
 fs.writeFileSync('submission/evaluation/model-evaluation.json',JSON.stringify({generatedAt:new Date().toISOString(),summary:'进行中，尚未冻结',modelCalls,records},null,2));
}
const summary=Object.fromEntries(['baseline','final'].map(mode=>{const items=records.filter(r=>r.mode===mode);return [mode,{questions:items.length,expectedFactCoverage:items.filter(r=>r.pass).length,verifiedGenerations:items.filter(r=>r.citationValid===true).length,fallbacks:items.filter(r=>r.citationValid===false).length,meanLatencyMs:Math.round(items.reduce((s,r)=>s+r.elapsedMs,0)/items.length)}];}));
const report={generatedAt:new Date().toISOString(),model:'deepseek-chat',modelCalls,summary:`旧检索与最终词法检索各12题，合计${modelCalls}次模型调用。事实覆盖按固定期望词检查，非用户试用或通用准确率。`,metrics:summary,records};
fs.writeFileSync('submission/evaluation/model-evaluation.json',JSON.stringify(report,null,2));console.log(report.summary);
if(modelCalls>24)throw new Error('超出本轮24次模型调用预算');
