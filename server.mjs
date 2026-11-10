import express from 'express';
import {rateLimit} from 'express-rate-limit';
import nodemailer from 'nodemailer';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {readFileSync, statSync} from 'node:fs';
import {NoteStore} from './notes.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const ASSET_VERSION=(readFileSync(path.join(root,'public/index.html'),'utf8').match(/app\.js\?v=(\d+)/)||[])[1]||'1';
// Empfänger der Meldungen: MAIL_TO, sonst die Absenderadresse aus MAIL_FROM (Postfach des Mailkontos)
export function recipient(env){
 const raw=env.MAIL_TO||env.MAIL_FROM||'';
 const address=(raw.match(/<([^>]+)>/)?.[1]||raw).trim();
 return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)?address:'';
}
export function createTransport(env){
 return nodemailer.createTransport({host:env.SMTP_HOST,port:Number(env.SMTP_PORT||587),secure:env.SMTP_PORT==='465',requireTLS:env.SMTP_PORT!=='465',auth:{user:env.SMTP_USER,pass:env.SMTP_PASS},connectionTimeout:10000,socketTimeout:15000});
}
// Grund eines fehlgeschlagenen Versands ins Log (journalctl / docker logs), ohne Zugangsdaten
export function describeMailError(err){
 return [err?.code,err?.responseCode,err?.command,err?.response||err?.message].filter(Boolean).join(' | ');
}

// Daten für Vorschau-Angaben; werden neu gelesen, sobald das Update-Skript die Dateien ersetzt
let cached=null;
function mtime(file){try{return statSync(file).mtimeMs;}catch{return 0;}}
// Aktualisierte Daten liegen in DATA_DIR (falls gesetzt und vorhanden), sonst gilt der Stand aus dem Repository
export function dataFile(dir,name,env=process.env){
 const bundled=path.join(dir,'public/data',name);
 const updated=env.DATA_DIR&&path.join(env.DATA_DIR,name);
 return updated&&mtime(updated)>mtime(bundled)?updated:bundled; // die neuere Datei gewinnt
}
export function loadData(dir,env=process.env){
 const files=[path.join(dir,'public/index.html'),dataFile(dir,'hydrants.json',env),dataFile(dir,'districts.geojson',env)];
 const stamp=files.join('|')+files.map(mtime).join('|');
 if(cached?.stamp===stamp) return cached;
 const hydrants=JSON.parse(readFileSync(files[1],'utf8'));
 let districts=[];
 try{districts=JSON.parse(readFileSync(files[2],'utf8')).features.map(f=>({nr:f.properties.nr,name:f.properties.name,polygons:f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates,count:0}));}catch{}
 const byId=new Map(hydrants.data.map(([id,lat,lng])=>[String(id),{id:String(id),lat,lng}]));
 cached={stamp,index:readFileSync(files[0],'utf8'),byId,districts};
 for(const h of byId.values()){const d=districtOf(cached,h);if(d)d.count++;}
 return cached;
}
function insideRing([x,y],ring){let c=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
export function districtOf(data,h){
 if(!h.district) h.district=data.districts.find(d=>d.polygons.some(p=>insideRing([h.lng,h.lat],p[0])&&!p.slice(1).some(r=>insideRing([h.lng,h.lat],r))))||null;
 return h.district;
}
export function createApp({sendMail,env=process.env,fetchImpl=fetch,noteStore}={}) {
 const app=express();
 if(env.TRUST_PROXY) app.set('trust proxy',Number(env.TRUST_PROXY));
 app.disable('x-powered-by');
 app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Permissions-Policy':'geolocation=(self)','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://mapsneu.wien.gv.at; connect-src 'self' https://mapsneu.wien.gv.at; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});next();});
 app.use(express.json({limit:'8kb'}));
 const RECIPIENT=recipient(env);
 const configured=Boolean((sendMail&&RECIPIENT) || (env.SMTP_HOST&&env.SMTP_USER&&env.SMTP_PASS&&env.MAIL_FROM&&RECIPIENT));
 const transport= !sendMail&&configured ? createTransport(env) : null;
 app.get('/api/health',(_req,res)=>res.json({ok:true,reporting:configured}));
 app.post('/api/report',rateLimit({windowMs:3600000,limit:5,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Zu viele Meldungen. Bitte in einer Stunde erneut versuchen.'}}),async(req,res)=>{
  if(req.headers.origin && req.headers.origin!==env.PUBLIC_URL && !(!env.PUBLIC_URL&&/^http:\/\/localhost:\d+$/.test(req.headers.origin))) return res.status(403).json({error:'Anfrage nicht erlaubt.'});
  const {lat,lng,description,email='',website=''}=req.body||{};
  if(website) return res.status(400).json({error:'Meldung ungültig.'});
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<48.10||lat>48.34||lng<16.17||lng>16.59||typeof description!=='string'||description.trim().length<10||description.length>2000||typeof email!=='string'||email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({error:'Bitte einen Standort in Wien, eine Beschreibung (10–2000 Zeichen) und eine gültige optionale E-Mail angeben.'});
  if(!configured) return res.status(503).json({error:'Der E-Mail-Versand ist noch nicht eingerichtet. Bitte später erneut versuchen.'});
  try {
   const message={from:env.MAIL_FROM,to:RECIPIENT,...(email?{replyTo:email}:{}),subject:'Hydrantenkarte Wien: fehlender Hydrant',text:`Neuer Hinweis (ungeprüft)\n\nStandort: ${lat}, ${lng}\nhttps://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}\n\n${description.trim()}\n\nKontakt: ${email||'Nicht angegeben'}`};
   const result=await (sendMail?sendMail(message):transport.sendMail(message));
   if(result?.rejected?.length) throw new Error('Mail rejected');
   res.json({ok:true});
  } catch(err) {console.error('Mailversand (Meldung) fehlgeschlagen:',describeMailError(err));res.status(502).json({error:'Die E-Mail konnte nicht versendet werden. Bitte erneut versuchen.'});}
 });
 const notes=noteStore||new NoteStore(env.DATA_DIR||path.join(root,'var'));
 const baseUrl=req=>(env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
 const sameOrigin=req=>!req.headers.origin||req.headers.origin===env.PUBLIC_URL||(!env.PUBLIC_URL&&/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(req.headers.origin));
 app.post('/api/note',rateLimit({windowMs:3600000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Zu viele Notizen. Bitte später erneut versuchen.'}}),async(req,res)=>{
  if(!sameOrigin(req)) return res.status(403).json({error:'Anfrage nicht erlaubt.'});
  const {lat,lng,hydrantId,description,email='',website=''}=req.body||{};
  if(website) return res.status(400).json({error:'Notiz ungültig.'});
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||lat<48.10||lat>48.34||lng<16.17||lng>16.59||typeof hydrantId!=='string'||!/^\d{1,12}$/.test(hydrantId)||typeof description!=='string'||description.trim().length<3||description.length>1000||typeof email!=='string'||email.length>254||(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return res.status(400).json({error:'Bitte eine gültige Notiz und einen Hydranten in Wien angeben.'});
  if(!configured) return res.status(503).json({error:'Der E-Mail-Versand ist noch nicht eingerichtet. Bitte später erneut versuchen.'});
  let note;
  try { note=await notes.add({hydrantId,lat,lng,text:description.trim(),email}); }
  catch(err) { if(err.code!=='FULL') console.error('Notiz speichern fehlgeschlagen:',err.message); return res.status(503).json({error:'Notizen können gerade nicht angenommen werden. Bitte später erneut versuchen.'}); }
  const review=`${baseUrl(req)}/notiz/${note.id}?sig=${notes.sign(note.id)}`;
  try {
   const message={from:env.MAIL_FROM,to:RECIPIENT,...(email?{replyTo:email}:{}),subject:`Hydrantenkarte: Notiz zu Hydrant ${hydrantId} prüfen`,text:`Neue Notiz zur Prüfung (noch nicht öffentlich)\n\nHydrant: ${hydrantId}\nStandort: ${lat}, ${lng}\nhttps://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=19/${lat}/${lng}\n\n${note.text}\n\nKontakt: ${email||'Nicht angegeben'}\n\nVeröffentlichen oder ablehnen:\n${review}\n\nÜber denselben Link lässt sich die Notiz später wieder entfernen.`};
   const result=await (sendMail?sendMail(message):transport.sendMail(message));
   if(result?.rejected?.length) throw new Error('Mail rejected');
   res.json({ok:true});
  } catch(err) {
   console.error('Mailversand (Notiz) fehlgeschlagen:',describeMailError(err));
   await notes.remove(note.id).catch(()=>{});
   res.status(502).json({error:'Die Notiz konnte nicht versendet werden. Bitte erneut versuchen.'});
  }
 });
 app.get('/api/notes',async(_req,res,next)=>{
  try { res.set('Cache-Control','no-cache').json(await notes.published()); } catch(err) { next(err); }
 });

 // Prüfseite für den Betreiber, erreichbar nur über den signierten Link aus der E-Mail
 const moderation=rateLimit({windowMs:600000,limit:60,legacyHeaders:false});
 const statusText={pending:'Wartet auf Prüfung',published:'Veröffentlicht',rejected:'Abgelehnt'};
 function moderationPage(note,sig,message=''){
  const e=escapeHtml;
  const button=(action,label,cls='')=>`<form method="post"><input type="hidden" name="sig" value="${e(sig)}"><input type="hidden" name="action" value="${action}"><button class="${cls}">${label}</button></form>`;
  const actions=note.status==='published'?button('reject','Wieder entfernen','outline'):note.status==='rejected'?button('publish','Doch veröffentlichen','primary'):button('publish','Veröffentlichen','primary')+button('reject','Ablehnen','outline');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Notiz prüfen · Hydranten Wien</title><link rel="icon" href="/icons/icon.svg"><link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}"></head><body class="page"><article class="page-body moderation">
<h1>Notiz prüfen</h1>${message?`<p class="notice">${e(message)}</p>`:''}
<p><strong>Hydrant ${e(note.hydrantId)}</strong> · <a href="/?h=${e(note.hydrantId)}" target="_blank">auf der Karte ↗</a><br><span class="small">Eingegangen am ${new Date(note.created).toLocaleString('de-AT',{timeZone:'Europe/Vienna'})}</span></p>
<blockquote>${e(note.text).replace(/\n/g,'<br>')}</blockquote>
<p class="small">Kontakt (wird nie veröffentlicht): ${note.email?e(note.email):'nicht angegeben'}</p>
<p>Status: <strong>${statusText[note.status]||e(note.status)}</strong></p><div class="moderation-actions">${actions}</div></article></body></html>`;
 }
 app.get('/notiz/:id',moderation,async(req,res,next)=>{
  try {
   const note=await notes.get(req.params.id);
   if(!note||!notes.verify(note.id,req.query.sig)) return res.status(404).sendFile(path.join(root,'public/404.html'));
   res.set({'Cache-Control':'no-store','Referrer-Policy':'same-origin'}).type('html').send(moderationPage(note,req.query.sig,{published:'Die Notiz ist jetzt öffentlich.',rejected:'Die Notiz ist nicht öffentlich.'}[req.query.done]||''));
  } catch(err) { next(err); }
 });
 app.post('/notiz/:id',moderation,express.urlencoded({extended:false,limit:'2kb'}),async(req,res,next)=>{
  try {
   if(!sameOrigin(req)) return res.status(403).send('Anfrage nicht erlaubt.');
   const note=await notes.get(req.params.id);
   const sig=req.body?.sig;
   if(!note||!notes.verify(note.id,sig)) return res.status(404).sendFile(path.join(root,'public/404.html'));
   const status={publish:'published',reject:'rejected'}[req.body.action];
   if(!status) return res.status(400).send('Ungültige Aktion.');
   await notes.setStatus(note.id,status);
   res.redirect(303,`/notiz/${note.id}?sig=${encodeURIComponent(sig)}&done=${status}`);
  } catch(err) { next(err); }
 });
 let nextSearch=0;const cache=new Map();
 app.get('/api/search',rateLimit({windowMs:60000,limit:15,legacyHeaders:false,message:{error:'Bitte kurz warten.'}}),async(req,res)=>{
  const q=String(req.query.q||'').trim();if(q.length<3||q.length>160)return res.status(400).json({error:'Bitte eine Adresse eingeben.'});
  if(cache.has(q))return res.json(cache.get(q));
  if(Date.now()<nextSearch)return res.status(429).json({error:'Bitte einen Moment warten und erneut suchen.'});
  nextSearch=Date.now()+1100;
  try {const url=new URL('https://nominatim.openstreetmap.org/search');url.search=new URLSearchParams({q:q+', Wien',format:'jsonv2',limit:'5',countrycodes:'at',viewbox:'16.17,48.34,16.59,48.10',bounded:'1'});
   const response=await fetchImpl(url,{headers:{'User-Agent':'HydrantenkarteWien/1.0 (https://hydranten.oschmanndigital.at)','Accept-Language':'de'},signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();
   const results=(await response.json()).map(x=>({label:x.display_name,lat:Number(x.lat),lng:Number(x.lon)}));if(cache.size>300)cache.clear();cache.set(q,results);res.json(results);
  }catch{res.status(502).json({error:'Adresssuche derzeit nicht verfügbar. Wähle den Standort auf der Karte.'});}
 });

 const walkCache=new Map();
 app.get('/api/walk',rateLimit({windowMs:60000,limit:20,legacyHeaders:false,message:{error:'Bitte kurz warten.'}}),async(req,res)=>{
  const parse=s=>String(s||'').split(';').map(p=>p.split(',').map(Number)).filter(p=>p.length===2&&p.every(Number.isFinite));
  const from=parse(req.query.from),to=parse(req.query.to);
  const inVienna=([lat,lng])=>lat>48.10&&lat<48.34&&lng>16.17&&lng<16.59;
  if(from.length!==1||to.length<1||to.length>15||![...from,...to].every(inVienna)) return res.status(400).json({error:'Ungültige Wegberechnung.'});
  const round=([lat,lng])=>[lat.toFixed(5),lng.toFixed(5)];
  const key=[...from,...to].map(p=>round(p).join(',')).join(';');
  if(walkCache.has(key)) return res.json(walkCache.get(key));
  try {
   const coords=[...from,...to].map(p=>{const [lat,lng]=round(p);return lng+','+lat;}).join(';');
   const url=new URL(`https://routing.openstreetmap.de/routed-foot/table/v1/foot/${coords}`);
   url.search=new URLSearchParams({sources:'0',annotations:'distance,duration'});
   const response=await fetchImpl(url,{headers:{'User-Agent':'HydrantenkarteWien/1.0 (https://hydranten.oschmanndigital.at)'},signal:AbortSignal.timeout(8000)});
   if(!response.ok) throw new Error();
   const data=await response.json();
   if(data.code!=='Ok'||!Array.isArray(data.distances?.[0])) throw new Error();
   const pick=a=>a.slice(1).map(v=>Number.isFinite(v)?Math.round(v):null);
   const result={distances:pick(data.distances[0]),durations:pick(data.durations?.[0]||[])};
   if(walkCache.size>500) walkCache.clear(); walkCache.set(key,result); res.json(result);
  } catch {res.status(502).json({error:'Wegberechnung derzeit nicht verfügbar.'});}
 });

 // Startseite mit passenden Vorschau-Angaben (Open Graph) für geteilte Links
 const escapeHtml=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 app.get(['/','/index.html'],(req,res,next)=>{
  try {
   const data=loadData(root,env);
   let title='Hydranten Wien',description='Karte aller Hydranten in Wien aus dem offenen Datensatz der Stadt Wien. Nächste Hydranten zu Fuß finden und Navigation starten.';
   const h=data.byId.get(String(req.query.h||''));
   const d=data.districts.find(x=>String(x.nr)===String(req.query.bezirk||''));
   if(h){const z=districtOf(data,h);title=`Hydrant ${h.id}${z?` · ${z.nr}. ${z.name}`:''} – Hydranten Wien`;description=`Standort ${h.lat.toFixed(5)}, ${h.lng.toFixed(5)}. Auf der Karte öffnen und zu Fuß navigieren.`;}
   else if(d){title=`Hydranten im ${d.nr}. Bezirk, ${d.name} – Hydranten Wien`;description=`${new Intl.NumberFormat('de-AT').format(d.count)} Hydranten im ${d.nr}. Bezirk auf der Karte.`;}
   const base=(env.PUBLIC_URL||`${req.protocol}://${req.get('host')}`).replace(/\/$/,'');
   const url=base+req.originalUrl;
   const html=data.index
    .replace(/<title>[^<]*<\/title>/,`<title>${escapeHtml(title)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*/,`$1${escapeHtml(title)}`)
    .replace(/(<meta property="og:description" content=")[^"]*/,`$1${escapeHtml(description)}`)
    .replace(/(<meta name="description" content=")[^"]*/,`$1${escapeHtml(description)}`)
    .replace(/(<meta property="og:image" content=")[^"]*/,`$1${escapeHtml(base)}/og-image.png`)
    .replace('<meta property="og:site_name"',`<meta property="og:url" content="${escapeHtml(url)}">\n<meta property="og:site_name"`);
   res.set('Cache-Control','no-cache').type('html').send(html);
  } catch(err){next(err);}
 });
 app.get('/sw.js',(req,res,next)=>{res.set({'Cache-Control':'no-cache','Service-Worker-Allowed':'/'});next();});
 app.get('/manifest.webmanifest',(req,res,next)=>{res.type('application/manifest+json');next();});
 app.get('/data/:name',(req,res,next)=>{
  if(!['hydrants.json','districts.geojson'].includes(req.params.name)) return next();
  res.sendFile(dataFile(root,req.params.name,env),{headers:{'Cache-Control':'no-cache'}},err=>err&&next(err));
 });
 app.use('/vendor/leaflet',express.static(path.join(root,'node_modules/leaflet/dist')));
 app.use('/vendor/cluster',express.static(path.join(root,'node_modules/leaflet.markercluster/dist')));
 app.use(express.static(path.join(root,'public'),{extensions:['html'],setHeaders(res,file,stat){
  // HTML, Service Worker und Manifest immer neu prüfen; versionierte Dateien dürfen lange im Cache bleiben
  if(/\.(html|webmanifest)$/.test(file)||file.endsWith('sw.js')) res.set('Cache-Control','no-cache');
  else if(/\.(js|css)$/.test(file)&&res.req.query.v) res.set('Cache-Control','public, max-age=31536000, immutable');
  else if(file.includes(path.join('public','data'))) res.set('Cache-Control','no-cache');
 }}));
 app.use((req,res)=>res.status(404).sendFile(path.join(root,'public/404.html')));
 app.use((err,req,res,next)=>res.status(err.status===413?413:400).json({error:'Ungültige Anfrage.'}));
 return app;
}
if(process.argv[1]===fileURLToPath(import.meta.url)) createApp().listen(Number(process.env.PORT||3000),process.env.HOST||'0.0.0.0',()=>console.log('Hydrantenkarte: http://localhost:'+(process.env.PORT||3000)));
