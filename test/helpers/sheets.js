import {clone} from './runtime.js';
// Contract double, not a real Sheets deployment. All subrequests commit together.
export function sheetsDouble(app,initial){
 const tables=app.tablesFor_(initial);let sheets={};let counter=0;
 for(const [name,rows] of Object.entries(tables))sheets[name]={properties:{title:name,sheetId:counter++,gridProperties:{rowCount:10000,columnCount:60}},cells:clone(app.tableCells_(rows))};
 const state={calls:[],fail:false};
 app.ledgerCall_=(path,method,body)=>{
   state.calls.push({path,method,bytes:body?Buffer.byteLength(JSON.stringify(body)):0});
   if(path.includes('values:batchGet')){const params=new URLSearchParams(path.split('?')[1]);return{valueRanges:params.getAll('ranges').map(name=>({values:clone(sheets[name.replaceAll("'",'')].cells)}))};}
   if(!method||method==='get')return{sheets:Object.values(sheets).map(s=>({properties:clone(s.properties)}))};
   if(!path.endsWith(':batchUpdate'))throw Error('unexpected path');
   const next=clone(sheets);
   for(const req of body.requests){
     if(req.updateSheetProperties){const p=req.updateSheetProperties.properties,s=Object.values(next).find(s=>s.properties.sheetId===p.sheetId);s.properties.gridProperties={...s.properties.gridProperties,...p.gridProperties};continue;}
     if(req.addProtectedRange)continue;
     const change=req.updateCells;if(!change)throw Error('unsupported request');
     const s=Object.values(next).find(s=>s.properties.sheetId===change.range.sheetId),range=change.range;
     if(range.endRowIndex>s.properties.gridProperties.rowCount||range.endColumnIndex>s.properties.gridProperties.columnCount)throw Error('grid bounds');
     for(let row=range.startRowIndex;row<range.endRowIndex;row++){s.cells[row]=s.cells[row]||[];for(let col=range.startColumnIndex;col<range.endColumnIndex;col++)s.cells[row][col]=change.rows[row-range.startRowIndex]?.values?.[col-range.startColumnIndex]?.userEnteredValue?.stringValue||'';}
   }
   if(state.fail||state.failAtPost===state.calls.filter(c=>c.method==='post').length)throw Error('simulated Sheets batch failure');sheets=next;return{replies:[]};
 };
 state.read=()=>app.readLedger_('mock').data;state.raw=()=>clone(sheets);return state;
}
