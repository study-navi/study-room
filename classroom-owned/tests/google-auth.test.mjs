import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {GoogleAuth,digest} from '../google-auth.mjs';
import {TokenVault} from '../token-vault.mjs';
import {DRIVE_SCOPE} from '../registration.mjs';
import {fixture} from './fixture.mjs';

async function setup(t){const f=await fixture();t.after(()=>f.close());let generated,exchange,verified;const state={nonce:null,subject:'alice',scopes:DRIVE_SCOPE,verifiedEmail:true,refresh:'offline-secret',verifyFailure:false};
  const auth=new GoogleAuth({clientId:'test-client-id',clientSecret:'not-real',origin:'https://example.invalid',repository:f.repository,vault:new TokenVault(randomBytes(32)),clientFactory:()=>({generateCodeVerifierAsync:async()=>({codeVerifier:'private-verifier',codeChallenge:'challenge'}),generateAuthUrl:options=>{generated=options;state.nonce=options.nonce;return 'https://accounts.google.com/o/oauth2/v2/auth?state='+options.state;},getToken:async options=>{exchange=options;return {tokens:{id_token:'signed-id-token',refresh_token:state.refresh,scope:state.scopes}};},verifyIdToken:async options=>{verified=options;if(state.verifyFailure)throw Error('signature, audience or expiry rejected');return {getPayload:()=>({sub:state.subject,nonce:state.nonce,email_verified:state.verifiedEmail,email:'teacher@example.invalid'})};},setCredentials:()=>{},getAccessToken:async()=>({token:'access-token'})})});
  return {...f,auth,state,generated:()=>generated,exchange:()=>exchange,verified:()=>verified};}

test('Google server OAuth binds one-use state, PKCE, nonce, verified ID audience, encrypted offline grant and rotated session',async t=>{
  const f=await setup(t),start=await f.auth.begin(),options=f.generated();assert.equal(options.code_challenge_method,'S256');assert.deepEqual(options.scope,['openid','email',DRIVE_SCOPE]);assert.equal(options.access_type,'offline');
  const old='old-cookie';f.repository.putSession(digest(old),{subject:'alice'},Date.now()+60000);
  const result=await f.auth.complete({state:options.state,binding:start.binding,code:'one-time-code',previousSession:old});
  assert.equal(f.exchange().codeVerifier,'private-verifier');assert.deepEqual(f.verified(),{idToken:'signed-id-token',audience:'test-client-id'});
  assert.equal(f.auth.session(old),undefined);assert.equal(f.auth.session(result.session).subject,'alice');assert.ok(!JSON.stringify(f.auth.session(result.session)).includes('offline-secret'));
  const envelope=await f.repository.withLock('alice',()=>f.repository.getGrant('alice'));assert.ok(!envelope.includes('offline-secret'));
  await assert.rejects(f.auth.complete({state:options.state,binding:start.binding,code:'replay'}),{code:'AUTH'});
  assert.equal((await f.auth.requireGoogleSession(result.session)).accessToken,'access-token');f.auth.logout(result.session);await assert.rejects(f.auth.requireGoogleSession(result.session),{code:'AUTH'});
});
test('wrong browser, nonce, signature, consent and unverified email never create an authenticated session',async t=>{
  for(const kind of ['binding','nonce','signature','scope','email']){
    const f=await setup(t),start=await f.auth.begin(),options=f.generated();
    if(kind==='nonce')f.state.nonce='wrong-nonce';if(kind==='signature')f.state.verifyFailure=true;if(kind==='scope')f.state.scopes='openid email';if(kind==='email')f.state.verifiedEmail=false;
    await assert.rejects(f.auth.complete({state:options.state,binding:kind==='binding'?'other-browser':start.binding,code:'code'}));
    assert.equal(await f.repository.withLock('alice',()=>f.repository.getGrant('alice')),undefined);
  }
});
