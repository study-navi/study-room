/* Opt-in staging-only integration test. Writes fictional fixtures; never deletes records.
 * Browser CORS/PWA acceptance is separate: live-http.cjs. This test uses TLS-verified curl.
 */
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const endpoint='https://script.google.com/macros/s/AKfycbx6Qaaei0Fbh1_agSFSGG1_zywyiGWtetXYuCI-6iHri0LDc2rxTg3C5exK0RLdsQKq/exec';
if(process.env.SR_LIVE_STAGING!=='approved')throw new Error('Staging fictional fixture creation requires explicit approval.');
let count=0;
async function call(action,data={},requestId=crypto.randomUUID()){
 count++;const q={action,data,requestId};
 const raw=await new Promise((resolve,reject)=>{const p=spawn('curl',['--max-time','90','--silent','--show-error','--location','--dump-header','-','--header','Content-Type: text/plain;charset=UTF-8','--header','Origin: https://study-navi.github.io','--data-binary','@-',endpoint]);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(new Error('curl failed: '+err)):resolve(out));p.stdin.end(JSON.stringify(q));});
 const split=raw.lastIndexOf('\r\n\r\n'),headers=raw.slice(0,split),body=raw.slice(split+4);assert.match(headers,/HTTP\/[\d.]+ 200/);assert.match(headers,/access-control-allow-origin:\s*\*/i);return JSON.parse(body);
}
const good=r=>{assert.equal(r.result,'success',(r.code||'unexpected response')+': '+(r.message||''));return r;};
(async()=>{
 const schools=good(await call('schools')).schools;assert.deepEqual(schools.map(s=>s.name),['大府柊山校','共和校','森本校','尾西校']);console.log('PASS live anonymous POST: four schools; CORS response header present.');
 for(const action of ['list','listActive','dashboard','students'])assert.equal((await call(action)).code,'AUTH');console.log('PASS live unauthenticated administrator operations denied.');
 const checkpoint=path.resolve(__dirname,'../release/live-api.private.json');fs.mkdirSync(path.dirname(checkpoint),{recursive:true});
 let state;if(fs.existsSync(checkpoint))state=JSON.parse(fs.readFileSync(checkpoint,'utf8'));else{state={stamp:Date.now(),fixtures:['森本校','尾西校'].map(name=>({name,s:{schoolId:schools.find(s=>s.name===name).id,studentId:crypto.randomUUID(),studentKey:crypto.randomBytes(32).toString('hex')},id:crypto.randomUUID(),requestId:crypto.randomUUID(),updateId:crypto.randomUUID()}))};fs.writeFileSync(checkpoint,JSON.stringify(state),{mode:0o600});}
 const stamp=state.stamp,students=[];
 for(const name of ['森本校','尾西校']){
  const {s,id,requestId,updateId}=state.fixtures.find(f=>f.name===name);students.push(s);
  good(await call('registerStudent',{...s,name:'POST分離検証（架空）',grade:'中1'}));
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date());
  const record={...s,id,startTime:time};good(await call('addActive',record,requestId));good(await call('addActive',record,requestId));
  let history=good(await call('history',s));assert.equal(history.records.length,1);
  good(await call('update',{...s,id,minutes:0,endTime:time,subject:'数学',content:`実POST検証 ${name} ${stamp}（架空）`,comment:'本番データではありません。教室間分離の確認。',focus:3,achievement:3},updateId));
  history=good(await call('history',s));assert.equal(history.records.length,1);assert.equal(history.records[0]['状態'],'送信済み');assert.ok(history.records[0]['学習内容'].includes(name));console.log('PASS live:',name,'register / check-in replay / reflection / own history.');
 }
 const [a,b]=students;
 assert.equal((await call('history',{...a,studentKey:b.studentKey})).code,'FORBIDDEN');
 assert.equal((await call('history',{...a,schoolId:b.schoolId})).code,'FORBIDDEN');
 assert.equal((await call('update',{...b,id:good(await call('history',a)).records[0]['ID'],content:'unauthorized'})).code,'FORBIDDEN');
 console.log('PASS live wrong-key / cross-school history and cross-student mutation denied. Calls:',count);
})().catch(e=>{console.error(e.message);process.exitCode=1;});
