import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {TokenVault} from '../token-vault.mjs';

test('offline grant is encrypted with independent random IVs and never appears in persisted text',()=>{
  const vault=new TokenVault(randomBytes(32)),grant={refreshToken:'fictional-offline-grant',scopes:['drive.file']};
  const first=vault.seal('google-a',grant),second=vault.seal('google-a',grant);assert.notEqual(first,second);assert.equal(first.includes(grant.refreshToken),false);assert.deepEqual(vault.open('google-a',first),grant);
});
test('another teacher, another key and tampered encrypted data cannot decrypt a grant',()=>{
  const vault=new TokenVault(randomBytes(32)),sealed=vault.seal('google-a',{refreshToken:'fictional-token'});
  assert.throws(()=>vault.open('google-b',sealed));assert.throws(()=>new TokenVault(randomBytes(32)).open('google-a',sealed));
  const x=JSON.parse(sealed);const data=Buffer.from(x.data,'base64url');data[0]^=1;x.data=data.toString('base64url');assert.throws(()=>vault.open('google-a',JSON.stringify(x)));
});
test('malformed envelopes and missing encryption keys fail closed',()=>{
  assert.throws(()=>new TokenVault(Buffer.alloc(16)));const vault=new TokenVault(randomBytes(32));
  for(const value of ['null','{}','bad','{"v":2,"keyId":"v1"}'])assert.throws(()=>vault.open('google-a',value));
  assert.throws(()=>vault.seal('google-a',{}));
});
