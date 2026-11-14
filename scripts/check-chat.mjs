import assert from 'node:assert/strict';
import { makeLoader } from './ts-loader.mjs';
let calls = 0; let behavior='normal'; let unblock;
const load = makeLoader({
 '@ai-sdk/deepseek': { createDeepSeek: () => () => 'test-model' },
 'ai': {
   tool: x=>x,
   createDataStreamResponse: ({execute})=>new Response(new ReadableStream({async start(c){try{await execute({write:s=>c.enqueue(new TextEncoder().encode(s)),writeData:d=>c.enqueue(new TextEncoder().encode('2:'+JSON.stringify([d])+'\n'))});}finally{c.close();}}})),
   generateText: async options=>{calls++;if(behavior==='throw'||options.abortSignal.aborted)throw new Error('模拟模型或工具中断');if(behavior==='wait')await new Promise(resolve=>{unblock=resolve;});const prompt=JSON.parse(options.prompt);await options.tools.search_sources.execute({query:prompt.question}); options.onStepFinish();return {text:behavior==='invalid'?'不受支持的模型结论':JSON.stringify({facts:[{citation:prompt.initialEvidence[0].id,quote:'演示视频：MP4格式，时长5-8分钟。'}]}),usage:{promptTokens:10,completionTokens:10}};}
 }
});
const {POST}=load('app/api/chat/route.ts');
const body={workspaceId:'test-chat',messageId:'message-1',messages:[{role:'user',content:'演示视频要求'}],stage:'省赛',profile:{education:'本科生',school:'普通本科',members:3},documents:[{id:'test',name:'测试通知',text:'演示视频：MP4格式，时长5-8分钟。',stage:'省赛',createdAt:0,metadataConfirmed:true}]};
const send=value=>POST(new Request('http://test/api/chat',{method:'POST',body:JSON.stringify(value)}));
const old=process.env.DEEPSEEK_API_KEY;
try{
 delete process.env.DEEPSEEK_API_KEY;
 let response=await send(body); assert.equal(response.status,200); assert.match(await response.text(),/原文检索模式/);
 response=await send({...body,workspaceId:'test-empty',messages:[{role:'user',content:'火星矿物'}]});assert.match(await response.text(),/未检索到/);
 assert.equal((await send(null)).status,400);
 assert.equal((await send({...body,profile:{...body.profile,members:999}})).status,400);
 assert.equal((await send({...body,documents:[{...body.documents[0],version:'forged'}]})).status,400);
 assert.equal((await send({...body,messageId:undefined})).status,400);
 assert.equal((await send({...body,messages:[{role:'user',content:'x'.repeat(2001)}]})).status,400);
 assert.equal((await POST(new Request('http://test/api/chat',{method:'POST',body:'{broken'}))).status,400);
 assert.equal((await POST(new Request('http://test/api/chat',{method:'POST',body:'x'.repeat(1200001)}))).status,400);
 assert.equal(calls,0);
 process.env.DEEPSEEK_API_KEY='mock-placeholder';
 response=await send({...body,workspaceId:'test-model'}); const text=await response.text(); assert.match(text,/原文事实/);assert.match(text,/search_sources/);assert.match(text,/validation/);assert.equal(calls,1);
 behavior='throw';response=await send({...body,workspaceId:'test-failure'});assert.match(await response.text(),/暂不可用/);
 behavior='invalid';response=await send({...body,workspaceId:'test-invalid'});assert.match(await response.text(),/未通过校验/);
 const aborted=new AbortController();aborted.abort();response=await POST(new Request('http://test/api/chat',{method:'POST',signal:aborted.signal,body:JSON.stringify({...body,workspaceId:'test-abort'})}));assert.match(await response.text(),/暂不可用/);
 behavior='wait';const first=await send({...body,workspaceId:'test-concurrent'});assert.equal((await send({...body,workspaceId:'test-concurrent'})).status,429);unblock();await first.text();
 console.log('PASS: 无密钥/无证据、伪造快照、消息ID、画像、请求长度、工具合同、模型中断、引用失败回退、取消、并发限制（mock模型）。');
}finally{if(old===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=old;}
