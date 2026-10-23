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

test('classroom mode entry: one tap from the student URL, owner-only, returns only to safe teacher pages',async t=>{
  const f=await serverFixture(t),manual=u=>fetch(f.origin+u,{redirect:'manual',headers:{Cookie:'sr_local_session=alice-session'}}),anon=u=>fetch(f.origin+u,{redirect:'manual'});
  const target='/study?classroom='+f.a+'&manage=1&mode=classroom';
  const own=await manual('/open?classroom='+f.a+'&mode=classroom');assert.equal(own.status,302);assert.equal(own.headers.get('location'),target);
  const other=await anon('/open?classroom='+f.a+'&mode=classroom');assert.equal(other.status,302);assert.equal(other.headers.get('location'),'/auth/google?return='+encodeURIComponent(encodeURIComponent(target)));
  const notOwner=await fetch(f.origin+'/open?classroom='+f.a,{redirect:'manual',headers:{Cookie:'sr_local_session=bob-session'}});assert.match(notOwner.headers.get('location'),/^\/auth\/google\?return=/);
  assert.equal((await anon('/open?classroom='+randomUUID())).status,404);assert.equal((await anon('/open?classroom=x')).status,404);
});
test('after Google login the teacher returns to classroom mode, but never to an arbitrary address',async t=>{
  const f=await fixture(),chosen=port++,origin='http://127.0.0.1:'+chosen,auth={...f.auth,begin:async()=>({url:'https://accounts.example.invalid/auth',binding:'bind'}),complete:async()=>({session:'alice-session'})};
  const server=createApplication({...f,auth,origin,secureCookies:false});await new Promise(r=>server.listen(chosen,'127.0.0.1',r));t.after(async()=>{await new Promise(r=>server.close(r));f.close();});
  const target='/study?classroom='+f.a+'&manage=1&mode=classroom',start=await fetch(origin+'/auth/google?return='+encodeURIComponent(encodeURIComponent(target)),{redirect:'manual'});
  assert.equal(start.status,302);const jar=start.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');assert.match(jar,/sr_local_return=/);
  const back=await fetch(origin+'/auth/callback?state=s&code=c',{redirect:'manual',headers:{Cookie:jar}});assert.equal(back.status,303);assert.equal(back.headers.get('location'),target);
  for(const evil of ['https://evil.invalid/','//evil.invalid','/study?classroom='+f.a+'&manage=1&x=https://evil.invalid','/teacher']){
    const s2=await fetch(origin+'/auth/google?return='+encodeURIComponent(encodeURIComponent(evil)),{redirect:'manual'});const jar2=s2.headers.getSetCookie().map(c=>c.split(';')[0]).filter(c=>!/return=$/.test(c)).join('; ');
    const b2=await fetch(origin+'/auth/callback?state=s&code=c',{redirect:'manual',headers:{Cookie:jar2}});assert.equal(b2.headers.get('location'),'/teacher');
  }
});

test('student page never contains the teacher screens; admin page only for the owner',async t=>{
  const f=await serverFixture(t),alice={Cookie:'sr_local_session=alice-session'},bob={Cookie:'sr_local_session=bob-session'};
  const get=(path,headers={})=>fetch(f.origin+path,{redirect:'manual',headers});
  const student=await (await get('/study?classroom='+f.a)).text();
  for(const word of ['teacherPanel','mcDashboard0','crActiveList','mcRoster','mcDashboard','loginBox'])assert.ok(!student.includes('id="'+word+'"'),word);
  assert.match(student,/name="sr-view" content="student"/);
  // 生徒がURLに manage や mode を付けても、先生用の画面は返らない。
  const anon=await get('/study?classroom='+f.a+'&manage=1');assert.equal(anon.status,302);assert.equal(anon.headers.get('location'),'/open?classroom='+f.a);
  const anonMode=await get('/study?classroom='+f.a+'&manage=1&mode=classroom');assert.equal(anonMode.status,302);assert.equal(anonMode.headers.get('location'),'/open?classroom='+f.a+'&mode=classroom');
  const other=await get('/study?classroom='+f.a+'&manage=1',bob);assert.equal(other.status,302);assert.equal(other.headers.get('location'),'/teacher');
  const own=await get('/study?classroom='+f.a+'&manage=1',alice);assert.equal(own.status,200);const ownHtml=await own.text();assert.ok(ownHtml.includes('id="teacherPanel"'));assert.match(ownHtml,/name="sr-view" content="auto"/);
  const ownStudent=await (await get('/study?classroom='+f.a,alice)).text();assert.ok(!ownStudent.includes('id="teacherPanel"'));
});
