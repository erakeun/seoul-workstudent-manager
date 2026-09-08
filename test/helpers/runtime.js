import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
export const clone = x => JSON.parse(JSON.stringify(x));
export function fixture() {
  return {version:4,settings:{activeSemesterId:'term'},semesters:[{id:'term',name:'학기',startDate:'2026-09-01',endDate:'2026-09-30',active:true,budgets:{general:{wage:10000},holmz:{}}}],students:[{id:'a',name:'학생 A',site:'general',active:true,type:'교내',semesterIds:['term']},{id:'b',name:'학생 B',site:'general',active:true,semesterIds:['term']},{id:'c',name:'학생 C',site:'holmz',active:true,semesterIds:['term']}],accounts:[{id:'admin',username:'admin',name:'관리자',role:'admin',active:true},{id:'viewer',username:'viewer',name:'조회자',role:'viewer',active:true},{id:'ua',username:'a',name:'학생 A',studentId:'a',role:'student',active:true}],schedules:[{id:'shift',semesterId:'term',site:'general',studentId:'a',studentName:'학생 A',kind:'date',date:'2026-09-08',start:'09:00',end:'12:00'}],exceptions:[],swaps:[],extraJobs:[],notices:[],handovers:[],handoverNotes:[],attendances:[],attendanceAudit:[]};
}
export function runtime(source, initial=fixture()) {
  let time=Date.parse('2026-09-08T00:00:00Z');
  class Clock extends Date {constructor(...args){super(...(args.length?args:[time]));}static now(){return time;}}
  const props=new Map([['swtm2',JSON.stringify(initial)]]), stats={locks:0,writes:0};let held=false;
  const properties={getProperty:k=>props.get(k)??null,setProperty:(k,v)=>{props.set(k,String(v));return properties;},deleteProperty:k=>props.delete(k),getProperties:()=>Object.fromEntries(props),setProperties:x=>Object.entries(x).forEach(([k,v])=>props.set(k,String(v)))};
  const context={console,Date:Clock,Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>[...crypto.createHash('sha256').update(s).digest()],base64Encode:x=>Buffer.from(x).toString('base64'),formatDate:(d,tz,f)=>{const iso=new Date(d.getTime()+9*3600000).toISOString();return f==='yyyy-MM-dd'?iso.slice(0,10):iso;},newBlob:s=>({getBytes:()=>[...Buffer.from(s)]})},PropertiesService:{getScriptProperties:()=>properties},LockService:{getScriptLock:()=>({waitLock:()=>{if(held)throw Error('lock busy');held=true;stats.locks++;},releaseLock:()=>{held=false;}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})}};
  vm.createContext(context);vm.runInContext(source,context);
  return {app:context,props,stats,setTime:t=>{time=Date.parse(t);},session:(id='admin')=>{const token=crypto.randomUUID();props.set('sess_'+token,JSON.stringify({id,e:time+86400000,authVersion:0}));return token;},data:()=>JSON.parse(props.get('swtm2'))};
}
export function source(){return fs.readdirSync(new URL('../../backend/',import.meta.url)).filter(f=>f.endsWith('.gs')).sort().map(f=>fs.readFileSync(new URL('../../backend/'+f,import.meta.url),'utf8')).join('\n');}
export function staged(initial=fixture()){
 const r=runtime(source(),initial);let ledger=r.app.normalizeData_(initial);ledger.requests=[];
 r.props.set('swtm_ledger_v5','isolated-ledger');
 r.app.readLedger_=()=>({data:clone(ledger),sheets:{}});
 r.app.writeLedger_=(_id,before,next)=>{if(r.failWrite)throw Error('simulated server write failure');if(JSON.stringify(before)!==JSON.stringify(ledger))throw Error('stale server transaction');ledger=clone(next);r.stats.writes++;};
 r.ledger=()=>clone(ledger);r.replaceLedger=x=>{ledger=clone(x);};
 r.request=(action,payload={},id)=>r.app.handle_({action,token:r.adminToken,...payload,clientVersion:5,requestId:id||'1788825600000:'+crypto.randomUUID()});
 r.adminToken=r.session();r.studentToken=r.session('ua');r.viewerToken=r.session('viewer');return r;
}
