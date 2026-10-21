import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ClassroomRegistration,DRIVE_SCOPE} from '../registration.mjs';

const ids={operation:'11111111-1111-4111-8111-111111111111',classroom:'22222222-2222-4222-8222-222222222222'};
function setup(){
  const operations=new Map(),classrooms=new Map(),locks=new Map(),files=[];
  const state={subject:'google-a',tokenSubject:'google-a',offlineReady:true,scopes:[DRIVE_SCOPE],creates:0,initializes:0,failCreate:false,failInit:false,loseAfterCreate:false};
  const repository={
    async withLock(key,fn){const previous=locks.get(key)||Promise.resolve();let release;const current=new Promise(r=>release=r);locks.set(key,current);await previous;try{return await fn();}finally{release();}},
    async getOperation(sub,op){return structuredClone(operations.get(sub+':'+op));},
    async putOperation(job){operations.set(job.ownerSubject+':'+job.requestId,structuredClone(job));},
    async saveClassroom(school){classrooms.set(school.id,structuredClone(school));}
  };
  const workspace={
    async identity(){return {sub:state.tokenSubject};},
    async createSpreadsheet(job){
      state.creates++;if(state.failCreate)throw Error('network timeout with private OAuth information');
      const file={id:'spreadsheet_'+files.length,mimeType:'application/vnd.google-apps.spreadsheet',ownedByMe:true,appProperties:{srClassroomId:job.id,srRegistrationId:job.requestId},webViewLink:`https://docs.google.com/spreadsheets/d/spreadsheet_${files.length}/edit?usp=drivesdk`};files.push(file);
      if(state.loseAfterCreate)throw Error('lost response after durable creation');return file;
    },
    async findRegistration(job){return files.filter(f=>f.appProperties.srClassroomId===job.id&&f.appProperties.srRegistrationId===job.requestId);},
    async getSpreadsheet(id){return files.find(f=>f.id===id);},
    async initializeSpreadsheet(){state.initializes++;if(state.failInit)throw Error('initialization temporarily failed');}
  };
  const auth={async requireGoogleSession(session){if(session!=='valid-server-session')throw Object.assign(Error('ログインしてください。'),{code:'AUTH'});return {subject:state.subject,accessToken:'server-only-test-token',offlineReady:state.offlineReady,scopes:state.scopes};}};
  const service=new ClassroomRegistration({auth,repository,workspaceFactory:()=>workspace,studentBaseUrl:'https://example.test/study-room/',newId:()=>ids.classroom,now:()=> '2026-10-21T00:00:00Z'});
  const register=(input={name:'森本校',requestId:ids.operation})=>service.register('valid-server-session',input);
  return {state,repository,service,workspace,operations,classrooms,files,register};
}
test('creates a teacher-owned classroom and returns no Google grants or owner identifiers',async()=>{
  const f=setup(),result=await f.register();assert.equal(result.status,'ready');assert.equal(f.classrooms.size,1);assert.equal(f.state.creates,1);
  assert.equal(new URL(result.studentUrl).searchParams.get('classroom'),ids.classroom);
  assert.deepEqual(Object.keys(result).sort(),['id','name','spreadsheetUrl','status','studentUrl']);
  assert.equal(/token|google-a|ownerSubject|requestId/i.test(JSON.stringify(result)),false);
});
test('same operation retried or double-clicked creates only one spreadsheet',async()=>{
  const f=setup();const results=await Promise.all([f.register(),f.register(),f.register()]);assert.deepEqual(results[0],results[1]);assert.equal(f.state.creates,1);assert.equal(f.state.initializes,1);
});
test('rejects forged destinations, owner identifiers and invalid input before using Google',async()=>{
  const f=setup();for(const input of [{name:'森本校',requestId:ids.operation,ownerSubject:'other'},{name:'森本校',requestId:ids.operation,spreadsheetId:'other'},{name:' ',requestId:ids.operation},{name:'森本校',requestId:'bad'},{name:'森本校\n尾西校',requestId:ids.operation}])await assert.rejects(f.register(input),{code:'INVALID'});
  assert.equal(f.state.creates,0);
});
test('requires a verified server session, minimal Drive consent and offline availability',async()=>{
  const f=setup();await assert.rejects(f.service.register('forged',{name:'森本校',requestId:ids.operation}),{code:'AUTH'});
  f.state.scopes=[];await assert.rejects(f.register(),{code:'CONSENT'});f.state.scopes=[DRIVE_SCOPE];f.state.offlineReady=false;await assert.rejects(f.register(),{code:'CONSENT'});assert.equal(f.state.creates,0);
});
test('refuses an access token for a different Google account',async()=>{
  const f=setup();f.state.tokenSubject='google-b';await assert.rejects(f.register(),{code:'AUTH'});assert.equal(f.operations.size,0);
});
test('never silently retries uncertain creation that might already have succeeded',async()=>{
  const f=setup();f.state.failCreate=true;await assert.rejects(f.register(),{code:'RECONCILE'});f.state.failCreate=false;await assert.rejects(f.register(),{code:'RECONCILE'});assert.equal(f.state.creates,1);
});
test('recovers a file created before the response was lost without duplicating it',async()=>{
  const f=setup();f.state.loseAfterCreate=true;await assert.rejects(f.register(),{code:'RECONCILE'});f.state.loseAfterCreate=false;const r=await f.register();assert.equal(r.status,'ready');assert.equal(f.state.creates,1);assert.equal(f.files.length,1);
});
test('retries initialization in the same file, preserving the classroom ID',async()=>{
  const f=setup();f.state.failInit=true;await assert.rejects(f.register());f.state.failInit=false;await f.register();assert.equal(f.state.creates,1);assert.equal(f.state.initializes,2);
});
test('operation reuse with another name is rejected',async()=>{
  const f=setup();await f.register();await assert.rejects(f.register({name:'尾西校',requestId:ids.operation}),{code:'CONFLICT'});assert.equal(f.state.creates,1);
});
test('never recovers an unowned file, wrong classroom, malicious URL, or duplicate candidates',async()=>{
  for(const mutate of [f=>f.files[0].ownedByMe=false,f=>f.files[0].appProperties.srClassroomId='wrong',f=>f.files[0].webViewLink='https://attacker.test/spreadsheets/d/spreadsheet_0/edit',f=>f.files.push({...f.files[0]})]){
    const f=setup();f.state.loseAfterCreate=true;await assert.rejects(f.register());mutate(f);await assert.rejects(f.register());assert.equal(f.state.initializes,0);assert.equal(f.classrooms.size,0);
  }
});
test('ready operations cannot be read through a different Google subject',async()=>{
  const f=setup();await f.register();f.state.subject='google-b';f.state.tokenSubject='google-b';
  // A durable repository implementation keys both operation and authorization by subject.
  f.repository.getOperation=async sub=>sub==='google-b'?{ownerSubject:'google-a',name:'森本校',status:'ready'}:undefined;
  await assert.rejects(f.register(),{code:'CONFLICT'});
});
test('unsafe public base URLs are refused',()=>{
  const f=setup();for(const studentBaseUrl of ['http://example.test/','https://example.test/?token=x','https://user:pass@example.test/'])assert.throws(()=>new ClassroomRegistration({auth:{requireGoogleSession(){}},repository:f.repository,workspaceFactory(){},studentBaseUrl}));
});
