"""Prepare a Pages/PWA candidate without publishing it or changing production files."""
import argparse,html,json,re,runpy,hashlib
from pathlib import Path
from urllib.parse import urlsplit
p=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--endpoint',required=True)
parser.add_argument('--output',type=Path,default=p/'release'/'pages')
parser.add_argument('--staging',action='store_true',help='Show a prominent fictional-data-only notice for a separate preview URL.')
args=parser.parse_args()
u=urlsplit(args.endpoint)
if u.scheme!='https' or u.netloc!='script.google.com' or not re.fullmatch(r'/macros/s/[A-Za-z0-9_-]+/exec',u.path) or u.query or u.fragment:
    parser.error('Use an exact Apps Script /exec URL without query parameters.')
runpy.run_path(str(p/'tools'/'build.py'))
s=(p/'App.html').read_text()
s=s.replace('<meta charset="utf-8">','<meta charset="utf-8">\n<meta name="study-room-api" content="'+html.escape(args.endpoint,quote=True)+'">')
s=s.replace('href="https://study-navi.github.io/study-room/manifest.webmanifest"','href="./manifest.webmanifest"')
# Allow localhost acceptance testing too; production registration remains same-origin.
s=s.replace("location.hostname==='study-navi.github.io' && 'serviceWorker' in navigator","'serviceWorker' in navigator")
if args.staging:
    s=s.replace('<body>','<body><aside role="note" style="padding:14px 18px;background:#fff4cc;border-bottom:2px solid #c18a00;color:#493300;font-weight:700;line-height:1.6">検証用 Study Room — 架空データのみ<br><span style="font-weight:400">実在する生徒の名前・学習記録は入力しないでください。このページの記録は本番へ移行しません。</span><br><a href="https://study-navi.github.io/study-room/">現在の公開版に戻る</a></aside>',1)
out=args.output.resolve()
if out==p.parent or out==p:parser.error('Output must be a separate candidate directory.')
out.mkdir(parents=True,exist_ok=True)
(out/'index.html').write_text(s)
manifest=json.loads((p.parent/'manifest.webmanifest').read_text())
for icon in manifest['icons']:icon['src']='https://study-navi.github.io/study-room/'+icon['src'].removeprefix('./')
(out/'manifest.webmanifest').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
(out/'sw.js').write_text("/* No request or response caching: private records and credentials stay out of CacheStorage. */\nself.addEventListener('install',()=>self.skipWaiting());\nself.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));\nself.addEventListener('fetch',()=>{});\n")
files={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(out.iterdir()) if f.name in ['index.html','manifest.webmanifest','sw.js']}
(out/'build-info.json').write_text(json.dumps({'status':'candidate-unverified-live-post','endpoint':args.endpoint,'files':files},indent=2)+'\n')
print('Prepared PWA candidate:',out)
