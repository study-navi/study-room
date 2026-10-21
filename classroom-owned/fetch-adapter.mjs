/** Adapter shared by a Workers Durable Object and Node integration checks. */
export async function handleFetch(handler,request,{clientAddress='unknown'}={}){
  const url=new URL(request.url),headers=Object.fromEntries(request.headers);
  const req={url:url.pathname+url.search,method:request.method,headers,socket:{remoteAddress:clientAddress},async *[Symbol.asyncIterator](){if(request.body)for await(const chunk of request.body)yield Buffer.from(chunk);}};
  let status=200,body=null;const responseHeaders=new Headers();
  const res={setHeader(name,value){responseHeaders.delete(name);for(const item of Array.isArray(value)?value:[value])responseHeaders.append(name,String(item));},writeHead(code,values={}){status=code;for(const [key,value] of Object.entries(values))this.setHeader(key,value);},end(value){body=value??null;}};
  await handler(req,res);return new Response(body,{status,headers:responseHeaders});
}
