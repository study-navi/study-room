/** Local workerd/SQLite check. No Cloudflare account, deployment or Google traffic. */
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';

const origin='https://study-room-test.invalid';
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:18795,modules:true,scriptPath:new URL('./release/worker-bundle/worker.js',import.meta.url).pathname,compatibilityDate:'2026-10-21',compatibilityFlags:['nodejs_compat'],durableObjects:{REGISTRY:{className:'StudyRoomRegistry',useSQLite:true}},bindings:{SR_ORIGIN:origin,GOOGLE_CLIENT_ID:'local-test-client',GOOGLE_CLIENT_SECRET:'local-test-placeholder',SR_KEY:randomBytes(32).toString('base64')},serviceBindings:{ASSETS:async req=>{const path=new URL(req.url).pathname;if(!/^\/[a-z.-]+$/.test(path))return new Response('',{status:404});return new Response(await readFile(new URL('./release/public'+path,import.meta.url)));}}}));
try{
  const me=await mf.dispatchFetch(origin+'/api/me');assert.equal(me.status,200);assert.deepEqual(await me.json(),{signedIn:false});assert.equal(me.headers.get('cache-control'),'no-store, max-age=0');
  const portal=await mf.dispatchFetch(origin+'/teacher');assert.equal(portal.status,200);assert.match(await portal.text(),/Googleでログイン/);
  const policy=await mf.dispatchFetch(origin+'/privacy');assert.equal(policy.status,200);assert.match(await policy.text(),/Cloudflare/);
  const oauth=await mf.dispatchFetch(origin+'/auth/google',{redirect:'manual'});assert.equal(oauth.status,302);const url=new URL(oauth.headers.get('location'));assert.equal(url.origin,'https://accounts.google.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.equal(url.searchParams.get('redirect_uri'),origin+'/auth/callback');assert.match(oauth.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);assert.match(oauth.headers.get('set-cookie'),/Secure/);
  const callback=await mf.dispatchFetch(origin+'/auth/callback?state='+url.searchParams.get('state')+'&code=not-real',{redirect:'manual',headers:{Cookie:'__Host-sr_oauth=wrong-browser'}});assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),'/teacher?authError=1');
  const csrf=await mf.dispatchFetch(origin+'/api/classrooms',{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
  assert.equal((await mf.dispatchFetch(origin+'/api/classrooms')).status,401);
  console.log('PASS: actual local Cloudflare workerd + durable SQLite, bundled portal/privacy assets, server-side Google OAuth URL generation/PKCE/cookies, wrong-browser rejection and CSRF/auth boundaries; no external Google requests or deployment.');
}finally{await mf.dispose();}
