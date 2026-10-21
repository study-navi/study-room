import {test} from 'node:test';
import assert from 'node:assert/strict';
import {GoogleWorkspace} from '../google-workspace.mjs';

const job={id:'22222222-2222-4222-8222-222222222222',requestId:'11111111-1111-4111-8111-111111111111',name:'森本校',fileId:'test_file',createdAt:'2026-10-21T00:00:00Z'};
function fake(responses){const calls=[];const workspace=new GoogleWorkspace('test-access-token',{fetchImpl:async(url,options)=>{calls.push({url,options});const data=responses.shift();if(data instanceof Error)throw data;return new Response(JSON.stringify(data),{status:data?.status||200,headers:{'Content-Type':'application/json'}});}});return {workspace,calls};}
test('creates a private file without changing any permissions or exposing bearer token in the URL',async()=>{
  const f=fake([{id:'file'}]);await f.workspace.createSpreadsheet(job);assert.equal(f.calls.length,1);
  const {url,options}=f.calls[0];assert.ok(url.startsWith('https://www.googleapis.com/drive/v3/files?'));assert.equal(url.includes('test-access-token'),false);assert.equal(options.headers.Authorization,'Bearer test-access-token');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.equal(body.mimeType,'application/vnd.google-apps.spreadsheet');assert.equal(body.appProperties.srClassroomId,job.id);assert.equal(body.permissions,undefined);assert.equal(body.parents,undefined);
});
test('sets headers only on newly added tabs and uses RAW for the teacher-entered classroom name',async()=>{
  const f=fake([{sheets:[{properties:{sheetId:0,title:'シート1'}}]},{},{},{}]);await f.workspace.initializeSpreadsheet({...job,name:'=IMPORTXML("private")'});
  const batch=JSON.parse(f.calls[1].options.body);assert.equal(batch.requests.filter(r=>r.addSheet).length,5);assert.equal(batch.requests.some(r=>r.deleteSheet||r.clearValues),false);
  assert.match(f.calls[3].url,/valueInputOption=RAW/);const values=JSON.parse(f.calls[3].options.body).values;assert.equal(JSON.parse(values[0][1]).name,'=IMPORTXML("private")');
});
test('refuses an existing schema mismatch without changing or clearing cells',async()=>{
  const f=fake([{sheets:[{properties:{sheetId:1,title:'SR10_Schools'}}]},{values:[['wrong','columns']]}]);await assert.rejects(f.workspace.initializeSpreadsheet(job),{code:'SCHEMA'});assert.equal(f.calls.every(c=>c.options.method==='GET'),true);
});
test('does not replace another classroom seed',async()=>{
  const existing=Array.from(['Schools','Students','Admins','Records','Sessions'],(name,i)=>({properties:{sheetId:i,title:'SR10_'+name}}));
  const f=fake([{sheets:existing},...Array.from({length:5},()=>({values:[['id','json']]})),{values:[['other',JSON.stringify({id:'other',name:'尾西校'})]]}]);
  await assert.rejects(f.workspace.initializeSpreadsheet(job),{code:'SCHEMA'});assert.equal(f.calls.every(c=>c.options.method==='GET'),true);
});
test('Google errors and network exceptions are redacted and revocation asks for reconnection',async()=>{
  for(const [reply,code] of [[{status:401,error:{message:'secret-token'}},'REAUTHORIZE'],[{status:403},'PERMISSION'],[{status:429},'RATE'],[Error('secret-token'),'GOOGLE_UNAVAILABLE']]){
    const f=fake([reply]);await assert.rejects(f.workspace.identity(),e=>e.code===code&&!e.message.includes('secret-token'));
  }
});
test('batch reads preserve physical row numbers and reject corrupt or duplicate identities',async()=>{
  const ranges=Array.from({length:5},()=>({values:[['id','json']]}));ranges[0].values.push([],['class',JSON.stringify({id:'class',name:'森本校'})]);
  const f=fake([{valueRanges:ranges}]),tables=await f.workspace.readTables('file');assert.equal(tables.Schools[0].row,3);assert.equal(new URL(f.calls[0].url).searchParams.getAll('ranges').length,5);
  const bad=structuredClone(ranges);bad[0].values.push(['class',JSON.stringify({id:'class'})]);await assert.rejects(fake([{valueRanges:bad}]).workspace.readTables('file'),{code:'SCHEMA'});
});
test('batch writes are RAW and backups cannot masquerade as the original registration',async()=>{
  const f=fake([{},{}]);await f.workspace.writeCells('file',[{range:"'SR10_Records'!A2:B2",values:[['id','{"id":"id"}']]}]);assert.equal(JSON.parse(f.calls[0].options.body).valueInputOption,'RAW');
  await f.workspace.backup('file','バックアップ','2026-10-21');const props=JSON.parse(f.calls[1].options.body).appProperties;assert.equal(props.srClassroomId,'backup');assert.equal(props.srRegistrationId,'backup');assert.equal(props.srBackupFor,'file');assert.equal(props.srBackupTag,'2026-10-21');
});
