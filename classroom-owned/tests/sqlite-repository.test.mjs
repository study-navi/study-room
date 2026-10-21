import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {SqliteRepository} from '../sqlite-repository.mjs';
import {TokenVault} from '../token-vault.mjs';

function fixture(t){const dir=mkdtempSync(join(tmpdir(),'sr-registration-')),file=join(dir,'private.sqlite');const repos=[];t.after(()=>{for(const r of repos)try{r.close();}catch{}rmSync(dir,{recursive:true,force:true});});return {file,open(options){const r=new SqliteRepository(file,options);repos.push(r);return r;}};}
test('registration checkpoints survive reopening and are scoped by Google subject',async t=>{
  const f=fixture(t),a=f.open();await a.withLock('google-a',async()=>{await a.putOperation({ownerSubject:'google-a',requestId:'operation',status:'creating'});await a.saveClassroom({id:'classroom-a',ownerSubject:'google-a',name:'森本校'});});a.close();const b=f.open();
  await b.withLock('google-a',async()=>{assert.equal((await b.getOperation('google-a','operation')).status,'creating');assert.equal((await b.listClassrooms('google-a')).length,1);});
  await b.withLock('google-b',async()=>{assert.equal(await b.getOperation('google-b','operation'),undefined);assert.deepEqual(await b.listClassrooms('google-b'),[]);await assert.rejects(b.saveClassroom({id:'classroom-a',ownerSubject:'google-b',name:'偽名'}),{code:'OWNERSHIP'});});
  assert.equal(statSync(f.file).mode&0o777,0o600);
});
test('separate repository instances serialize registration for the same account',async t=>{
  const f=fixture(t),a=f.open(),b=f.open();const order=[];
  await Promise.all([a.withLock('google-a',async()=>{order.push('first');await delay(70);await a.putOperation({ownerSubject:'google-a',requestId:'operation',status:'ready'});order.push('first-done');}),b.withLock('google-a',async()=>{order.push('second');assert.equal((await b.getOperation('google-a','operation')).status,'ready');})]);assert.deepEqual(order,['first','first-done','second']);
});
test('data methods reject missing or cross-account leases',async t=>{
  const r=fixture(t).open();await assert.rejects(r.getOperation('google-a','operation'),{code:'LOCK'});await r.withLock('google-a',async()=>{await assert.rejects(r.getOperation('google-b','operation'),{code:'LOCK'});await assert.rejects(r.saveClassroom({id:'x',ownerSubject:'google-b'}),{code:'LOCK'});});
});
test('only encrypted offline grants are persisted and another account cannot read them',async t=>{
  const f=fixture(t),r=f.open(),vault=new TokenVault(randomBytes(32)),grant={refreshToken:'PRIVATE-FIXTURE-REFRESH-TOKEN'};
  await r.withLock('google-a',async()=>{await assert.rejects(r.putGrant('google-a',JSON.stringify(grant)));await r.putGrant('google-a',vault.seal('google-a',grant));assert.deepEqual(vault.open('google-a',await r.getGrant('google-a')),grant);});
  await r.withLock('google-b',async()=>assert.equal(await r.getGrant('google-b'),undefined));assert.equal(readFileSync(f.file).includes(Buffer.from(grant.refreshToken)),false);
});
