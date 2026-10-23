import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {StudyService} from '../study-service.mjs';

test('student full lifecycle, identity-based privacy, teacher isolation and CSV-compatible results',async t=>{
  const f=await fixture();t.after(()=>f.close());const service=new StudyService(f),studentId=randomUUID(),studentKey='a'.repeat(64);
  const call=(action,data={},session)=>service.run(f.a,{action,data:{schoolId:f.a,studentId,studentKey,...data},requestId:randomUUID()},session);
  await call('registerStudent',{name:'架空テスト生徒',grade:'中3'});
  const id=randomUUID();await call('addActive',{id,startTime:'09:00',content:'入室中',subject:'英語',startedAt:new Date(Date.now()-3600000).toISOString()});
  const checkout=await call('checkout',{id});assert.equal(checkout.minutes,60);
  await call('update',{id,date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo'}).format(new Date()),name:'架空テスト生徒',grade:'中3',startTime:'09:00',endTime:'10:00',minutes:45,subject:'数学',content:'方程式',comment:'見直せた',focus:4,achievement:5});
  const history=await call('history');assert.equal(history.records.length,1);assert.equal(history.records[0]['自習分数'],45);assert.equal(history.records[0]['コメント'],'見直せた');
  await assert.rejects(call('history',{studentKey:'b'.repeat(64)}),{code:'FORBIDDEN'});
  await assert.rejects(call('history',{schoolId:f.b}),{code:'FORBIDDEN'});
  await assert.rejects(call('list',{session:'forged'},f.auth.session('bob-session')),{code:'FORBIDDEN'});
  await assert.rejects(call('delete',{id}),{code:'FORBIDDEN'});
  const owner=f.auth.session('alice-session'),list=await call('list',{session:'cookie'},owner);assert.equal(list.records.length,1);assert.equal(list.records[0]['生徒ID'],studentId);
  const dashboard=await call('dashboard',{session:'cookie',from:'2020-01-01',to:'2030-01-01'},owner);assert.equal(dashboard.dashboard.users,1);assert.equal(dashboard.dashboard.utilization,1.25);
  const duplicateId=randomUUID();await call('registerStudent',{studentId:duplicateId,studentKey:'c'.repeat(64),name:'架空テスト生徒',grade:'中1'});
  assert.equal((await call('history',{studentId:duplicateId,studentKey:'c'.repeat(64)})).records.length,0);
  assert.equal(f.state.backups,1);assert.equal(f.files.get('file-'+f.b).tables.Records.length,0);
});

test('lost Google write response is replayed to the same rows before retry, no duplicate student/record',async t=>{
  const f=await fixture();t.after(()=>f.close());const s=new StudyService(f),studentId=randomUUID(),studentKey='f'.repeat(64),data={schoolId:f.a,studentId,studentKey,name:'架空再送',grade:'中2'};
  f.state.loseResponse=true;const q={action:'registerStudent',data,requestId:randomUUID()};await assert.rejects(s.run(f.a,q));await s.run(f.a,q);
  const id=randomUUID(),record={action:'addActive',data:{...data,id,startTime:'10:00',subject:'理科',content:'入室中'},requestId:randomUUID()};f.state.loseResponse=true;await assert.rejects(s.run(f.a,record));await s.run(f.a,record);
  const file=f.files.get('file-'+f.a);assert.equal(file.tables.Students.length,1);assert.equal(file.tables.Records.length,1);assert.equal(file.tables.Records[0].value.id,id);
});

test('revoked Google grant, unexpected school rows and forged admin actions fail closed',async t=>{
  const f=await fixture();t.after(()=>f.close());const s=new StudyService(f),q={action:'schools',data:{},requestId:randomUUID()};f.state.revoked.add('alice');await assert.rejects(s.run(f.a,q),{code:'REAUTHORIZE'});f.state.revoked.clear();
  f.files.get('file-'+f.a).tables.Schools.push({row:3,value:{id:f.b,name:'混在'}});await assert.rejects(s.run(f.a,q),{code:'SCHEMA'});
  await assert.rejects(s.run(f.a,{action:'saveAdmin',data:{session:'cookie'}},f.auth.session('alice-session')),{code:'FORBIDDEN'});assert.equal(f.state.writes,0);
});

test('uncertain uncommitted writes wait for the Google processing window and refuse external edits',async t=>{
  const f=await fixture();t.after(()=>f.close());const s=new StudyService(f),id=randomUUID(),q={action:'registerStudent',requestId:randomUUID(),data:{schoolId:f.a,studentId:id,studentKey:'d'.repeat(64),name:'架空待機',grade:'中1'}};
  f.state.failBeforeWrite=true;await assert.rejects(s.run(f.a,q));await assert.rejects(s.run(f.a,q),{code:'BUSY'});assert.equal(f.state.writes,1);
  await f.repository.withLock('alice',async()=>{const pending=await f.repository.getPendingWrite('alice');pending.retryAfter=0;await f.repository.putPendingWrite('alice',pending);});
  f.files.get('file-'+f.a).tables.Students.push({row:2,value:{id:'external-student',name:'外部で変更'}});
  await assert.rejects(s.run(f.a,q),{code:'CONFLICT'});assert.equal(f.state.writes,1);
});

test('a lost automatic backup response reconciles the same private copy before saving',async t=>{
  const f=await fixture();t.after(()=>f.close());const s=new StudyService(f),q={action:'registerStudent',requestId:randomUUID(),data:{studentId:randomUUID(),studentKey:'e'.repeat(64),name:'架空バックアップ',grade:'中1'}};
  f.state.loseBackupResponse=true;await assert.rejects(s.run(f.a,q),{code:'BACKUP'});assert.equal(f.state.writes,0);await s.run(f.a,q);assert.equal(f.state.backups,1);assert.equal(f.files.get('file-'+f.a).tables.Students.length,1);
});
