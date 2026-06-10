import { useState, useRef, useCallback, useEffect } from "react";

// ─── SESSION COUNTER ──────────────────────────────────────────────────────────
let SESSION_COUNTER = 0;
function nextSessionId() { SESSION_COUNTER += 1; return String(SESSION_COUNTER).padStart(4,"0"); }

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const MAX_ENCRYPT_SIZE_MB = 20;
const STORAGE_KEY = "sf_debug_sessions_v2";

// ─── AES-256-GCM ENCRYPTION ──────────────────────────────────────────────────
async function generateKey() { return crypto.subtle.generateKey({name:"AES-GCM",length:256},true,["encrypt","decrypt"]); }
async function exportKeyHex(key) { const raw=await crypto.subtle.exportKey("raw",key); return Array.from(new Uint8Array(raw)).map(b=>b.toString(16).padStart(2,"0")).join(""); }
async function encryptText(text,key) { const iv=crypto.getRandomValues(new Uint8Array(12)); const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},key,new TextEncoder().encode(text)); const out=new Uint8Array(12+ct.byteLength);out.set(iv,0);out.set(new Uint8Array(ct),12);return out; }
async function importKeyHex(hex) { const bytes=new Uint8Array(hex.match(/.{1,2}/g).map(b=>parseInt(b,16))); return crypto.subtle.importKey("raw",bytes,{name:"AES-GCM"},false,["decrypt"]); }
async function decryptBytes(encBytes,keyHex) { const key=await importKeyHex(keyHex.trim()); const iv=encBytes.slice(0,12),ct=encBytes.slice(12); const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},key,ct); return new TextDecoder().decode(plain); }

// ─── ZIP BUILDER ──────────────────────────────────────────────────────────────
function buildZip(files) {
  const T=new Uint32Array(256);for(let i=0;i<256;i++){let c=i;for(let j=0;j<8;j++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);T[i]=c;}
  function crc32(d){let c=0xFFFFFFFF;for(let i=0;i<d.length;i++)c=T[(c^d[i])&0xFF]^(c>>>8);return(c^0xFFFFFFFF)>>>0;}
  function u16(n){return[n&0xff,(n>>8)&0xff];} function u32(n){return[n&0xff,(n>>8)&0xff,(n>>16)&0xff,(n>>24)&0xff];} function str(s){return Array.from(new TextEncoder().encode(s));}
  const now=new Date(),dt=((now.getFullYear()-1980)<<9)|((now.getMonth()+1)<<5)|now.getDate(),tm=(now.getHours()<<11)|(now.getMinutes()<<5)|(now.getSeconds()>>1);
  const locals=[],central=[],offsets=[];let off=0;
  for(const f of files){const nm=str(f.name),crc=crc32(f.data);const lh=[0x50,0x4B,0x03,0x04,0x14,0x00,0x00,0x00,0x08,0x00,...u16(tm),...u16(dt),...u32(crc),...u32(f.data.length),...u32(f.data.length),...u16(nm.length),0x00,0x00,...nm];offsets.push(off);locals.push([...lh,...Array.from(f.data)]);off+=lh.length+f.data.length;central.push([0x50,0x4B,0x01,0x02,0x14,0x00,0x14,0x00,0x00,0x00,0x08,0x00,...u16(tm),...u16(dt),...u32(crc),...u32(f.data.length),...u32(f.data.length),...u16(nm.length),0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,...u32(offsets[offsets.length-1]),...nm]);}
  const cd=central.flat(),cds=cd.length;const eocd=[0x50,0x4B,0x05,0x06,0x00,0x00,0x00,0x00,...u16(files.length),...u16(files.length),...u32(cds),...u32(off),0x00,0x00];
  return new Uint8Array([...locals.flat(),...cd,...eocd]);
}

async function encryptAndDownload(session, serial) {
  const deletionDate=new Date(Date.now()+30*24*60*60*1000).toISOString().split("T")[0];
  const logContent=session.entries.map(e=>`[${e.timestamp||""}][${e.level}][${e.module||e.namespace||""}] ${e.message}${e.stackTrace?.length?"\n"+e.stackTrace.join("\n"):""}`).join("\n");
  const plaintext=[`SESSION: SF-DEBUG-${serial}`,`FILE: ${session.fileName}`,`LOG TYPE: ${session.type.toUpperCase()}`,`ENCRYPTED: ${new Date().toISOString()}`,`DELETE AFTER: ${deletionDate}`,`TOTAL ENTRIES: ${session.entries.length}`,`ERRORS: ${session.entries.filter(e=>e.classification?.sev==="error").length}`,`WARNINGS: ${session.entries.filter(e=>e.classification?.sev==="warn").length}`,"---LOG CONTENT---",logContent].join("\n");
  const key=await generateKey();const keyHex=await exportKeyHex(key);const encBytes=await encryptText(plaintext,key);
  const keyTxt=[`D-Bugger - Decryption Key`,`======================================`,`Session ID  : SF-DEBUG-${serial}`,`Log File    : ${session.fileName}`,`Algorithm   : AES-256-GCM`,`Created     : ${new Date().toISOString()}`,`Delete After: ${deletionDate}`,``,`KEY (hex):`,keyHex,``,`To decrypt: Open D-Bugger -> Decrypt tab,`,`upload SF-DEBUG-${serial}.enc and this .key file.`].join("\n");
  const zip=buildZip([{name:`SF-DEBUG-${serial}.enc`,data:encBytes},{name:`SF-DEBUG-${serial}.key`,data:new TextEncoder().encode(keyTxt)}]);
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([zip],{type:"application/zip"}));a.download=`SF-DEBUG-${serial}.zip`;a.click();
}

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg:"#0f1117",panel:"#161b27",border:"#1e2736",accent:"#3b82f6",
  error:"#ef4444",warn:"#f59e0b",success:"#10b981",text:"#e2e8f0",
  muted:"#64748b",highlight:"#1e3a5f",dark:"#0d1118",
};

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────
function Badge({ type, children }) {
  const m={error:{bg:"#3b0a0a",color:"#ef4444",border:"#7f1d1d"},warn:{bg:"#3b2a00",color:"#f59e0b",border:"#78350f"},success:{bg:"#022c1a",color:"#10b981",border:"#064e3b"},info:{bg:"#0c1a3b",color:"#60a5fa",border:"#1e3a5f"},sync:{bg:"#1a0a2e",color:"#a78bfa",border:"#4c1d95"},auth:{bg:"#1a0020",color:"#f472b6",border:"#831843"},db:{bg:"#0a1a0a",color:"#34d399",border:"#064e3b"},mount:{bg:"#0a1a2a",color:"#38bdf8",border:"#0c4a6e"},network:{bg:"#0a1a1a",color:"#2dd4bf",border:"#0f766e"},outlook:{bg:"#1a1a00",color:"#facc15",border:"#854d0e"},iis:{bg:"#1a0a1a",color:"#e879f9",border:"#7e22ce"},szc:{bg:"#0a1a0a",color:"#4ade80",border:"#166534"},security:{bg:"#1a0a00",color:"#fb923c",border:"#7c2d12"}};
  const s=m[type]||m.info;
  return <span style={{background:s.bg,color:s.color,border:`1px solid ${s.border}`,borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:700,letterSpacing:0.4,fontFamily:"monospace",whiteSpace:"nowrap"}}>{children}</span>;
}

function UploadZone({ onFile, accept, label, icon, error }) {
  const [drag,setDrag]=useState(false);const ref=useRef();
  return (
    <div>
      <div onClick={()=>ref.current.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);const f=e.dataTransfer.files[0];if(f)onFile(f);}}
        style={{border:`2px dashed ${error?"#ef4444":drag?C.accent:C.border}`,borderRadius:12,padding:"36px 24px",textAlign:"center",cursor:"pointer",background:drag?"#0c1a3b":C.panel,transition:"all 0.2s"}}>
        <div style={{fontSize:32,marginBottom:10}}>{icon}</div>
        <div style={{color:C.text,fontWeight:600,marginBottom:4}}>{label}</div>
        <div style={{color:C.muted,fontSize:12}}>Drag and drop or click to browse · {accept}</div>
        <input ref={ref} type="file" accept={accept} style={{display:"none"}} onChange={e=>e.target.files[0]&&onFile(e.target.files[0])}/>
      </div>
      {error&&<div style={{marginTop:8,padding:"8px 12px",background:"#1a0808",border:"1px solid #7f1d1d",borderRadius:6,color:"#fca5a5",fontSize:12}}>⚠ {error}</div>}
    </div>
  );
}

function StatBar({ items }) {
  return (
    <div style={{display:"flex",gap:16,padding:"10px 16px",flexWrap:"wrap",background:C.panel,borderRadius:8,border:`1px solid ${C.border}`,marginBottom:14}}>
      {items.map(s=><div key={s.label} style={{textAlign:"center",minWidth:44}}><div style={{fontSize:18,fontWeight:700,color:s.color,fontFamily:"monospace"}}>{s.value}</div><div style={{fontSize:10,color:C.muted,textTransform:"uppercase",letterSpacing:0.7}}>{s.label}</div></div>)}
    </div>
  );
}

function CopyBtn({ text }) {
  const [ok,setOk]=useState(false);
  return <button onClick={()=>{navigator.clipboard.writeText(text);setOk(true);setTimeout(()=>setOk(false),2000);}} style={{background:ok?"#022c1a":C.panel,color:ok?C.success:C.muted,border:`1px solid ${ok?C.success:C.border}`,borderRadius:6,padding:"4px 12px",cursor:"pointer",fontSize:11,fontWeight:600,transition:"all 0.2s"}}>{ok?"Copied!":"Copy"}</button>;
}

function AiBox({ onAnalyze, loading, analysis, disabled, disabledMsg, retryCount }) {
  return (
    <div style={{marginBottom:14}}>
      <button onClick={onAnalyze} disabled={loading||disabled}
        style={{background:loading||disabled?C.border:C.accent,color:"#fff",border:"none",borderRadius:8,padding:"10px 20px",cursor:loading||disabled?"not-allowed":"pointer",fontWeight:600,fontSize:13,width:"100%"}}>
        {loading?"🔄 Analyzing...":disabled?disabledMsg:"🤖 AI Root Cause Analysis and Next Steps"}
        {retryCount>0&&!loading&&<span style={{marginLeft:8,fontSize:11,opacity:0.7}}>↺ Retry</span>}
      </button>
      {analysis&&!analysis.startsWith("__ERR__:")&&(
        <div style={{marginTop:10,padding:14,background:"#0c1a3b",border:`1px solid ${C.accent}`,borderRadius:8,color:C.text,fontSize:13,lineHeight:1.8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={{color:C.accent,fontWeight:700}}>AI Analysis and Next Steps</span>
            <CopyBtn text={analysis}/>
          </div>
          <div style={{whiteSpace:"pre-wrap"}}>{analysis}</div>
        </div>
      )}
      {analysis?.startsWith("__ERR__:")&&(
        <div style={{marginTop:10,padding:12,background:"#1a0808",border:"1px solid #7f1d1d",borderRadius:8,color:"#fca5a5",fontSize:12,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
          <span>⚠ {analysis.slice(8)}</span>
          <button onClick={onAnalyze} disabled={loading} style={{background:"#3b0a0a",color:"#ef4444",border:"1px solid #7f1d1d",borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:11,flexShrink:0}}>Retry</button>
        </div>
      )}
    </div>
  );
}

// ─── AI CALL HELPER (routes through Netlify serverless proxy) ────────────────
function aiErr(err) {
  return `__ERR__:${err?.message || "AI analysis failed. Check your connection and try again."}`;
}

async function callAI(system, userMsg, max_tokens = 1400) {
  const res = await fetch('/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, userMsg, max_tokens })
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Server error: HTTP ${res.status}`);
  if (d.error) throw new Error(d.error);
  return d.text || 'No analysis returned.';
}

// ─── LOG PARSERS ──────────────────────────────────────────────────────────────
const SF_WIN_RE  = /^(\d{4}-\d{2}-\d{2}T[\d:.]+)\|(INFO|WARN|ERROR|DEBUG)\|\|([^|]*)\|\s*(.*)/;
const SF_OLP_RE  = /^(\d{4}-\d{2}-\d{2}T\s*[\d:.]+)\|(INFO|WARN|ERROR|DEBUG)\|(.*)/;
const IIS_RE     = /^(\d{4}-\d{2}-\d{2})\s+([\d:]+)\s+\S+\s+\S+\s+\S+/;
const SZC_RE     = /^(\d{4}-\d{2}-\d{2}\s[\d:]+),(\d+)\s+\[(\d+)\]\s+(INFO|WARN|ERROR|DEBUG|FATAL)\s+([\w.]+)\s+(?:\[([^\]]+)\]\s+)?-\s+(.*)/;

const WIN_CATS={auth:["LoginService","OIDCAuthClient","CredentialStorageProvider","CredentialsForSFClients"],sync:["CRAWLER","REFRESH","DIFF","SyncMigrationService","ItemService","ENS","SubscriptionClient"],mount:["MOUNT","WINFSPMountPoint","WINFSP","FilesystemProvider"],db:["DbVacuumService","DatabaseManager","LKR"],network:["Connection","PROXYHANDLER"],app:["App","SfWindowsApp","AppStateMaintainer","UpdateService","COMServer","PackageManagerService"],gpo:["GPO"]};
const OLP_CATS={auth:["LoginService","OAuthTokenProvider","SamlAuthTokenProvider"],network:["ConnectionService"],upload:["UploadService","AttachmentService"],app:["Startup","AddinModule","LifecycleService","WebView2Service","UpdateService"],settings:["SettingsProvider"],ui:["ExplorerService","InspectorService"]};
const SZC_CATS={auth:["AuthenticationModule","AuthorizationModule"],health:["HealthStats"],upload:["UploadModule","ChunkedUploadModule"],download:["DownloadModule"],storage:["StorageModule","FileStorageProvider"],network:["NetworkModule"],app:["StorageCenter","Application","Startup"],security:["SecurityModule"]};

function getCat(module,cats){for(const[cat,mods]of Object.entries(cats)){if(mods.some(m=>module.includes(m)))return cat;}return "other";}
function getModule(text){const m=text.match(/^\[([^\]]+)\]/);return m?m[1]:"";}

const WIN_PAT=[
  {re:/no such column|sqlite3_exception|SQLitePCL/i,sev:"error",label:"DB Error"},{re:/Could not get max of ROWID/i,sev:"error",label:"DB ROWID"},
  {re:/Should vacuum/i,sev:"warn",label:"DB Fragmented"},{re:/Mount Success/i,sev:"info",label:"Mount OK"},
  {re:/mount.*fail/i,sev:"error",label:"Mount Failed"},{re:/File does not exist/i,sev:"warn",label:"File Missing"},
  {re:/refresh OIDC token succeeded/i,sev:"info",label:"Auth OK"},{re:/oidc.*fail|token.*fail/i,sev:"error",label:"Auth Failed"},
  {re:/Login finished successfully/i,sev:"info",label:"Login OK"},{re:/ENS.*Connected/i,sev:"info",label:"ENS OK"},
  {re:/ENS.*fail/i,sev:"error",label:"ENS Failed"},{re:/REMOTE DELETE/i,sev:"warn",label:"Remote Delete"},
  {re:/REMOTE CREATE/i,sev:"info",label:"Remote Create"},{re:/REFRESH.*succeeded/i,sev:"info",label:"Refresh OK"},
  {re:/REFRESH.*fail/i,sev:"error",label:"Refresh Failed"},{re:/NetworkAvailable/i,sev:"info",label:"Network OK"},
  {re:/DriveMounted/i,sev:"info",label:"Drive Mounted"},{re:/upload.*fail/i,sev:"error",label:"Upload Failed"},
];
const OLP_PAT=[
  {re:/Can't read settings\.cfg/i,sev:"error",label:"Settings Missing"},{re:/Failed to connect to ShareFile/i,sev:"error",label:"Connection Failed"},
  {re:/remote name could not be resolved/i,sev:"error",label:"DNS Failure"},{re:/Unable to connect to the remote server/i,sev:"error",label:"Server Unreachable"},
  {re:/connection attempt failed/i,sev:"error",label:"Socket Timeout"},{re:/True -> False/i,sev:"warn",label:"Network Dropped"},
  {re:/False -> True/i,sev:"info",label:"Network Restored"},{re:/Obtained OAuth token/i,sev:"info",label:"OAuth OK"},
  {re:/login success/i,sev:"info",label:"Login OK"},{re:/AddinDisabled/i,sev:"warn",label:"Addin Disabled"},
  {re:/upload.*fail/i,sev:"error",label:"Upload Failed"},{re:/WebView2.*Sufficient\? False/i,sev:"error",label:"WebView2 Outdated"},
];
const SZC_PAT=[
  {re:/Health Check Succeeded/i,sev:"info",label:"Health OK"},{re:/Health Check Failed/i,sev:"error",label:"Health Failed"},
  {re:/Bad request/i,sev:"error",label:"Bad Request"},{re:/Good hparam/i,sev:"info",label:"Auth OK"},
  {re:/Bad hparam|Invalid hparam/i,sev:"error",label:"Auth Failed"},{re:/upload.*complete/i,sev:"info",label:"Upload OK"},
  {re:/upload.*fail|chunk.*fail/i,sev:"error",label:"Upload Failed"},{re:/download.*fail/i,sev:"error",label:"Download Failed"},
  {re:/disk.*full|out of space/i,sev:"error",label:"Disk Full"},{re:/access.*denied|permission.*denied/i,sev:"error",label:"Access Denied"},
  {re:/timeout|timed out/i,sev:"error",label:"Timeout"},{re:/connection.*refused/i,sev:"error",label:"Conn Refused"},
  {re:/unhandled exception/i,sev:"error",label:"Exception"},{re:/out of memory/i,sev:"error",label:"Out of Memory"},
];
const PROBE_RE=/\/owa\/|\/cgi-bin\/|\/geoserver\/|\/Dr0v|\/\.git|\/\.env|\/_layouts|\/spinstall|\/auth\/logon/i;

function classify(level,text,patterns){
  for(const p of patterns){if(p.re.test(text)){if(level==="ERROR")return{sev:"error",label:p.label};if(level==="WARN")return{sev:"warn",label:p.label};return{sev:p.sev,label:p.label};}}
  if(level==="ERROR")return{sev:"error",label:"Error"};if(level==="WARN")return{sev:"warn",label:"Warning"};return{sev:"info",label:"Info"};
}

function detectType(text){
  const lines=text.split("\n").filter(l=>l.trim()&&!l.startsWith("#")).slice(0,5);
  for(const l of lines){if(SF_WIN_RE.test(l))return "windows";if(SZC_RE.test(l))return "szc";if(SF_OLP_RE.test(l))return "outlook";if(IIS_RE.test(l))return "iis";}
  if(text.includes("StorageCenter."))return "szc";if(text.includes("#Software: Microsoft Internet Information"))return "iis";return "generic";
}

function parseWin(text){const entries=[];let cur=null;let n=0;for(const raw of text.split("\n")){n++;const t=raw.trim();if(!t)continue;const m=t.match(SF_WIN_RE);if(m){if(cur)entries.push(cur);const[,ts,lv,tid,msg]=m;const mod=getModule(msg);cur={id:n,lineNum:n,timestamp:ts,level:lv,threadId:tid.trim(),module:mod,namespace:"",message:msg.trim(),stackTrace:[],classification:classify(lv,msg,WIN_PAT),category:getCat(mod,WIN_CATS),isHealthCheck:false,isProbe:false};}else if(cur)cur.stackTrace.push(t);}if(cur)entries.push(cur);return entries;}

function parseOlp(text){const entries=[];let cur=null;let n=0;for(const raw of text.split("\n")){n++;const t=raw.trim();if(!t)continue;const m=t.match(SF_OLP_RE);if(m){if(cur)entries.push(cur);const[,ts,lv,rest]=m;const mod=getModule(rest);cur={id:n,lineNum:n,timestamp:ts.replace(" ","T"),level:lv,threadId:"",module:mod,namespace:"",message:rest.trim(),stackTrace:[],classification:classify(lv,rest,OLP_PAT),category:getCat(mod,OLP_CATS),isHealthCheck:false,isProbe:false};}else if(cur)cur.stackTrace.push(t);}if(cur)entries.push(cur);return entries;}

function parseIis(text){
  let fields=["date","time","s-ip","cs-method","cs-uri-stem","cs-uri-query","s-port","cs-username","c-ip","cs-useragent","sc-status","sc-substatus","sc-win32-status","time-taken"];
  const entries=[];let n=0;
  for(const raw of text.split("\n")){n++;const t=raw.trim();if(!t)continue;if(t.startsWith("#Fields:")){fields=t.replace("#Fields:","").trim().split(/\s+/);continue;}if(t.startsWith("#"))continue;
    const parts=t.split(/\s+/);if(parts.length<5)continue;const obj={};fields.forEach((f,i)=>{obj[f]=parts[i]||"-";});
    const date=obj["date"]||"",time=obj["time"]||"",method=obj["cs-method"]||"-",uri=obj["cs-uri-stem"]||"-",status=parseInt(obj["sc-status"])||0,sub=obj["sc-substatus"]||"0",tt=parseInt(obj["time-taken"])||0,cip=obj["c-ip"]||"-";
    const issues=[];if(status>=500)issues.push({sev:"error",label:`5xx (${status})`});else if(status===401)issues.push({sev:"error",label:"401 Unauth"});else if(status===403)issues.push({sev:"error",label:"403 Forbidden"});else if(status>=400)issues.push({sev:"error",label:`4xx (${status})`});else if(status>=300)issues.push({sev:"warn",label:`${status} Redirect`});if(tt>10000)issues.push({sev:"error",label:`Very slow ${(tt/1000).toFixed(1)}s`});else if(tt>3000)issues.push({sev:"warn",label:`Slow ${(tt/1000).toFixed(1)}s`});
    let uriCat=null;if(/\/sf\/v3\//i.test(uri))uriCat={cat:"api",label:"SF API"};else if(/\/upload|\/chunk/i.test(uri))uriCat={cat:"upload",label:"Upload"};else if(/\/download|\/dl\//i.test(uri))uriCat={cat:"download",label:"Download"};else if(/\/oauth|\/saml|\/login|\/auth/i.test(uri))uriCat={cat:"auth",label:"Auth"};
    const cls=issues.length>0?{sev:issues[0].sev,label:issues[0].label}:{sev:"info",label:"OK"};
    entries.push({id:n,lineNum:n,timestamp:`${date}T${time}`,level:cls.sev==="error"?"ERROR":cls.sev==="warn"?"WARN":"INFO",threadId:"",module:"IIS",namespace:"IIS",message:`${method} ${uri} ${status} ${tt}ms`,uri,method,status,fullStatus:sub&&sub!=="-"&&sub!=="0"?`${status}.${sub}`:`${status}`,timeTaken:tt,clientIp:cip,uriCat,stackTrace:[],classification:cls,category:uriCat?.cat||"other",isHealthCheck:false,isProbe:false,issues});
  }return entries;
}

function parseSzc(text){const entries=[];let cur=null;let n=0;for(const raw of text.split("\n")){n++;const t=raw.trim();if(!t)continue;const m=t.match(SZC_RE);if(m){if(cur)entries.push(cur);const[,dt,,tid,lv,ns,rctx,msg]=m;const parts=ns.split(".");const mod=parts[parts.length-1]||ns;const isProbe=PROBE_RE.test(msg);const isHC=/healthstats\.ashx.*healthcheck|Health Check Succeeded|Good hparam.*healthstats/i.test(msg);let cls=classify(lv,msg,SZC_PAT);if(isProbe&&lv==="ERROR")cls={sev:"error",label:"Security Probe"};cur={id:n,lineNum:n,timestamp:dt.replace(" ","T"),level:lv,threadId:tid,module:mod,namespace:ns,requestCtx:rctx||"",message:msg.trim(),stackTrace:[],classification:cls,category:isProbe?"security":getCat(mod,SZC_CATS),isHealthCheck:isHC,isProbe};}else if(cur)cur.stackTrace.push(t);}if(cur)entries.push(cur);return entries;}

function parseGeneric(text){return text.split("\n").filter(l=>l.trim()).map((line,i)=>{let sev="info",label="Info";if(/\berror\b|\bfail\b|\bexception\b/i.test(line)){sev="error";label="Error";}else if(/\bwarn\b/i.test(line)){sev="warn";label="Warning";}return{id:i,lineNum:i+1,timestamp:"",level:sev.toUpperCase(),threadId:"",module:"",namespace:"",message:line,stackTrace:[],classification:{sev,label},category:"other",isHealthCheck:false,isProbe:false};});}

function parseLog(file,text){
  const type=detectType(text);
  const entries=type==="windows"?parseWin(text):type==="outlook"?parseOlp(text):type==="iis"?parseIis(text):type==="szc"?parseSzc(text):parseGeneric(text);
  return{type,entries,fileName:file.name,id:Date.now()+Math.random(),serial:nextSessionId()};
}

// ─── LABEL MAPS ───────────────────────────────────────────────────────────────
const CAT_LABELS={auth:"Auth",sync:"Sync",mount:"Mount",db:"Database",network:"Network",upload:"Upload",download:"Download",api:"API",app:"App",gpo:"GPO",settings:"Settings",ui:"UI",health:"Health",storage:"Storage",security:"Security",other:"Other"};
const CAT_BADGE={auth:"auth",sync:"sync",mount:"mount",db:"db",network:"network",upload:"sync",download:"info",api:"iis",app:"info",gpo:"warn",settings:"warn",health:"szc",storage:"szc",security:"security",other:"info"};
const TYPE_LABEL={windows:"Windows App",outlook:"Outlook Plugin",iis:"IIS Log",szc:"StorageCenter",generic:"Generic Log"};
const TYPE_COLOR={windows:"#38bdf8",outlook:"#facc15",iis:"#e879f9",szc:"#4ade80",generic:"#60a5fa"};
const TYPE_BADGE_TYPE={windows:"mount",outlook:"outlook",iis:"iis",szc:"szc",generic:"info"};

const AI_SYS={
  windows:`You are a senior ShareFile support engineer expert in ShareFile for Windows (WinFsp, CBFS sync, OIDC auth, ENS, SQLite databases). Analyze log errors and give:\n1. SUMMARY (2-3 sentences)\n2. ROOT CAUSE with module references\n3. NEXT STEPS (numbered)\n4. ESCALATION NOTE`,
  outlook:`You are a senior ShareFile support engineer expert in the ShareFile Outlook plugin (ConnectionService, OAuthTokenProvider, SamlAuthTokenProvider, SettingsProvider, WebView2). Analyze log errors and give:\n1. SUMMARY (2-3 sentences)\n2. ROOT CAUSE with module references\n3. NEXT STEPS (numbered)\n4. ESCALATION NOTE`,
  iis:`You are a senior ShareFile infrastructure engineer expert in ShareFile on-premise IIS configuration. Analyze IIS log issues and give:\n1. SUMMARY (2-3 sentences)\n2. ROOT CAUSE referencing URIs/status codes\n3. NEXT STEPS (numbered, IIS-specific)\n4. ESCALATION NOTE`,
  szc:`You are a senior ShareFile Storage Zone Controller engineer. You know StorageCenter.Modules.AuthenticationModule, HealthStats (5-min healthstats.ashx polling), upload/download chunked transfer, and security probes. IMPORTANT: Bad requests to /owa/, /cgi-bin/luci/, /geoserver/, /_layouts/, /Dr0v are EXTERNAL SECURITY PROBES not ShareFile errors. Analyze and give:\n1. SUMMARY (distinguish app errors from probes)\n2. ROOT CAUSE with namespace references\n3. NEXT STEPS (numbered)\n4. SECURITY NOTE on any probe patterns\n5. ESCALATION NOTE`,
  generic:`You are a senior ShareFile support engineer. Analyze these log errors and give:\n1. SUMMARY\n2. ROOT CAUSE\n3. NEXT STEPS (numbered)\n4. ESCALATION NOTE`,
};



// ─── LOG SESSION VIEWER ───────────────────────────────────────────────────────
function LogSession({ session }) {
  const {entries,type,fileName}=session;
  const [filter,setFilter]=useState("issues");
  const [catFilter,setCatFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [threadFilter,setThreadFilter]=useState("");
  const [timeFrom,setTimeFrom]=useState("");
  const [timeTo,setTimeTo]=useState("");
  const [hideHC,setHideHC]=useState(type==="szc");
  const [aiAnalysis,setAiAnalysis]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [retryCount,setRetryCount]=useState(0);
  const [expanded,setExpanded]=useState(null);
  const [encLoading,setEncLoading]=useState(false);
  const [encDone,setEncDone]=useState(false);
  const [serial]=useState(()=>nextSessionId());

  const errE=entries.filter(e=>e.classification.sev==="error"&&!e.isHealthCheck);
  const wrnE=entries.filter(e=>e.classification.sev==="warn"&&!e.isHealthCheck);
  const cats=["all",...Object.keys(CAT_LABELS).filter(c=>entries.some(e=>e.category===c))];
  const tids=[...new Set(entries.map(e=>e.threadId).filter(Boolean))].slice(0,80);

  const filtered=entries.filter(e=>{
    const cv=e.classification;
    if(hideHC&&e.isHealthCheck)return false;
    const mf=filter==="issues"?cv.sev!=="info":filter==="errors"?cv.sev==="error":filter==="warnings"?cv.sev==="warn":filter==="info"?cv.sev==="info":filter==="security"?e.isProbe:true;
    const cf=catFilter==="all"||e.category===catFilter;
    const sf=search===""||[e.message,e.module,e.namespace||"",e.requestCtx||"",e.threadId].join(" ").toLowerCase().includes(search.toLowerCase());
    const tf=threadFilter===""||e.threadId===threadFilter;
    const ts=e.timestamp;const fo=timeFrom===""||!ts||ts>=timeFrom.replace("T"," ");const to=timeTo===""||!ts||ts<=timeTo.replace("T"," ");
    return mf&&cf&&sf&&tf&&fo&&to;
  });

  const analyze=async()=>{
    setAiLoading(true);setAiAnalysis("");
    const prob=[...errE,...wrnE].slice(0,30).map(e=>{let t=`[${e.timestamp}][${e.level}][${e.namespace||e.module||"?"}]${e.requestCtx?` [${e.requestCtx}]`:""} ${e.message}`;if(e.stackTrace.length)t+="\n  "+e.stackTrace.slice(0,3).join(" | ");return t;}).join("\n\n");
    try{const r=await callAI(AI_SYS[type]||AI_SYS.generic,`Analyze these ShareFile ${TYPE_LABEL[type]||type} log issues:\n\n${prob}`);setAiAnalysis(r);setRetryCount(0);}
    catch(e){setAiAnalysis(aiErr(e));setRetryCount(c=>c+1);}
    setAiLoading(false);
  };

  const handleEncrypt=async()=>{
    const sizeMB=entries.reduce((a,e)=>a+e.message.length,0)/1024/1024;
    if(sizeMB>MAX_ENCRYPT_SIZE_MB){alert(`Log is ~${sizeMB.toFixed(1)}MB. Max for encryption is ${MAX_ENCRYPT_SIZE_MB}MB to avoid browser crashes. Please use a smaller log file.`);return;}
    setEncLoading(true);
    try{await encryptAndDownload(session,serial);setEncDone(true);setTimeout(()=>setEncDone(false),3000);}
    catch(e){alert("Encryption failed: "+e.message);}
    setEncLoading(false);
  };

  const sevBg=s=>s==="error"?"#180808":s==="warn"?"#181208":"transparent";
  const sevTx=s=>s==="error"?"#fca5a5":s==="warn"?"#fcd34d":s==="info"?"#93c5fd":C.muted;
  const sevFilters=type==="szc"?["issues","errors","warnings","security","info","all"]:["issues","errors","warnings","info","all"];

  const statItems=type==="iis"?[
    {label:"Total",value:entries.length,color:C.text},{label:"5xx",value:entries.filter(e=>e.status>=500).length,color:C.error},
    {label:"4xx",value:entries.filter(e=>e.status>=400&&e.status<500).length,color:C.warn},{label:"Slow>3s",value:entries.filter(e=>e.timeTaken>3000).length,color:"#f59e0b"},
    {label:"Upload",value:entries.filter(e=>e.category==="upload").length,color:"#a78bfa"},{label:"Auth Err",value:entries.filter(e=>e.status===401||e.status===403).length,color:"#f472b6"},
  ]:type==="szc"?[
    {label:"Total",value:entries.length,color:C.text},{label:"Health",value:entries.filter(e=>e.isHealthCheck).length,color:"#4ade80"},
    {label:"Errors",value:errE.length,color:C.error},{label:"Warns",value:wrnE.length,color:C.warn},
    {label:"Probes",value:entries.filter(e=>e.isProbe).length,color:"#fb923c"},{label:"Upload Err",value:entries.filter(e=>e.category==="upload"&&e.classification.sev==="error").length,color:"#a78bfa"},
  ]:type==="windows"?[
    {label:"Total",value:entries.length,color:C.text},{label:"Errors",value:errE.length,color:C.error},{label:"Warns",value:wrnE.length,color:C.warn},
    {label:"Auth",value:entries.filter(e=>e.category==="auth"&&e.classification.sev!=="info").length,color:"#f472b6"},{label:"Sync",value:entries.filter(e=>e.category==="sync"&&e.classification.sev!=="info").length,color:"#a78bfa"},
    {label:"DB",value:entries.filter(e=>e.category==="db"&&e.classification.sev!=="info").length,color:"#34d399"},{label:"Mount Err",value:entries.filter(e=>e.category==="mount"&&e.classification.sev==="error").length,color:"#38bdf8"},
  ]:[
    {label:"Total",value:entries.length,color:C.text},{label:"Errors",value:errE.length,color:C.error},{label:"Warns",value:wrnE.length,color:C.warn},
    {label:"Auth",value:entries.filter(e=>e.category==="auth"&&e.classification.sev!=="info").length,color:"#f472b6"},{label:"Network",value:entries.filter(e=>e.category==="network"&&e.classification.sev!=="info").length,color:"#2dd4bf"},
    {label:"Upload",value:entries.filter(e=>e.category==="upload"&&e.classification.sev!=="info").length,color:"#a78bfa"},
  ];

  return (
    <div>
      {/* Header row */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
          <span style={{color:C.muted,fontSize:12}}>{fileName} — {entries.length.toLocaleString()} entries</span>
          <Badge type={TYPE_BADGE_TYPE[type]||"info"}>{TYPE_LABEL[type]||type}</Badge>
          <span style={{color:C.muted,fontSize:10,fontFamily:"monospace"}}>SF-DEBUG-{serial}</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          {type==="szc"&&<label style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",fontSize:11,color:C.muted}}><input type="checkbox" checked={hideHC} onChange={e=>setHideHC(e.target.checked)} style={{cursor:"pointer"}}/> Hide health checks</label>}
          <button onClick={()=>{
            const body=`Session: SF-DEBUG-${serial}\nLog Type: ${type}\nFile: ${fileName}\nIssue: [Describe what was misclassified or incorrect]\nLine/Entry: [Reference the line number if applicable]`;
            window.open(`mailto:support-tools-feedback@sharefile.com?subject=Parse Issue - SF Debug Tool v1.0&body=${encodeURIComponent(body)}`);
          }} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:5,padding:"4px 10px",cursor:"pointer",fontSize:10}} title="Report a parsing or classification issue with this log">⚑ Report Issue</button>
          <button onClick={handleEncrypt} disabled={encLoading}
            style={{background:encDone?"#022c1a":encLoading?"#1e2736":"#1a2e1a",color:encDone?"#10b981":encLoading?C.muted:"#4ade80",border:`1px solid ${encDone?"#10b981":encLoading?C.border:"#166534"}`,borderRadius:6,padding:"5px 14px",cursor:encLoading?"not-allowed":"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",gap:5}}>
            {encDone?"✓ Downloaded!":encLoading?"Encrypting...":"🔒 Encrypt & Download"}
          </button>
        </div>
      </div>

      <StatBar items={statItems}/>
      <AiBox onAnalyze={analyze} loading={aiLoading} analysis={aiAnalysis} disabled={errE.length+wrnE.length===0} disabledMsg="No issues found to analyze" retryCount={retryCount}/>

      {/* Filters */}
      <div style={{display:"flex",gap:5,marginBottom:6,flexWrap:"wrap"}}>
        {sevFilters.map(f=><button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?C.accent:C.panel,color:filter===f?"#fff":C.muted,border:`1px solid ${filter===f?C.accent:C.border}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:10,fontWeight:filter===f?700:400,textTransform:"capitalize"}}>{f}</button>)}
        <div style={{width:1,background:C.border,margin:"0 2px"}}/>
        {cats.map(c=><button key={c} onClick={()=>setCatFilter(c)} style={{background:catFilter===c?"#1e3a5f":C.panel,color:catFilter===c?"#60a5fa":C.muted,border:`1px solid ${catFilter===c?"#3b82f6":C.border}`,borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:10,fontWeight:catFilter===c?700:400}}>{c==="all"?"All":CAT_LABELS[c]||c}</button>)}
      </div>

      {/* Search + Thread + Time */}
      <div style={{display:"flex",gap:6,marginBottom:6,flexWrap:"wrap",alignItems:"center"}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search message, module, namespace, request ID..."
          style={{flex:1,minWidth:160,background:C.panel,border:`1px solid ${C.border}`,color:C.text,borderRadius:6,padding:"5px 10px",fontSize:11}}/>
        {tids.length>0&&<select value={threadFilter} onChange={e=>setThreadFilter(e.target.value)} style={{background:C.panel,border:`1px solid ${threadFilter?C.accent:C.border}`,color:threadFilter?C.accent:C.muted,borderRadius:6,padding:"5px 8px",fontSize:10,cursor:"pointer",maxWidth:170}}>
          <option value="">All Thread IDs</option>{tids.map(t=><option key={t} value={t}>[{t}]</option>)}
        </select>}
        <span style={{color:C.muted,fontSize:10}}>From</span>
        <input type="datetime-local" value={timeFrom} onChange={e=>setTimeFrom(e.target.value)} style={{background:C.panel,border:`1px solid ${timeFrom?C.accent:C.border}`,color:timeFrom?C.text:C.muted,borderRadius:6,padding:"4px 6px",fontSize:10,colorScheme:"dark"}}/>
        <span style={{color:C.muted,fontSize:10}}>To</span>
        <input type="datetime-local" value={timeTo} onChange={e=>setTimeTo(e.target.value)} style={{background:C.panel,border:`1px solid ${timeTo?C.accent:C.border}`,color:timeTo?C.text:C.muted,borderRadius:6,padding:"4px 6px",fontSize:10,colorScheme:"dark"}}/>
        {(threadFilter||timeFrom||timeTo)&&<button onClick={()=>{setThreadFilter("");setTimeFrom("");setTimeTo("");}} style={{background:"transparent",border:`1px solid ${C.border}`,color:"#f59e0b",borderRadius:5,padding:"3px 8px",cursor:"pointer",fontSize:10}}>Clear</button>}
        <span style={{color:C.muted,fontSize:10,whiteSpace:"nowrap"}}>{filtered.length.toLocaleString()} / {entries.length.toLocaleString()}</span>
      </div>

      {/* IIS table */}
      {type==="iis"?(
        <div style={{overflowX:"auto",borderRadius:8,border:`1px solid ${C.border}`,maxHeight:500,overflowY:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead><tr style={{background:"#0d1520",position:"sticky",top:0}}>{["Time","Method","URI","Status","ms","Client IP","Cat","Issues"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",borderBottom:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>{h}</th>)}</tr></thead>
            <tbody>{filtered.map(e=><tr key={e.id} style={{background:e.classification.sev==="error"?"#180808":e.classification.sev==="warn"?"#181208":"transparent",borderBottom:`1px solid ${C.border}`}}>
              <td style={{padding:"5px 10px",fontFamily:"monospace",color:C.muted,whiteSpace:"nowrap"}}>{e.timestamp.substring(11,19)}</td>
              <td style={{padding:"5px 10px",fontFamily:"monospace",color:"#94a3b8"}}>{e.method}</td>
              <td style={{padding:"5px 10px",fontFamily:"monospace",color:C.text,maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={e.uri}>{e.uri}</td>
              <td style={{padding:"5px 10px"}}><Badge type={e.status>=500?"error":e.status>=400?"warn":e.status>=300?"warn":"success"}>{e.fullStatus}</Badge></td>
              <td style={{padding:"5px 10px",fontFamily:"monospace",color:e.timeTaken>3000?"#f59e0b":C.muted}}>{e.timeTaken}</td>
              <td style={{padding:"5px 10px",fontFamily:"monospace",color:C.muted,fontSize:10}}>{e.clientIp}</td>
              <td style={{padding:"5px 10px"}}>{e.uriCat&&<Badge type={CAT_BADGE[e.uriCat.cat]||"info"}>{e.uriCat.label}</Badge>}</td>
              <td style={{padding:"5px 10px",display:"flex",gap:3,flexWrap:"wrap"}}>{(e.issues||[]).length===0?<Badge type="success">OK</Badge>:(e.issues||[]).map((iss,i)=><Badge key={i} type={iss.sev}>{iss.label}</Badge>)}</td>
            </tr>)}</tbody>
          </table>
        </div>
      ):(
        /* Text log rows */
        <div style={{borderRadius:8,border:`1px solid ${C.border}`,overflow:"hidden",maxHeight:500,overflowY:"auto"}}>
          {filtered.length===0&&<div style={{padding:28,textAlign:"center",color:C.muted,fontSize:13}}>No matching entries. Try adjusting your filters.</div>}
          {filtered.map(e=>{
            const isExp=expanded===e.id;const cv=e.classification;
            return(
              <div key={e.id}>
                <div onClick={()=>setExpanded(isExp?null:e.id)} style={{display:"flex",gap:7,padding:"6px 10px",background:isExp?C.highlight:e.isProbe?"#1a0e00":sevBg(cv.sev),borderBottom:`1px solid ${C.border}`,cursor:e.stackTrace.length?"pointer":"default",alignItems:"flex-start"}}>
                  <span style={{color:C.muted,fontFamily:"monospace",fontSize:9,minWidth:32,textAlign:"right",paddingTop:2,flexShrink:0}}>{e.lineNum}</span>
                  {e.timestamp&&<span style={{color:C.muted,fontFamily:"monospace",fontSize:9,whiteSpace:"nowrap",paddingTop:2,flexShrink:0}}>{e.timestamp.substring(11,19)}</span>}
                  <Badge type={cv.sev}>{e.level}</Badge>
                  {e.isProbe&&<Badge type="security">Probe</Badge>}
                  {e.isHealthCheck&&<Badge type="szc">Health</Badge>}
                  {e.category&&e.category!=="other"&&!e.isProbe&&!e.isHealthCheck&&<Badge type={CAT_BADGE[e.category]||"info"}>{CAT_LABELS[e.category]||e.category}</Badge>}
                  {cv.label&&cv.label!=="Info"&&!e.isHealthCheck&&<Badge type={cv.sev}>{cv.label}</Badge>}
                  {e.module&&<span style={{color:"#94a3b8",fontFamily:"monospace",fontSize:9,whiteSpace:"nowrap",flexShrink:0}}>[{e.module}]</span>}
                  {e.threadId&&<span style={{color:"#374151",fontFamily:"monospace",fontSize:8,whiteSpace:"nowrap",flexShrink:0}}>[{e.threadId}]</span>}
                  {e.requestCtx&&<span style={{color:"#2d3748",fontFamily:"monospace",fontSize:8,whiteSpace:"nowrap",flexShrink:0}}>[{e.requestCtx.substring(0,12)}]</span>}
                  <span style={{fontFamily:"monospace",fontSize:10,color:e.isProbe?"#fb923c":sevTx(cv.sev),wordBreak:"break-all",lineHeight:1.5,flex:1}}>{e.message.replace(/^\[[^\]]+\]\s*/,"")}</span>
                  {e.stackTrace.length>0&&<span style={{color:C.muted,fontSize:9,flexShrink:0}}>{isExp?"hide":"▼stack"}</span>}
                </div>
                {isExp&&e.stackTrace.length>0&&<div style={{background:"#0d0808",borderBottom:`1px solid ${C.border}`,padding:"6px 10px 6px 50px"}}>{e.stackTrace.map((st,i)=><div key={i} style={{fontFamily:"monospace",fontSize:9,color:"#fca5a5",lineHeight:1.6}}>{st}</div>)}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MULTI-TAB LOG SHELL ──────────────────────────────────────────────────────
function LogShell({ accept, onSessionAdded, onSessionRemoved, filterType, banner, children }) {
  const [sessions,setSessions]=useState([]);
  const [activeId,setActiveId]=useState(null);
  const [uploadError,setUploadError]=useState("");

  const loadFile=useCallback(file=>{
    setUploadError("");
    if(file.size>100*1024*1024){setUploadError(`File is ${(file.size/1024/1024).toFixed(1)}MB. Maximum supported size is 100MB.`);return;}
    const r=new FileReader();
    r.onload=e=>{
      try{
        const text=e.target.result;
        let session;
        if(filterType){
          // SZC tool — only parse szc/iis
          const type=detectType(text);
          const finalType=(type==="szc"||type==="iis")?type:"szc";
          const entries=finalType==="iis"?parseIis(text):parseSzc(text);
          session={type:finalType,entries,fileName:file.name,id:Date.now()+Math.random()};
        } else {
          session=parseLog(file,text);
        }
        setSessions(prev=>[...prev,session]);
        setActiveId(session.id);
        if(onSessionAdded) onSessionAdded(session);
      }catch(err){setUploadError("Failed to parse file: "+err.message);}
    };
    r.onerror=()=>setUploadError("Failed to read file. It may be corrupted or inaccessible.");
    r.readAsText(file);
  },[filterType,onSessionAdded]);

  const closeSession=id=>{
    setSessions(prev=>{const next=prev.filter(s=>s.id!==id);if(activeId===id)setActiveId(next.length?next[next.length-1].id:null);return next;});
    if(onSessionRemoved) onSessionRemoved(id);
  };
  const activeSession=sessions.find(s=>s.id===activeId);

  if(sessions.length===0) return (
    <div>
      {banner}
      <UploadZone onFile={loadFile} accept={accept} label="Upload Log File" icon="📋" error={uploadError}/>
    </div>
  );

  return (
    <div>
      {/* Subtab bar */}
      <div style={{display:"flex",alignItems:"stretch",borderBottom:`1px solid ${C.border}`,background:C.dark,borderRadius:"8px 8px 0 0",overflowX:"auto"}}>
        {sessions.map(s=>{
          const isA=s.id===activeId;const tc=TYPE_COLOR[s.type]||"#60a5fa";
          const errC=s.entries.filter(e=>e.classification.sev==="error"&&!e.isHealthCheck).length;
          const probeC=s.entries.filter(e=>e.isProbe).length;
          return(
            <div key={s.id} onClick={()=>setActiveId(s.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"9px 14px",cursor:"pointer",borderRight:`1px solid ${C.border}`,background:isA?C.panel:C.dark,borderBottom:isA?`2px solid ${tc}`:"2px solid transparent",flexShrink:0,transition:"background 0.15s"}}>
              <span style={{fontSize:11,color:isA?C.text:C.muted,fontWeight:isA?600:400,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.fileName}</span>
              {errC>0&&<span style={{background:"#3b0a0a",color:"#ef4444",border:"1px solid #7f1d1d",borderRadius:8,padding:"1px 5px",fontSize:9,fontWeight:700}}>{errC}</span>}
              {probeC>0&&<span style={{background:"#1a0e00",color:"#fb923c",border:"1px solid #7c2d12",borderRadius:8,padding:"1px 5px",fontSize:9,fontWeight:700}}>{probeC}p</span>}
              <button onClick={ev=>{ev.stopPropagation();closeSession(s.id);}} style={{background:"transparent",border:"none",color:C.muted,cursor:"pointer",fontSize:13,padding:"0 1px",lineHeight:1}}>×</button>
            </div>
          );
        })}
        <div style={{padding:"9px 12px",display:"flex",alignItems:"center"}}>
          <label style={{cursor:"pointer",display:"flex",alignItems:"center",gap:5,color:C.muted,fontSize:11}}>
            <span style={{fontSize:16}}>+</span><span>Add Log</span>
            <input type="file" accept={accept} style={{display:"none"}} onChange={e=>{if(e.target.files[0])loadFile(e.target.files[0]);e.target.value="";}}/>
          </label>
        </div>
      </div>
      {uploadError&&<div style={{padding:"8px 14px",background:"#1a0808",border:"1px solid #7f1d1d",borderTop:"none",color:"#fca5a5",fontSize:12}}>⚠ {uploadError}</div>}
      <div style={{background:C.panel,border:`1px solid ${C.border}`,borderTop:"none",borderRadius:"0 0 8px 8px",padding:18}}>
        {activeSession?<LogSession key={activeSession.id} session={activeSession}/>:<div style={{padding:28,textAlign:"center",color:C.muted}}>Select a tab above.</div>}
      </div>
    </div>
  );
}

// ─── HAR ANALYZER ─────────────────────────────────────────────────────────────
function HarAnalyzer({ onEntriesLoaded }) {
  const [entries,setEntries]=useState([]);
  const [filter,setFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [selected,setSelected]=useState(null);
  const [aiAnalysis,setAiAnalysis]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [retryCount,setRetryCount]=useState(0);
  const [fileName,setFileName]=useState("");
  const [uploadError,setUploadError]=useState("");

  const loadHar=file=>{
    setUploadError("");
    if(!file.name.endsWith(".har")){setUploadError("Please upload a .har file.");return;}
    if(file.size>50*1024*1024){setUploadError("HAR file is too large (max 50MB). Export a smaller capture.");return;}
    const r=new FileReader();
    r.onload=e=>{
      try{
        const har=JSON.parse(e.target.result);
        if(!har.log?.entries){setUploadError("Invalid HAR file — no log entries found.");return;}
        const parsed=(har.log.entries||[]).map((en,i)=>({id:i,url:en.request?.url||"",method:en.request?.method||"",status:en.response?.status||0,time:Math.round(en.time||0),size:en.response?.content?.size||0,mimeType:en.response?.content?.mimeType||"",issues:classifyH(en)}));
        setEntries(parsed);setSelected(null);setAiAnalysis("");setFileName(file.name);
        if(onEntriesLoaded) onEntriesLoaded(parsed);
      }catch{setUploadError("Failed to parse HAR file. Make sure it was exported correctly from browser DevTools.");}
    };
    r.onerror=()=>setUploadError("Failed to read file.");
    r.readAsText(file);
  };

  function classifyH(en){
    const s=en.response?.status||0,t=en.time||0,u=en.request?.url||"",m=en.response?.content?.mimeType||"";const i=[];
    if(s>=500)i.push({sev:"error",msg:`Server error ${s}`});else if(s>=400)i.push({sev:"error",msg:`Client error ${s}`});else if(s===0)i.push({sev:"warn",msg:"No response / blocked"});
    if(t>5000)i.push({sev:"error",msg:`Very slow: ${(t/1000).toFixed(1)}s`});else if(t>2000)i.push({sev:"warn",msg:`Slow: ${(t/1000).toFixed(1)}s`});
    if(m.includes("text/html")&&(u.includes("/api/")||u.includes("/v1/")))i.push({sev:"warn",msg:"API returned HTML"});return i;
  }

  const filtered=entries.filter(e=>{
    const mf=filter==="all"?true:filter==="errors"?e.issues.some(i=>i.sev==="error"):filter==="warnings"?e.issues.some(i=>i.sev==="warn"):filter==="ok"?e.issues.length===0:true;
    return mf&&(search===""||e.url.toLowerCase().includes(search.toLowerCase()));
  });
  const errC=entries.filter(e=>e.issues.some(i=>i.sev==="error")).length;
  const wrnC=entries.filter(e=>e.issues.some(i=>i.sev==="warn")&&!e.issues.some(i=>i.sev==="error")).length;

  const analyze=async()=>{
    setAiLoading(true);setAiAnalysis("");
    const problems=entries.filter(e=>e.issues.length>0).slice(0,20).map(e=>({url:e.url,method:e.method,status:e.status,time:e.time,issues:e.issues.map(i=>i.msg)}));
    try{const r=await callAI("You are a senior ShareFile support engineer. Analyze HAR file issues and give:\n1. Brief summary\n2. Root cause\n3. Step-by-step next steps\nBe concise and actionable.",`Analyze these ShareFile HAR issues:\n\n${JSON.stringify(problems,null,2)}`);setAiAnalysis(r);setRetryCount(0);}
    catch(e){setAiAnalysis(aiErr(e));setRetryCount(c=>c+1);}
    setAiLoading(false);
  };

  if(!entries.length) return (
    <div>
      <UploadZone onFile={loadHar} accept=".har" label="Upload HAR File" icon="🌐" error={uploadError}/>
      <div style={{marginTop:14,padding:14,background:C.panel,borderRadius:8,border:`1px solid ${C.border}`,color:C.muted,fontSize:12,lineHeight:1.8}}>
        <strong style={{color:C.text}}>How to capture a HAR file from Chrome:</strong><br/>
        1. Open DevTools (F12) → Network tab<br/>2. Reproduce the ShareFile issue<br/>3. Right-click any request → Save all as HAR with content<br/>4. Upload the .har file above
      </div>
    </div>
  );

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{color:C.muted,fontSize:12}}>📄 {fileName} — {entries.length} requests</div>
        <button onClick={()=>{setEntries([]);setAiAnalysis("");if(onEntriesLoaded)onEntriesLoaded([]);}} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:11}}>Clear</button>
      </div>
      <StatBar items={[{label:"Total",value:entries.length,color:C.text},{label:"Errors",value:errC,color:C.error},{label:"Warnings",value:wrnC,color:C.warn},{label:"OK",value:entries.filter(e=>e.issues.length===0).length,color:C.success}]}/>
      <AiBox onAnalyze={analyze} loading={aiLoading} analysis={aiAnalysis} disabled={false} retryCount={retryCount}/>
      <div style={{display:"flex",gap:6,marginBottom:10,flexWrap:"wrap"}}>
        {["all","errors","warnings","ok"].map(f=><button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?C.accent:C.panel,color:filter===f?"#fff":C.muted,border:`1px solid ${filter===f?C.accent:C.border}`,borderRadius:5,padding:"4px 12px",cursor:"pointer",fontSize:11,textTransform:"capitalize"}}>{f}</button>)}
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Filter by URL..." style={{flex:1,background:C.panel,border:`1px solid ${C.border}`,color:C.text,borderRadius:5,padding:"4px 10px",fontSize:11,minWidth:100}}/>
      </div>
      <div style={{overflowX:"auto",borderRadius:8,border:`1px solid ${C.border}`}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
          <thead><tr style={{background:"#0d1520"}}>{["Status","Method","URL","Time","Issues"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"left",color:C.muted,fontWeight:600,fontSize:10,textTransform:"uppercase",borderBottom:`1px solid ${C.border}`}}>{h}</th>)}</tr></thead>
          <tbody>{filtered.map(e=><tr key={e.id} onClick={()=>setSelected(selected?.id===e.id?null:e)} style={{background:selected?.id===e.id?C.highlight:e.issues.some(i=>i.sev==="error")?"#1a0a0a":"transparent",cursor:"pointer",borderBottom:`1px solid ${C.border}`}}>
            <td style={{padding:"6px 10px"}}><Badge type={e.status>=400?"error":e.status>=300?"warn":"success"}>{e.status||"—"}</Badge></td>
            <td style={{padding:"6px 10px",color:C.muted,fontFamily:"monospace"}}>{e.method}</td>
            <td style={{padding:"6px 10px",color:C.text,maxWidth:280,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontFamily:"monospace",fontSize:10}}>{e.url}</td>
            <td style={{padding:"6px 10px",color:e.time>2000?"#f59e0b":C.muted,fontFamily:"monospace"}}>{e.time}ms</td>
            <td style={{padding:"6px 10px"}}>{e.issues.length===0?<Badge type="success">OK</Badge>:e.issues.map((iss,i)=><Badge key={i} type={iss.sev}>{iss.msg}</Badge>)}</td>
          </tr>)}</tbody>
        </table>
      </div>
      {selected&&<div style={{marginTop:12,padding:14,background:C.panel,border:`1px solid ${C.accent}`,borderRadius:8}}>
        <div style={{color:C.accent,fontWeight:700,marginBottom:10,fontSize:12}}>Request Details</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,fontSize:11}}>
          {[["URL",selected.url],["Method",selected.method],["Status",selected.status],["Time",`${selected.time}ms`],["MIME",selected.mimeType],["Size",`${(selected.size/1024).toFixed(1)} KB`]].map(([k,v])=><div key={k}><div style={{color:C.muted,marginBottom:2}}>{k}</div><div style={{color:C.text,fontFamily:"monospace",wordBreak:"break-all"}}>{v}</div></div>)}
        </div>
      </div>}
    </div>
  );
}

// ─── LOG ANALYZER ─────────────────────────────────────────────────────────────
function LogAnalyzer({ onSessionAdded, onSessionRemoved }) {
  return (
    <LogShell accept=".log,.txt" onSessionAdded={onSessionAdded} onSessionRemoved={onSessionRemoved}
      banner={
        <div style={{marginBottom:16,padding:14,background:C.panel,borderRadius:8,border:`1px solid ${C.border}`,color:C.muted,fontSize:12,lineHeight:1.9}}>
          <strong style={{color:C.text}}>Supported log types (auto-detected on upload):</strong><br/>
          <span style={{color:"#38bdf8"}}>Windows App:</span> <code style={{color:"#fcd34d",fontSize:10}}>%LocalAppData%\ShareFile\ShareFile for Windows\Logs\</code><br/>
          <span style={{color:"#facc15"}}>Outlook Plugin:</span> <code style={{color:"#fcd34d",fontSize:10}}>%LocalAppData%\ShareFile\ShareFile for Outlook\Logs\</code><br/>
          <span style={{color:"#e879f9"}}>IIS Logs:</span> <code style={{color:"#fcd34d",fontSize:10}}>C:\inetpub\logs\LogFiles\W3SVC1\</code><br/>
          <span style={{color:"#4ade80"}}>StorageCenter:</span> <code style={{color:"#fcd34d",fontSize:10}}>C:\inetpub\wwwroot\Logs\</code><br/><br/>
          <strong style={{color:C.text}}>Tip:</strong> You can open multiple log files as separate subtabs using the + Add Log button.
        </div>
      }
    />
  );
}

// ─── SZC LOG TOOL ─────────────────────────────────────────────────────────────
function SzcLogTool({ onSessionAdded, onSessionRemoved }) {
  return (
    <div>
      <div style={{padding:"12px 18px",background:"#0a1a0f",border:`1px solid #166534`,borderRadius:8,marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:26}}>🖥️</span>
        <div>
          <div style={{color:"#4ade80",fontWeight:700,fontSize:13}}>SZC Log Tool — On-Premise Storage Zone Analyzer</div>
          <div style={{color:C.muted,fontSize:11,marginTop:2}}>Analyze StorageCenter and IIS logs from on-premise ShareFile Storage Zones. Security probes are automatically detected and separated from real errors.</div>
        </div>
      </div>
      <LogShell accept=".log,.txt" onSessionAdded={onSessionAdded} onSessionRemoved={onSessionRemoved} filterType="szc"
        banner={
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            <div style={{padding:14,background:C.panel,borderRadius:8,border:"1px solid #166534",color:C.muted,fontSize:12,lineHeight:1.8}}>
              <strong style={{color:"#4ade80"}}>StorageCenter Logs</strong><br/>
              <code style={{color:"#fcd34d",fontSize:10}}>C:\inetpub\wwwroot\Logs\</code><br/><br/>
              Auth events · Health checks · Upload/download · Security probes · App errors
            </div>
            <div style={{padding:14,background:C.panel,borderRadius:8,border:"1px solid #7e22ce",color:C.muted,fontSize:12,lineHeight:1.8}}>
              <strong style={{color:"#e879f9"}}>IIS Logs</strong><br/>
              <code style={{color:"#fcd34d",fontSize:10}}>C:\inetpub\logs\LogFiles\W3SVC1\</code><br/><br/>
              HTTP requests · Auth failures · 5xx errors · Slow requests
            </div>
          </div>
        }
      />
    </div>
  );
}

// ─── CORRELATION TOOL ─────────────────────────────────────────────────────────
function CorrelationTool({ sharedSessions }) {
  const [query,setQuery]=useState("");
  const [submitted,setSubmitted]=useState("");
  const [aiAnalysis,setAiAnalysis]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [retryCount,setRetryCount]=useState(0);

  const doSearch=()=>{if(query.trim()){setSubmitted(query.trim());setAiAnalysis("");}};

  const results=submitted?sharedSessions.map(s=>{
    const q=submitted.toLowerCase();
    const matches=s.entries.filter(e=>[e.message,e.requestCtx||"",e.threadId,e.module,e.namespace||"",e.uri||""].join(" ").toLowerCase().includes(q));
    return{...s,matches};
  }).filter(s=>s.matches.length>0):[];

  const totalMatches=results.reduce((a,r)=>a+r.matches.length,0);

  const analyze=async()=>{
    setAiLoading(true);setAiAnalysis("");
    const ctx=results.map(r=>`=== ${r.fileName} (${r.type.toUpperCase()}) ===\n`+r.matches.slice(0,10).map(e=>`[${e.timestamp}][${e.level}][${e.module||"?"}] ${e.message}`).join("\n")).join("\n\n");
    try{const r=await callAI(`You are a senior ShareFile support engineer. You have log entries from MULTIPLE log files matching the same correlation ID or search term. Give:\n1. TIMELINE: Reconstruct events chronologically across all sources\n2. ROOT CAUSE: Based on cross-log evidence\n3. IMPACT: What was affected\n4. NEXT STEPS: Numbered steps to resolve\nCross-reference log sources by name.`,`Correlation search: "${submitted}"\n\nMatching entries:\n\n${ctx}`);setAiAnalysis(r);setRetryCount(0);}
    catch(e){setAiAnalysis(aiErr(e));setRetryCount(c=>c+1);}
    setAiLoading(false);
  };

  const sevBg=s=>s==="error"?"#180808":s==="warn"?"#181208":"transparent";
  const sevTx=s=>s==="error"?"#fca5a5":s==="warn"?"#fcd34d":"#93c5fd";

  return (
    <div>
      <div style={{padding:"12px 18px",background:"#0c1a3b",border:`1px solid #1e3a5f`,borderRadius:8,marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:26}}>🔗</span>
        <div>
          <div style={{color:"#60a5fa",fontWeight:700,fontSize:13}}>Cross-Log Correlation</div>
          <div style={{color:C.muted,fontSize:11,marginTop:2}}>Search a Request ID, Thread ID, IP, username, or keyword across ALL loaded log files simultaneously to trace an issue end-to-end.</div>
        </div>
      </div>

      {sharedSessions.length===0?(
        <div style={{padding:28,textAlign:"center",background:C.panel,borderRadius:8,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:28,marginBottom:10}}>📂</div>
          <div style={{color:C.text,fontWeight:600,marginBottom:6}}>No logs loaded yet</div>
          <div style={{color:C.muted,fontSize:12}}>Load logs in the Log Analyzer or SZC Log Tool tabs first, then return here to correlate across them.</div>
        </div>
      ):(
        <div>
          {/* Loaded sessions */}
          <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap"}}>
            {sharedSessions.map(s=>(
              <div key={s.id} style={{padding:"4px 10px",background:C.panel,border:`1px solid ${TYPE_COLOR[s.type]||C.border}`,borderRadius:5,display:"flex",alignItems:"center",gap:5}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:TYPE_COLOR[s.type]||C.muted,display:"inline-block"}}/>
                <span style={{fontSize:10,color:C.text,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.fileName}</span>
                <span style={{fontSize:9,color:C.muted}}>({s.entries.length.toLocaleString()})</span>
              </div>
            ))}
          </div>

          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <input value={query} onChange={e=>setQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
              placeholder="Request ID, Thread ID, IP address, username, error message, URL path..."
              style={{flex:1,background:C.panel,border:`1px solid ${C.accent}`,color:C.text,borderRadius:7,padding:"9px 14px",fontSize:12,outline:"none"}}/>
            <button onClick={doSearch} style={{background:C.accent,color:"#fff",border:"none",borderRadius:7,padding:"9px 18px",cursor:"pointer",fontWeight:600,fontSize:12,whiteSpace:"nowrap"}}>Search All</button>
            {submitted&&<button onClick={()=>{setSubmitted("");setQuery("");setAiAnalysis("");}} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:7,padding:"9px 12px",cursor:"pointer",fontSize:11}}>Clear</button>}
          </div>

          {submitted&&(
            <div>
              <div style={{color:C.muted,fontSize:12,marginBottom:10}}>
                <span style={{color:C.text,fontWeight:700}}>{totalMatches}</span> matches across <span style={{color:C.text,fontWeight:700}}>{results.length}</span> of {sharedSessions.length} files for <span style={{color:"#60a5fa",fontFamily:"monospace"}}>"{submitted}"</span>
              </div>

              {results.length>0&&<AiBox onAnalyze={analyze} loading={aiLoading} analysis={aiAnalysis} disabled={false} retryCount={retryCount}/>}

              {results.length===0?(
                <div style={{padding:22,textAlign:"center",background:C.panel,borderRadius:8,border:`1px solid ${C.border}`,color:C.muted,fontSize:12}}>No matches found for "{submitted}" in any loaded log file.</div>
              ):results.map(r=>(
                <div key={r.id} style={{marginBottom:14}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,padding:"7px 12px",background:C.dark,borderRadius:"7px 7px 0 0",border:`1px solid ${C.border}`,borderBottom:"none"}}>
                    <span style={{width:7,height:7,borderRadius:"50%",background:TYPE_COLOR[r.type]||C.muted,display:"inline-block"}}/>
                    <span style={{color:C.text,fontWeight:600,fontSize:11}}>{r.fileName}</span>
                    <Badge type={TYPE_BADGE_TYPE[r.type]||"info"}>{r.type.toUpperCase()}</Badge>
                    <span style={{color:C.muted,fontSize:10,marginLeft:"auto"}}>{r.matches.length} match{r.matches.length!==1?"es":""}</span>
                  </div>
                  <div style={{border:`1px solid ${C.border}`,borderRadius:"0 0 7px 7px",overflow:"hidden",maxHeight:300,overflowY:"auto"}}>
                    {r.matches.map(e=>(
                      <div key={e.id} style={{display:"flex",gap:7,padding:"6px 10px",background:sevBg(e.classification?.sev),borderBottom:`1px solid ${C.border}`,alignItems:"flex-start"}}>
                        <span style={{color:C.muted,fontFamily:"monospace",fontSize:9,whiteSpace:"nowrap",flexShrink:0}}>{e.timestamp?.substring(11,19)||""}</span>
                        <Badge type={e.classification?.sev||"info"}>{e.level||"INFO"}</Badge>
                        {e.module&&<span style={{color:"#94a3b8",fontFamily:"monospace",fontSize:9,whiteSpace:"nowrap",flexShrink:0}}>[{e.module}]</span>}
                        {e.threadId&&<span style={{color:"#374151",fontFamily:"monospace",fontSize:8,flexShrink:0}}>[{e.threadId}]</span>}
                        <span style={{fontFamily:"monospace",fontSize:10,color:sevTx(e.classification?.sev),wordBreak:"break-all",lineHeight:1.5,flex:1}}>
                          {e.message.split(new RegExp(`(${submitted.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")})`, "gi")).map((part,i)=>
                            part.toLowerCase()===submitted.toLowerCase()
                              ?<mark key={i} style={{background:"#854d0e",color:"#fcd34d",borderRadius:2,padding:"0 2px"}}>{part}</mark>
                              :part
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── API TRACE TOOL ───────────────────────────────────────────────────────────
function ApiTraceTool({ sharedSessions, harEntries }) {
  const [search,setSearch]=useState("");
  const [submitted,setSubmitted]=useState("");
  const [aiAnalysis,setAiAnalysis]=useState("");
  const [aiLoading,setAiLoading]=useState(false);
  const [retryCount,setRetryCount]=useState(0);

  const iisSess=sharedSessions.filter(s=>s.type==="iis");
  const szcSess=sharedSessions.filter(s=>s.type==="szc");
  const hasData=harEntries.length>0||iisSess.length>0||szcSess.length>0;

  const trace=submitted?{
    har:harEntries.filter(e=>e.url?.toLowerCase().includes(submitted.toLowerCase())),
    iis:iisSess.flatMap(s=>s.entries.filter(e=>(e.uri||"").toLowerCase().includes(submitted.toLowerCase())||e.message.toLowerCase().includes(submitted.toLowerCase())).map(e=>({...e,_src:s.fileName}))),
    szc:szcSess.flatMap(s=>s.entries.filter(e=>e.message.toLowerCase().includes(submitted.toLowerCase())).map(e=>({...e,_src:s.fileName}))),
  }:null;

  const totalTrace=trace?trace.har.length+trace.iis.length+trace.szc.length:0;

  const analyze=async()=>{
    if(!trace)return;setAiLoading(true);setAiAnalysis("");
    const ctx=[
      trace.har.length?`=== HAR (Browser) ===\n`+trace.har.slice(0,10).map(e=>`${e.method} ${e.url} -> ${e.status} (${e.time}ms)`).join("\n"):"",
      trace.iis.length?`=== IIS (Server) ===\n`+trace.iis.slice(0,10).map(e=>`[${e.timestamp}] ${e.method} ${e.uri} -> ${e.status} (${e.timeTaken}ms) from ${e.clientIp}`).join("\n"):"",
      trace.szc.length?`=== StorageCenter ===\n`+trace.szc.slice(0,10).map(e=>`[${e.timestamp}][${e.level}][${e.module}] ${e.message}`).join("\n"):"",
    ].filter(Boolean).join("\n\n");
    try{const r=await callAI(`You are a senior ShareFile support engineer tracing an API request through: Browser (HAR) → IIS → StorageCenter. Give:\n1. REQUEST JOURNEY: Trace browser→IIS→StorageCenter chronologically\n2. WHERE IT FAILED: Exact layer\n3. ROOT CAUSE\n4. NEXT STEPS (numbered)\nCross-reference timing to identify latency.`,`API trace for: "${submitted}"\n\n${ctx}`);setAiAnalysis(r);setRetryCount(0);}
    catch(e){setAiAnalysis(aiErr(e));setRetryCount(c=>c+1);}
    setAiLoading(false);
  };

  const doSearch=()=>{if(search.trim()){setSubmitted(search.trim());setAiAnalysis("");}};

  return (
    <div>
      <div style={{padding:"12px 18px",background:"#1a0a2e",border:`1px solid #4c1d95`,borderRadius:8,marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:26}}>🔀</span>
        <div>
          <div style={{color:"#a78bfa",fontWeight:700,fontSize:13}}>API Request Tracer</div>
          <div style={{color:C.muted,fontSize:11,marginTop:2}}>Trace a ShareFile API request end-to-end: Browser (HAR) → IIS Server → StorageCenter. Search by URL path or endpoint name.</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
        {[{label:"HAR (Browser)",count:harEntries.length,color:"#60a5fa",icon:"🌐"},{label:"IIS (Server)",count:iisSess.reduce((a,s)=>a+s.entries.length,0),color:"#e879f9",icon:"🖥️"},{label:"StorageCenter",count:szcSess.reduce((a,s)=>a+s.entries.length,0),color:"#4ade80",icon:"📦"}].map(src=>(
          <div key={src.label} style={{padding:"7px 12px",background:C.panel,border:`1px solid ${src.count>0?src.color:C.border}`,borderRadius:7,display:"flex",alignItems:"center",gap:7}}>
            <span>{src.icon}</span><span style={{fontSize:11,color:src.count>0?src.color:C.muted,fontWeight:600}}>{src.label}</span>
            <span style={{fontSize:10,color:C.muted}}>{src.count>0?`${src.count.toLocaleString()} entries`:"not loaded"}</span>
          </div>
        ))}
      </div>
      {!hasData?(
        <div style={{padding:28,textAlign:"center",background:C.panel,borderRadius:8,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:28,marginBottom:10}}>📂</div>
          <div style={{color:C.text,fontWeight:600,marginBottom:6}}>No data sources loaded</div>
          <div style={{color:C.muted,fontSize:12,lineHeight:1.8}}>1. Load a HAR file in the HAR Analyzer tab<br/>2. Load IIS logs in Log Analyzer or SZC Log Tool<br/>3. Optionally load StorageCenter logs<br/>4. Return here and search by URL path</div>
        </div>
      ):(
        <div>
          <div style={{display:"flex",gap:8,marginBottom:14}}>
            <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doSearch()}
              placeholder="/sf/v3/Items, /upload, /oauth, /download, /saml..."
              style={{flex:1,background:C.panel,border:"1px solid #4c1d95",color:C.text,borderRadius:7,padding:"9px 14px",fontSize:12,outline:"none"}}/>
            <button onClick={doSearch} style={{background:"#4c1d95",color:"#fff",border:"none",borderRadius:7,padding:"9px 18px",cursor:"pointer",fontWeight:600,fontSize:12,whiteSpace:"nowrap"}}>Trace</button>
            {submitted&&<button onClick={()=>{setSubmitted("");setSearch("");setAiAnalysis("");}} style={{background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:7,padding:"9px 12px",cursor:"pointer",fontSize:11}}>Clear</button>}
          </div>
          {submitted&&trace&&(
            <div>
              <div style={{color:C.muted,fontSize:12,marginBottom:10}}><span style={{color:C.text,fontWeight:700}}>{totalTrace}</span> entries matching <span style={{color:"#a78bfa",fontFamily:"monospace"}}>"{submitted}"</span></div>
              {totalTrace>0&&<AiBox onAnalyze={analyze} loading={aiLoading} analysis={aiAnalysis} disabled={false} retryCount={retryCount}/>}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10}}>
                {[
                  {key:"har",label:"🌐 Browser (HAR)",color:"#0c1a3b",border:"#1e3a5f",textColor:"#60a5fa",items:trace.har,render:e=><div><div style={{display:"flex",gap:4,marginBottom:3}}><Badge type={e.status>=400?"error":e.status>=300?"warn":"success"}>{e.status}</Badge><span style={{color:"#94a3b8",fontSize:9,fontFamily:"monospace"}}>{e.method}</span><span style={{color:e.time>2000?"#f59e0b":C.muted,fontSize:9}}>{e.time}ms</span></div><div style={{fontFamily:"monospace",fontSize:9,color:C.muted,wordBreak:"break-all"}}>{e.url?.replace(/^https?:\/\/[^/]+/,"")}</div></div>},
                  {key:"iis",label:"🖥️ IIS (Server)",color:"#1a0a1a",border:"#7e22ce",textColor:"#e879f9",items:trace.iis,render:e=><div><div style={{display:"flex",gap:4,marginBottom:3,flexWrap:"wrap"}}><Badge type={e.status>=500?"error":e.status>=400?"warn":"success"}>{e.status}</Badge><span style={{color:"#94a3b8",fontSize:9,fontFamily:"monospace"}}>{e.method}</span><span style={{color:e.timeTaken>3000?"#f59e0b":C.muted,fontSize:9}}>{e.timeTaken}ms</span></div><div style={{fontFamily:"monospace",fontSize:9,color:C.muted,wordBreak:"break-all"}}>{e.uri}</div><div style={{fontSize:8,color:"#374151",marginTop:2}}>{e.timestamp?.substring(11,19)} · {e.clientIp}</div></div>},
                  {key:"szc",label:"📦 StorageCenter",color:"#0a1a0f",border:"#166534",textColor:"#4ade80",items:trace.szc,render:e=><div><div style={{display:"flex",gap:4,marginBottom:3}}><Badge type={e.classification?.sev||"info"}>{e.level}</Badge>{e.module&&<span style={{color:"#94a3b8",fontSize:9}}>[{e.module}]</span>}</div><div style={{fontFamily:"monospace",fontSize:9,color:e.classification?.sev==="error"?"#fca5a5":"#93c5fd",wordBreak:"break-all"}}>{e.message}</div><div style={{fontSize:8,color:"#374151",marginTop:2}}>{e.timestamp?.substring(11,19)}</div></div>},
                ].map(col=>(
                  <div key={col.key}>
                    <div style={{padding:"7px 10px",background:col.color,border:`1px solid ${col.border}`,borderRadius:"7px 7px 0 0",color:col.textColor,fontWeight:700,fontSize:11}}>{col.label} ({col.items.length})</div>
                    <div style={{border:`1px solid ${col.border}`,borderTop:"none",borderRadius:"0 0 7px 7px",maxHeight:380,overflowY:"auto"}}>
                      {col.items.length===0?<div style={{padding:16,textAlign:"center",color:C.muted,fontSize:11}}>No matches</div>:
                       col.items.map((e,i)=><div key={i} style={{padding:"7px 9px",borderBottom:`1px solid ${C.border}`,background:(e.status>=400||e.classification?.sev==="error")?"#180808":"transparent"}}>{col.render(e)}</div>)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── DECRYPT TOOL ─────────────────────────────────────────────────────────────
function DecryptTool() {
  const [encFile,setEncFile]=useState(null);
  const [keyFile,setKeyFile]=useState(null);
  const [decrypted,setDecrypted]=useState("");
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [copied,setCopied]=useState(false);
  const encRef=useRef();const keyRef=useRef();
  const readBytes=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(new Uint8Array(e.target.result));r.onerror=rej;r.readAsArrayBuffer(f);});
  const readText=f=>new Promise((res,rej)=>{const r=new FileReader();r.onload=e=>res(e.target.result);r.onerror=rej;r.readAsText(f);});
  const doDecrypt=async()=>{
    if(!encFile||!keyFile){setError("Upload both the .enc and .key files.");return;}
    setLoading(true);setError("");setDecrypted("");
    try{
      const encBytes=await readBytes(encFile);
      const keyText=await readText(keyFile);
      const lines=keyText.split("\n");
      const ki=lines.findIndex(l=>l.trim()==="KEY (hex):");
      if(ki===-1){setError("Key file format invalid — could not find KEY (hex): line.");setLoading(false);return;}
      const keyHex=lines[ki+1]?.trim();
      if(!keyHex||keyHex.length!==64){setError("Invalid key — expected 64-character hex string.");setLoading(false);return;}
      const plain=await decryptBytes(encBytes,keyHex);setDecrypted(plain);
    }catch{setError("Decryption failed. Ensure the .enc and .key files are from the same session and have not been modified.");}
    setLoading(false);
  };
  const meta=decrypted?decrypted.split("---LOG CONTENT---")[0].trim().split("\n"):[];
  const logContent=decrypted?decrypted.split("---LOG CONTENT---")[1]?.trim():"";
  return (
    <div>
      <div style={{padding:"12px 18px",background:"#0c1a3b",border:`1px solid #1e3a5f`,borderRadius:8,marginBottom:16,display:"flex",alignItems:"center",gap:14}}>
        <span style={{fontSize:26}}>🔓</span>
        <div>
          <div style={{color:"#60a5fa",fontWeight:700,fontSize:13}}>Decrypt Log</div>
          <div style={{color:C.muted,fontSize:11,marginTop:2}}>Upload the .enc and .key files from a previously encrypted debug session ZIP to view the original log.</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
        <div onClick={()=>encRef.current.click()} style={{border:`2px dashed ${encFile?"#10b981":C.border}`,borderRadius:10,padding:"24px 18px",textAlign:"center",cursor:"pointer",background:encFile?"#022c1a":C.panel,transition:"all 0.2s"}}>
          <div style={{fontSize:26,marginBottom:8}}>🔒</div>
          <div style={{color:encFile?"#10b981":C.muted,fontWeight:600,fontSize:12}}>{encFile?encFile.name:"Upload .enc file"}</div>
          <div style={{color:C.muted,fontSize:10,marginTop:3}}>SF-DEBUG-XXXX.enc</div>
          <input ref={encRef} type="file" accept=".enc" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){setEncFile(e.target.files[0]);setDecrypted("");setError("");}}}/>
        </div>
        <div onClick={()=>keyRef.current.click()} style={{border:`2px dashed ${keyFile?"#10b981":C.border}`,borderRadius:10,padding:"24px 18px",textAlign:"center",cursor:"pointer",background:keyFile?"#022c1a":C.panel,transition:"all 0.2s"}}>
          <div style={{fontSize:26,marginBottom:8}}>🗝️</div>
          <div style={{color:keyFile?"#10b981":C.muted,fontWeight:600,fontSize:12}}>{keyFile?keyFile.name:"Upload .key file"}</div>
          <div style={{color:C.muted,fontSize:10,marginTop:3}}>SF-DEBUG-XXXX.key</div>
          <input ref={keyRef} type="file" accept=".key" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){setKeyFile(e.target.files[0]);setDecrypted("");setError("");}}}/>
        </div>
      </div>
      <button onClick={doDecrypt} disabled={loading||!encFile||!keyFile} style={{width:"100%",padding:"10px",background:loading||!encFile||!keyFile?C.border:C.accent,color:"#fff",border:"none",borderRadius:7,cursor:loading||!encFile||!keyFile?"not-allowed":"pointer",fontWeight:600,fontSize:13,marginBottom:12}}>
        {loading?"Decrypting...":(!encFile||!keyFile)?"Upload both files above":"🔓 Decrypt Log"}
      </button>
      {error&&<div style={{padding:10,background:"#1a0808",border:"1px solid #7f1d1d",borderRadius:7,color:"#fca5a5",fontSize:12,marginBottom:12}}>✗ {error}</div>}
      {decrypted&&(
        <div>
          <div style={{padding:14,background:"#022c1a",border:`1px solid #064e3b`,borderRadius:8,marginBottom:12}}>
            <div style={{color:C.success,fontWeight:700,fontSize:12,marginBottom:8}}>✓ Decrypted — Session Metadata</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
              {meta.map((line,i)=>{const[k,...v]=line.split(":");return <div key={i} style={{fontSize:11}}><span style={{color:C.muted}}>{k}: </span><span style={{color:C.text,fontFamily:"monospace"}}>{v.join(":").trim()}</span></div>;})}
            </div>
          </div>
          <div style={{background:C.panel,border:`1px solid ${C.border}`,borderRadius:8,overflow:"hidden"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
              <span style={{color:C.text,fontWeight:600,fontSize:12}}>Decrypted Log Content</span>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>{navigator.clipboard.writeText(logContent);setCopied(true);setTimeout(()=>setCopied(false),2000);}} style={{background:copied?"#022c1a":C.panel,color:copied?C.success:C.muted,border:`1px solid ${copied?C.success:C.border}`,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:10,fontWeight:600}}>{copied?"Copied!":"Copy All"}</button>
                <button onClick={()=>{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([logContent],{type:"text/plain"}));a.download="decrypted-log.txt";a.click();}} style={{background:C.panel,color:C.muted,border:`1px solid ${C.border}`,borderRadius:5,padding:"3px 10px",cursor:"pointer",fontSize:10,fontWeight:600}}>Download .txt</button>
              </div>
            </div>
            <div style={{padding:12,maxHeight:480,overflowY:"auto",fontFamily:"monospace",fontSize:10,color:"#93c5fd",lineHeight:1.7,whiteSpace:"pre-wrap",wordBreak:"break-all"}}>{logContent}</div>
          </div>
          <button onClick={()=>{setEncFile(null);setKeyFile(null);setDecrypted("");setError("");}} style={{marginTop:10,background:"transparent",border:`1px solid ${C.border}`,color:C.muted,borderRadius:5,padding:"4px 12px",cursor:"pointer",fontSize:11}}>Clear & Decrypt Another</button>
        </div>
      )}
    </div>
  );
}

// ─── USER GUIDE ───────────────────────────────────────────────────────────────
function UserGuide() {
  const [section,setSection]=useState(0);
  const sections=[
    {title:"Getting Started",icon:"🚀",content:[
      {h:"What is the D-Bugger?",p:"This tool helps support engineers quickly analyze ShareFile log files, trace issues across multiple log sources, and generate AI-powered root cause analysis. It runs entirely in the browser — no installation required."},
      {h:"Quick Start Workflow",p:"1. Go to the relevant tab for the issue type\n2. Upload the log file(s) from the customer machine or server\n3. Use filters to narrow down to errors\n4. Click AI Root Cause Analysis for next steps\n5. Encrypt and download the log for secure storage"},
      {h:"Which tab should I use?",p:"🌐 HAR Analyzer → Web app issues, API errors, slow page loads\n📋 Log Analyzer → Windows desktop app or Outlook plugin issues\n🖥️ SZC Log Tool → On-premise Storage Zone Controller issues\n🔗 Correlate → Issue spans multiple log files\n🔀 API Tracer → Trace one request end-to-end\n🔓 Decrypt Log → View a previously encrypted session\n📖 User Guide → This page"},
    ]},
    {title:"Log File Locations",icon:"📁",content:[
      {h:"ShareFile for Windows",p:"Path: %LocalAppData%\\ShareFile\\ShareFile for Windows\\Logs\\\n\nContains: auth events, sync operations, drive mounting, SQLite DB operations, ENS connections"},
      {h:"ShareFile Outlook Plugin",p:"Path: %LocalAppData%\\ShareFile\\ShareFile for Outlook\\Logs\\\n\nContains: connection state, OAuth/SAML auth, upload operations, addin lifecycle events"},
      {h:"IIS Logs (On-Premise)",p:"Path: C:\\inetpub\\logs\\LogFiles\\W3SVC1\\\nFiles: u_exYYMMDD.log (one per day)\n\nContains: all HTTP requests, status codes, response times, client IPs"},
      {h:"StorageCenter Logs",p:"Path: C:\\inetpub\\wwwroot\\Logs\\\n\nContains: auth module events, 5-minute health checks, upload/download operations, external security probes"},
    ]},
    {title:"HAR Analyzer",icon:"🌐",content:[
      {h:"When to use it",p:"Use HAR Analyzer when a customer reports:\n• ShareFile web app not loading correctly\n• Files not uploading or downloading in the browser\n• Authentication errors on the web interface\n• Slow performance on the ShareFile web app"},
      {h:"How to capture a HAR file",p:"1. Open Chrome and go to ShareFile\n2. Press F12 to open DevTools\n3. Click the Network tab\n4. Reproduce the issue (login, upload, etc.)\n5. Right-click any request → Save all as HAR with content\n6. Upload the .har file here"},
      {h:"Reading the results",p:"Red rows = HTTP errors (4xx/5xx) or very slow requests\nYellow rows = warnings (slow requests, redirects)\nClick any row to see full request details\nUse the Errors filter to focus on problems\nClick AI Root Cause Analysis for next steps and what to send the customer"},
    ]},
    {title:"Log Analyzer",icon:"📋",content:[
      {h:"Auto-detection",p:"Upload any log file and the tool automatically detects the format — Windows app, Outlook plugin, IIS, or StorageCenter. A colored badge confirms the detected type."},
      {h:"Multiple logs simultaneously",p:"Use + Add Log to open additional log files as separate subtabs. Each tab is independent with its own filters and AI analysis. Useful when comparing logs from the same incident."},
      {h:"Filter tips",p:"Issues → shows only errors and warnings (best starting point)\nErrors → errors only\nSecurity → external probe attempts (SZC logs only)\nCategory buttons → filter by module (Auth, Sync, DB, Mount, etc.)\nThread ID dropdown → follow one operation through the log\nTime range pickers → narrow to when the issue occurred\nSearch box → find specific request IDs, usernames, error messages"},
      {h:"Stack traces",p:"When an error has a stack trace (e.g. SQLite exceptions in Windows app logs), a ▼stack label appears. Click the row to expand the full trace inline."},
    ]},
    {title:"SZC Log Tool",icon:"🖥️",content:[
      {h:"When to use it",p:"Use SZC Log Tool for on-premise Storage Zone issues:\n• Files not syncing to on-prem storage\n• Upload or download failures for on-prem zones\n• StorageCenter service errors\n• IIS problems on the Storage Zone server"},
      {h:"Security probes explained",p:"You will see ERROR entries for paths like:\n• /owa/\n• /cgi-bin/luci/\n• /geoserver/web/\n• /_layouts/\n• /Dr0v\n\nThese are NOT ShareFile errors. They are automated internet scanners probing your public endpoint for vulnerabilities. The tool flags them orange as Probe. They are security observations, not application bugs."},
      {h:"What to escalate vs ignore",p:"ESCALATE these:\n• Health Check Failed\n• Upload Failed / Chunk Error\n• Auth Failed (Bad hparam)\n• Out of Memory / Disk Full\n• Unhandled Exception\n\nIGNORE these:\n• Security probe bad requests\n• Health Check Succeeded (normal every 5 min)"},
    ]},
    {title:"Correlate & API Tracer",icon:"🔗",content:[
      {h:"Cross-Log Correlation",p:"The Correlate tab searches ALL loaded log files simultaneously.\n\nBest used when:\n• You have a request ID or correlation ID\n• You need to find related events across multiple logs\n• You want to trace a specific user or IP\n• An error in one log references something in another\n\nLoad your logs in Log Analyzer and SZC Log Tool first, then come here."},
      {h:"Good things to search for",p:"• Request/session IDs (e.g. c6b08fad)\n• Thread IDs (e.g. 0HNKB5FB551KE)\n• Username or email address\n• IP address\n• Specific error text fragment\n• File name or folder path"},
      {h:"API Request Tracer",p:"Shows three columns: 🌐 Browser → 🖥️ IIS → 📦 StorageCenter\n\nSearch by URL path:\n• /sf/v3/Items → ShareFile API calls\n• /upload → file uploads\n• /oauth → authentication\n• /download → file downloads\n\nThe AI analysis reconstructs the full request journey and pinpoints which layer failed and why."},
    ]},
    {title:"Encryption & Security",icon:"🔒",content:[
      {h:"Why encrypt logs?",p:"Log files contain sensitive customer data — usernames, file paths, auth tokens. Encrypting them before storage protects that data and ensures only someone with the key file can view it."},
      {h:"How to encrypt",p:"After uploading a log, click the green Encrypt & Download button. This:\n1. Encrypts the log with AES-256-GCM\n2. Assigns a session ID (e.g. SF-DEBUG-0001)\n3. Downloads a ZIP with two files:\n   • SF-DEBUG-0001.enc (encrypted log)\n   • SF-DEBUG-0001.key (decryption key)\n\nStore the ZIP together. Do not separate the two files."},
      {h:"30-day deletion",p:"The .key file contains a Delete After date (30 days from encryption). After that date, delete the entire ZIP folder. This ensures logs are not kept longer than necessary."},
      {h:"How to decrypt",p:"1. Go to the Decrypt Log tab\n2. Upload the .enc file\n3. Upload the .key file from the same ZIP\n4. Click Decrypt Log\n5. View, copy, or download the original log content"},
    ]},
    {title:"Common Issues Reference",icon:"🛠️",content:[
      {h:"SQLite ROWID errors — Windows App",p:"Error: Could not get max of ROWID for Capabilities\nCause: Database schema mismatch after an app update\nFix: Uninstall and reinstall ShareFile for Windows. Local databases will be recreated automatically."},
      {h:"ENS connection failures — Windows App",p:"Error: ENS connection failed / ENS disconnected\nCause: Firewall or proxy blocking WebSocket connections\nFix: Whitelist *.sf-event.com for WSS (WebSocket Secure) on port 443 in firewall/proxy rules."},
      {h:"OIDC token failures — Windows App",p:"Error: OIDC token fail / refresh failed\nCause: Expired credentials, SSO config issue, or BFF host unreachable\nFix: Sign out and back in. Check connectivity to us-desktopnativebff.sharefile.io"},
      {h:"DNS failures — Outlook Plugin",p:"Error: The remote name could not be resolved\nCause: Machine cannot resolve ShareFile hostnames\nFix: Test DNS for secure.sf-api.com. Check corporate DNS, proxy settings, or VPN."},
      {h:"Settings.cfg missing — Outlook Plugin",p:"Error: Can't read settings.cfg\nCause: Config file deleted or permissions issue\nFix: Reinstall the Outlook plugin. Check %LocalAppData%\\ShareFile\\ShareFile for Outlook\\ permissions."},
      {h:"Network flapping — Outlook Plugin",p:"Pattern: Repeated True -> False / False -> True in ConnectionService\nCause: Intermittent network affecting the plugin connection\nFix: Check network stability, proxy settings, and VPN interference. Capture on a stable network to compare."},
    ]},
  ];
  const s=sections[section];
  return (
    <div style={{display:"grid",gridTemplateColumns:"190px 1fr",gap:14,minHeight:500}}>
      <div style={{background:C.panel,borderRadius:8,border:`1px solid ${C.border}`,padding:8,height:"fit-content"}}>
        {sections.map((sec,i)=>(
          <button key={i} onClick={()=>setSection(i)} style={{width:"100%",display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:section===i?"#1e3a5f":"transparent",border:"none",borderRadius:6,cursor:"pointer",textAlign:"left",marginBottom:2}}>
            <span style={{fontSize:13}}>{sec.icon}</span>
            <span style={{color:section===i?"#60a5fa":C.muted,fontSize:11,fontWeight:section===i?600:400}}>{sec.title}</span>
          </button>
        ))}
      </div>
      <div style={{background:C.panel,borderRadius:8,border:`1px solid ${C.border}`,padding:20}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16,paddingBottom:12,borderBottom:`1px solid ${C.border}`}}>
          <span style={{fontSize:22}}>{s.icon}</span>
          <span style={{color:C.text,fontWeight:700,fontSize:15}}>{s.title}</span>
        </div>
        {s.content.map((item,i)=>(
          <div key={i} style={{marginBottom:18}}>
            <div style={{color:"#60a5fa",fontWeight:700,fontSize:12,marginBottom:7}}>{item.h}</div>
            <div style={{color:C.muted,fontSize:12,lineHeight:1.9,whiteSpace:"pre-wrap",background:C.dark,padding:12,borderRadius:6,border:`1px solid ${C.border}`}}>{item.p}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MAIN APP ──────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,setTab]=useState(0);
  const [sharedSessions,setSharedSessions]=useState([]);
  const [sharedHar,setSharedHar]=useState([]);
  const addSession=useCallback(s=>setSharedSessions(prev=>prev.find(x=>x.id===s.id)?prev:[...prev,s]),[]);
  const removeSession=useCallback(id=>setSharedSessions(prev=>prev.filter(s=>s.id!==id)),[]);
  const TABS=[
    {label:"HAR Analyzer",icon:"🌐",color:C.accent},
    {label:"Log Analyzer",icon:"📋",color:C.accent},
    {label:"SZC Log Tool",icon:"🖥️",color:"#4ade80"},
    {label:"Correlate",icon:"🔗",color:"#60a5fa"},
    {label:"API Tracer",icon:"🔀",color:"#a78bfa"},
    {label:"Decrypt Log",icon:"🔓",color:"#60a5fa"},
    {label:"User Guide",icon:"📖",color:"#f59e0b"},
  ];
  return (
    <div style={{minHeight:"100vh",background:C.bg,color:C.text,fontFamily:"'IBM Plex Mono','Fira Code',monospace"}}>
      <div style={{background:C.panel,borderBottom:`1px solid ${C.border}`,padding:"11px 20px",display:"flex",alignItems:"center",gap:12}}>
        <div style={{width:28,height:28,background:C.accent,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>🔍</div>
        <div>
          <div style={{fontWeight:700,fontSize:14,letterSpacing:0.4}}>D-Bugger</div>
          <div style={{fontSize:10,color:C.muted}}>v1.0</div>
        </div>
        {(sharedSessions.length>0||sharedHar.length>0)&&(
          <div style={{marginLeft:10,display:"flex",gap:4,flexWrap:"wrap"}}>
            {sharedHar.length>0&&<span style={{background:"#0c1a3b",color:"#60a5fa",border:"1px solid #1e3a5f",borderRadius:8,padding:"2px 7px",fontSize:9,fontWeight:600}}>🌐 HAR ({sharedHar.length})</span>}
            {sharedSessions.map(s=><span key={s.id} style={{background:C.dark,color:TYPE_COLOR[s.type]||C.muted,border:`1px solid ${TYPE_COLOR[s.type]||C.border}`,borderRadius:8,padding:"2px 7px",fontSize:9,fontWeight:600,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s.fileName}</span>)}
          </div>
        )}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:10,color:C.muted,fontFamily:"monospace",background:C.dark,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 7px"}}>v1.0</span>
          <a href="mailto:support-tools-feedback@sharefile.com?subject=D-Bugger Feedback" style={{fontSize:10,color:C.muted,textDecoration:"none",background:C.dark,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 8px",cursor:"pointer"}} title="Report a parsing issue or suggest an improvement">💬 Feedback</a>
          <div style={{display:"flex",gap:3}}>{["#ef4444","#f59e0b","#10b981"].map(c=><span key={c} style={{width:8,height:8,borderRadius:"50%",background:c,display:"inline-block"}}/>)}</div>
        </div>
      </div>
      <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,background:C.panel,overflowX:"auto"}}>
        {TABS.map((t,i)=>(
          <button key={t.label} onClick={()=>setTab(i)} style={{padding:"10px 16px",background:"transparent",border:"none",borderBottom:tab===i?`2px solid ${t.color}`:"2px solid transparent",color:tab===i?t.color:C.muted,cursor:"pointer",fontSize:11,fontWeight:tab===i?700:400,fontFamily:"inherit",letterSpacing:0.3,whiteSpace:"nowrap"}}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>
      <div style={{maxWidth:1320,margin:"0 auto",padding:18}}>
        {tab===0&&<HarAnalyzer onEntriesLoaded={setSharedHar}/>}
        {tab===1&&<LogAnalyzer onSessionAdded={addSession} onSessionRemoved={removeSession}/>}
        {tab===2&&<SzcLogTool onSessionAdded={addSession} onSessionRemoved={removeSession}/>}
        {tab===3&&<CorrelationTool sharedSessions={sharedSessions}/>}
        {tab===4&&<ApiTraceTool sharedSessions={sharedSessions} harEntries={sharedHar}/>}
        {tab===5&&<DecryptTool/>}
        {tab===6&&<UserGuide/>}
      </div>
    </div>
  );
}
