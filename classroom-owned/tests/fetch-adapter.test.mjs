import test from 'node:test';
import assert from 'node:assert/strict';
import {handleFetch} from '../fetch-adapter.mjs';
test('Workers Fetch adapter preserves secure cookie multiplicity, origin, raw POST body and address',async()=>{
  const response=await handleFetch(async(req,res)=>{assert.equal(req.method,'POST');assert.equal(req.headers.origin,'https://example.invalid');assert.equal(req.socket.remoteAddress,'test-client');let body='';for await(const chunk of req)body+=chunk;assert.equal(body,'{"value":1}');res.setHeader('Set-Cookie',['a=1; HttpOnly; Secure','b=2; HttpOnly; Secure']);res.writeHead(303,{Location:'/teacher'});res.end();},new Request('https://example.invalid/api/test',{method:'POST',headers:{Origin:'https://example.invalid'},body:'{"value":1}'}),{clientAddress:'test-client'});
  assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/teacher');assert.equal(response.headers.getSetCookie().length,2);
});
