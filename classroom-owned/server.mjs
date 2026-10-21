import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {SqliteRepository} from './sqlite-repository.mjs';
import {TokenVault} from './token-vault.mjs';
import {GoogleAuth} from './google-auth.mjs';
import {createHandler} from './http-handler.mjs';

export function createApplication(options){
  return createServer(createHandler({getAsset:name=>readFile(new URL(['portal.html','privacy.html'].includes(name)?'./'+name:'./release/'+name,import.meta.url)),...options}));
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const {SR_ORIGIN,SR_CONTACT_EMAIL,SR_MODE,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET,SR_KEY,SR_DATABASE,PORT='8080'}=process.env;
  if(!SR_ORIGIN||!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET||!SR_KEY||!SR_DATABASE)throw Error('Required: SR_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SR_KEY (32-byte base64), SR_DATABASE (persistent private path).');
  const repository=new SqliteRepository(SR_DATABASE),vault=new TokenVault(Buffer.from(SR_KEY,'base64'));
  const auth=new GoogleAuth({clientId:GOOGLE_CLIENT_ID,clientSecret:GOOGLE_CLIENT_SECRET,origin:SR_ORIGIN,repository,vault});
  if(SR_MODE==='production'&&!SR_CONTACT_EMAIL)throw Error('A public operator contact is required in production.');
  const server=createApplication({origin:SR_ORIGIN,contactEmail:SR_CONTACT_EMAIL,staging:SR_MODE!=='production',repository,auth});server.listen(Number(PORT),'127.0.0.1',()=>console.log('Study Room listening on loopback port '+Number(PORT)));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{repository.close();process.exit(0);}));
}
