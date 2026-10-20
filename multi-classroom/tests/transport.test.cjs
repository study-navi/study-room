const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {createHarness}=require('./harness.cjs');
const endpoint='https://script.google.com/macros/s/staging-only/exec';
function transport(){const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout});vm.runInContext(fs.readFileSync(path.join(__dirname,'../Transport.js'),'utf8')+';this.transport=SRTransport;',c);return c.transport;}
test('POST sends credentials in the body only and requires readable successful JSON',async()=>{
  const t=transport(),q={action:'teacherLogin',data:{teacherId:'fixture',teacherPass:'fixture-password'},requestId:'stable-op'};let sent;
  const result=await t.send(q,{endpoint,fetchImpl:async(url,options)=>{sent={url,options};return {ok:true,type:'cors',json:async()=>({result:'success'})};}});
  assert.equal(result.result,'success');assert.equal(sent.url,endpoint);assert.equal(sent.options.method,'POST');assert.equal(sent.options.mode,'cors');assert.equal(sent.options.credentials,'omit');assert.equal(sent.options.cache,'no-store');assert.equal(sent.options.redirect,'follow');assert.equal(sent.options.referrerPolicy,'no-referrer');assert.match(sent.options.headers['Content-Type'],/^text\/plain/);assert.deepEqual(JSON.parse(sent.options.body),q);assert.ok(!sent.url.includes('fixture'));
  for(const response of [{ok:false,type:'cors'},{ok:true,type:'opaque'},{ok:true,type:'cors',json:async()=>{throw new Error('HTML');}},{ok:true,type:'cors',json:async()=>({})}])await assert.rejects(()=>t.send(q,{endpoint,fetchImpl:async()=>response}));
});
test('transport refuses altered destinations and cannot silently fall back to JSONP or no-cors',async()=>{
  const t=transport();for(const url of ['http://script.google.com/macros/s/test/exec','https://example.com/macros/s/test/exec',endpoint+'?token=secret',endpoint+'#fragment','https://name:pass@script.google.com/macros/s/test/exec',endpoint+'/more'])await assert.rejects(()=>t.send({},{endpoint:url,fetchImpl:()=>{throw new Error('must not send');}}));
  await assert.rejects(()=>t.send({},{}),/接続先/);
  await assert.rejects(()=>t.send({},{endpoint,timeoutMs:5,fetchImpl:(_,o)=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Object.assign(new Error('abort'),{name:'AbortError'}))))}),/タイムアウト/);
});
test('existing GAS RPC remains supported without HTTP access',async()=>{
  const t=transport();let success;const rpc={withSuccessHandler(f){success=f;return this;},withFailureHandler(){return this;},srApi(q){assert.equal(q.action,'schools');success({result:'success',schools:[]});}};
  assert.equal((await t.send({action:'schools'},{rpc})).result,'success');
});
test('HTTP entry point is disabled by default and applies the same authorization and replay rules',()=>{
  const h=createHarness();h.c.ContentService={MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})};
  const post=(q,extras={})=>JSON.parse(h.c.doPost({queryString:null,postData:{type:'text/plain;charset=UTF-8',contents:JSON.stringify(q)},...extras}).text);
  assert.equal(post({action:'schools',data:{}}).code,'SETUP');h.props.set('SR_HTTP_ENABLED','approved');
  assert.equal(post({action:'schools',data:{}}).schools.length,2);
  assert.equal(post({action:'list',data:{}}).code,'AUTH');
  const logged=post({action:'teacherLogin',data:{teacherId:'school-admin',teacherPass:'test-password-456'}});assert.equal(logged.result,'success');
  assert.equal(post({action:'list',data:{session:logged.session,schoolId:'school-b'}}).code,'FORBIDDEN');
  assert.equal(post({action:'saveSchool',data:{session:logged.session,school:{id:'bad-school',name:'bad',code:'bad'}}}).code,'FORBIDDEN');
  for(const e of [{queryString:'token=do-not-use'},{postData:{type:'application/json',contents:'{}'}},{postData:{type:'text/plain',contents:'null'}},{postData:{type:'text/plain',contents:'['}},{postData:{type:'text/plain',contents:'x'.repeat(30001)}}])assert.equal(post({action:'schools',data:{}},e).result,'error');
  const student={schoolId:'school-a',studentId:'http-student',studentKey:'a'.repeat(64),name:'架空',grade:'中1'};
  assert.equal(post({action:'registerStudent',data:student}).result,'success');const q={action:'addActive',requestId:'http-operation',data:{...student,id:'http-record',startTime:'16:00',subject:'英語',content:'検証'}};
  assert.equal(post(q).result,'success');assert.equal(post(q).result,'success');assert.equal(h.all('Records').length,1);
});
