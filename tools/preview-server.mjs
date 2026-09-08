// Isolated, memory-only regression preview. No Google/GitHub requests or disk writes.
import http from 'node:http';
import fs from 'node:fs';
import {staged,fixture} from '../test/helpers/runtime.js';
const runtime=staged(fixture()),d=runtime.ledger();
d.accounts=d.accounts.map(a=>runtime.app.makeUser_(a,'preview-only'));
runtime.replaceLedger(d);
const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/styles.css':'styles.css','/data/seed.json':'data/seed.json'};
const port=Number(process.env.STABILITY_PREVIEW_PORT||4175);
http.createServer(async(req,res)=>{
 try{const path=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(path==='/api'){let body='';for await(const chunk of req){body+=chunk;if(body.length>2000000)throw Error('too large');}const result=runtime.app.handle_(JSON.parse(body||'{}'));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;}
  if(path==='/config.js'){res.setHeader('Content-Type','text/javascript');res.end('window.WORK_CONFIG={API_URL:"http://127.0.0.1:'+port+'/api"};');return;}
  if(!files[path]){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/html');res.end(fs.readFileSync(new URL('../'+files[path],import.meta.url)));
 }catch(e){res.writeHead(500);res.end('Isolated preview error');}
}).listen(port,'127.0.0.1',()=>console.log('Memory-only preview http://127.0.0.1:'+port+' — admin / viewer / a; password: preview-only'));
