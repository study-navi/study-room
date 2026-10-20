// Reproducible dependency bundler. Requires hash.js 1.1.7 (MIT).
const fs=require('fs'),path=require('path'),base=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||process.cwd()+'/node_modules';
const mods=[],ids=new Map();
function add(file){file=require.resolve(file);if(file.endsWith('/inherits/inherits.js'))file=file.replace('/inherits.js','/inherits_browser.js');if(ids.has(file))return ids.get(file);const id=mods.length;ids.set(file,id);mods.push('');let src=fs.readFileSync(file,'utf8');src=src.replace(/require\(['"]([^'"]+)['"]\)/g,(_,p)=>`load(${add(require.resolve(p,{paths:[path.dirname(file)]}))})`);mods[id]=`function(module,exports,load){\n${src}\n}`;return id;}
const root=add(base+'/hash.js');
const bundle=`/* hash.js 1.1.7, Copyright Fedor Indutny. MIT License; see THIRD_PARTY.md. */\nconst srHashLib_ = (()=>{const modules=[${mods.join(',\n')}],cache={};function load(id){if(!cache[id]){const m=cache[id]={exports:{}};modules[id](m,m.exports,load);}return cache[id].exports;}return load(${root});})();\n`;
fs.writeFileSync(path.join(__dirname,'../Password.gs'),bundle+`
// PBKDF2-HMAC-SHA256, one 32-byte block; matches RFC 8018 / Node crypto.
function srPbkdf2_(password,salt,iterations){
 const h=srHashLib_, key=h.utils.toArray(password), s=h.utils.toArray(salt).concat([0,0,0,1]);
 let u=h.hmac(h.sha256,key).update(s).digest(), out=u.slice();
 for(let i=1;i<iterations;i++){u=h.hmac(h.sha256,key).update(u).digest();for(let j=0;j<32;j++)out[j]^=u[j];}
 return out.map(b=>('0'+b.toString(16)).slice(-2)).join('');
}
`);
