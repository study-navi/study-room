import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixture.mjs';
import {createApplication} from '../server.mjs';

let port=18791;
async function serverFixture(t){const f=await fixture(),chosen=port++,origin='http://127.0.0.1:'+chosen;let server=createApplication({...f,origin,secureCookies:false});await new Promise(r=>server.listen(chosen,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));f.close();});return {...f,origin};}
test('HTTP boundaries: no auth token in URLs, CSRF and cross-tenant denial, QR only for owner',async t=>{
  const f=await serverFixture(t),post=(data,headers={})=>fetch(f.origin+'/api/study',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json',...headers},body:JSON.stringify(data)});
  const me=await fetch(f.origin+'/api/me');assert.equal(me.headers.get('cache-control'),'no-store, max-age=0');assert.deepEqual(await me.json(),{signedIn:false});
  const body={classroom:f.a,action:'list',data:{session:'cookie'},requestId:randomUUID()};assert.equal((await post(body)).status,401);
  assert.equal((await post(body,{Cookie:'sr_local_session=alice-session'})).status,403);
  assert.equal((await post(body,{Cookie:'sr_local_session=alice-session','X-CSRF-Token':'alice-csrf',Origin:'https://attacker.invalid'})).status,403);
  assert.equal((await post(body,{Cookie:'sr_local_session=bob-session','X-CSRF-Token':'bob-csrf'})).status,403);
  assert.equal((await post(body,{Cookie:'sr_local_session=alice-session','X-CSRF-Token':'alice-csrf'})).status,200);
  assert.equal((await fetch(f.origin+'/api/qr?classroom='+f.a)).status,401);
  assert.equal((await fetch(f.origin+'/api/qr?classroom='+f.a,{headers:{Cookie:'sr_local_session=bob-session'}})).status,403);
  const qr=await fetch(f.origin+'/api/qr?classroom='+f.a,{headers:{Cookie:'sr_local_session=alice-session'}});assert.equal(qr.status,200);assert.match(await qr.text(),/<svg/);
  const own=await fetch(f.origin+'/api/classrooms',{headers:{Cookie:'sr_local_session=alice-session'}});const rooms=(await own.json()).classrooms;assert.deepEqual(rooms.map(x=>x.id),[f.a]);assert.ok(!JSON.stringify(rooms).includes('ownerSubject'));
});
test('student URL, classroom-specific PWA, anonymous registration and soft deletion protection',async t=>{
  const f=await serverFixture(t),page=await fetch(f.origin+'/study?classroom='+f.a);assert.equal(page.status,200);const html=await page.text();assert.ok(!html.includes('script.google.com'));assert.match(html,/manifest.webmanifest\?classroom=/);
  const manifest=await fetch(f.origin+'/manifest.webmanifest?classroom='+f.a);assert.equal((await manifest.json()).start_url,'/study?classroom='+f.a);
  const body={classroom:f.a,action:'registerStudent',requestId:randomUUID(),data:{schoolId:f.a,studentId:randomUUID(),studentKey:'a'.repeat(64),name:'架空HTTP検証',grade:'中1'}};
  const r=await fetch(f.origin+'/api/study',{method:'POST',headers:{Origin:f.origin,'Content-Type':'application/json'},body:JSON.stringify(body)});assert.equal(r.status,200);assert.equal((await r.json()).result,'success');
  assert.equal((await fetch(f.origin+'/study?classroom='+randomUUID())).status,404);
});
