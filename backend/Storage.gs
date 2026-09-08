/** V5 staging candidate. Never auto-migrates, seeds, falls back, or deletes legacy data.
 * Sheets REST batchUpdate is the commit boundary; ScriptLock serializes all writers.
 * Each entity is a row with field columns, not one database JSON cell.
 */
const LEDGER_POINTER = 'swtm_ledger_v5';
const LEDGER_TABLES = ['students','accounts','semesters','schedules','exceptions','attendances','attendanceAudit','extraJobs','swaps','notices','handovers','handoverNotes','requests'];
var transaction_ = null;
var lockDepth_ = 0;
function canonical_(value) {
  if(Array.isArray(value))return '['+value.map(canonical_).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical_(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function checksum_(value){return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canonical_(value)));}
function copy_(value){return JSON.parse(JSON.stringify(value));}
function ledgerCall_(path,method,body){
  const response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+path,{method:method||'get',headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},contentType:'application/json',payload:body?JSON.stringify(body):undefined,muteHttpExceptions:true});
  if(response.getResponseCode()<200||response.getResponseCode()>=300)throw Error('데이터 원장 요청 실패 ('+response.getResponseCode()+'). 저장 여부를 재조회하세요.');
  return JSON.parse(response.getContentText());
}
function ledgerId_(){const id=PropertiesService.getScriptProperties().getProperty(LEDGER_POINTER);if(!id)throw Error('V5 원장 전환이 완료되지 않았습니다. 운영 담당자에게 문의하세요.');return id;}
function tablesFor_(data){
  const tables={};LEDGER_TABLES.forEach(k=>tables[k]=copy_(data[k]||[]));
  tables.settings=Object.keys(data.settings||{}).sort().map(key=>({key,value:data.settings[key]}));
  tables.metadata=Object.keys(data).filter(k=>k!=='settings'&&LEDGER_TABLES.indexOf(k)===-1).sort().map(key=>({key,value:data[key]}));
  return tables;
}
function fromTables_(tables){
  const data={};(tables.metadata||[]).forEach(r=>data[r.key]=r.value);
  LEDGER_TABLES.forEach(k=>data[k]=tables[k]||[]);data.settings={};(tables.settings||[]).forEach(r=>data.settings[r.key]=r.value);return data;
}
function tableCells_(records){
  const keys=Array.from(new Set(records.reduce((a,r)=>a.concat(Object.keys(r)),[]))).sort();
  const headers=keys.concat(['_order']);
  return [headers].concat(records.map((r,index)=>headers.map(k=>k==='_order'?String(index):r[k]===undefined?'':canonical_(r[k]))));
}
function recordsFromCells_(cells){
  if(!cells.length)return [];const headers=cells[0];
  if(new Set(headers).size!==headers.length)throw Error('원장 헤더 중복: 직접 수정하지 마세요.');
  return cells.slice(1).filter(row=>row.some(v=>v!==''&&v!==undefined)).map(row=>{const r={};headers.forEach((k,i)=>{if(row[i]!==''&&row[i]!==undefined)r[k]=JSON.parse(row[i]);});return r;}).sort((a,b)=>(a._order||0)-(b._order||0)).map(r=>{delete r._order;return r;});
}
function readLedger_(id){
  const names=LEDGER_TABLES.concat(['settings','metadata']),meta=ledgerCall_(id+'?fields=sheets.properties');
  const sheets={};(meta.sheets||[]).forEach(s=>sheets[s.properties.title]=s.properties);
  if(names.some(n=>!sheets[n]))throw Error('원장 필수 시트 누락. Legacy로 자동 복귀하지 않습니다.');
  const result=ledgerCall_(id+'/values:batchGet?'+names.map(n=>'ranges='+encodeURIComponent("'"+n+"'")).join('&')+'&valueRenderOption=UNFORMATTED_VALUE');
  const tables={};names.forEach((n,i)=>{const cells=result.valueRanges[i].values||[];tables[n]=recordsFromCells_(cells);sheets[n].headers=cells[0]||[];sheets[n].rowIds=cells.slice(1).map(row=>{const r=recordsFromCells_([cells[0],row])[0];return r?rowKey_(r):'';});});
  return {data:fromTables_(tables),sheets};
}
function tableWriteRequests_(name,records,oldRecords,properties){
  if(canonical_(records)===canonical_(oldRecords))return [];
  const headers=Array.from(new Set((properties.headers||[]).concat(records.flatMap(r=>Object.keys(r)),['_order']))),width=Math.max(1,headers.length);
  const slots=(properties.rowIds||oldRecords.map(rowKey_)).slice(),oldMap=new Map(oldRecords.map(r=>[rowKey_(r),r])),newMap=new Map(records.map(r=>[rowKey_(r),r])),requests=[];
  const cell=v=>{const value=v===undefined?'':canonical_(v);if(value.length>40000)throw Error(name+' 필드가 너무 큽니다. 저장하지 않았습니다.');return{userEnteredValue:{stringValue:value}};};
  const rowRequest=(index,values)=>({updateCells:{range:{sheetId:properties.sheetId,startRowIndex:index,endRowIndex:index+1,startColumnIndex:0,endColumnIndex:width},rows:[{values}],fields:'userEnteredValue'}});
  if(canonical_(headers)!==canonical_(properties.headers||[]))requests.push(rowRequest(0,headers.map(k=>({userEnteredValue:{stringValue:k}}))));
  slots.forEach((id,i)=>{if(id&&!newMap.has(id)){requests.push(rowRequest(i+1,[]));slots[i]='';}});
  records.forEach((r,order)=>{const id=rowKey_(r);if(canonical_(r)===canonical_(oldMap.get(id))&&rowKey_(oldRecords[order]||{})===id)return;let index=slots.indexOf(id);if(index<0){index=slots.indexOf('');if(index<0)index=slots.length;slots[index]=id;}requests.push(rowRequest(index+1,headers.map(k=>cell(k==='_order'?order:r[k]))));});
  const height=slots.length+1;
  if(height>properties.gridProperties.rowCount||width>properties.gridProperties.columnCount)requests.push({updateSheetProperties:{properties:{sheetId:properties.sheetId,gridProperties:{rowCount:Math.max(height,properties.gridProperties.rowCount),columnCount:Math.max(width,properties.gridProperties.columnCount)}},fields:'gridProperties.rowCount,gridProperties.columnCount'}});
  return requests.sort((a,b)=>Number(!!b.updateSheetProperties)-Number(!!a.updateSheetProperties));
}
function rowKey_(record){return record.id||record.attendanceId||record.key;}
function writeLedger_(id,before,next,sheets){
  const oldTables=tablesFor_(before),newTables=tablesFor_(next),requests=[];
  Object.keys(newTables).forEach(n=>requests.push.apply(requests,tableWriteRequests_(n,newTables[n],oldTables[n],sheets[n])));
  if(!requests.length)return;
  if(Utilities.newBlob(JSON.stringify({requests})).getBytes().length>1800000)throw Error('단일 변경이 너무 큽니다. 운영 전환/복원 전 격리 원장에서 나누어 검증하세요.');
  ledgerCall_(id+':batchUpdate','post',{requests});
}
function validateLedger_(data){
  const ids={};LEDGER_TABLES.forEach(k=>{if(!Array.isArray(data[k]))throw Error(k+' 테이블 누락');ids[k]=new Set();data[k].forEach(r=>{const id=r.id||r.attendanceId;if(!id||ids[k].has(id))throw Error(k+' ID 누락 또는 중복');ids[k].add(id);});});
  const ref=(table,id,where)=>{if(id&&!ids[table].has(id))throw Error(where+' 참조 누락');};
  data.accounts.forEach(r=>{ref('students',r.studentId,'계정-학생');if(r.role==='student'&&!r.studentId)throw Error('학생 계정 연결 누락');});
  if(!data.accounts.some(a=>a.role==='admin'&&a.active))throw Error('활성 Admin은 최소 1명 필요합니다.');
  ref('semesters',data.settings.activeSemesterId,'운영 학기');
  ['schedules','exceptions','attendances','extraJobs','swaps'].forEach(k=>data[k].forEach(r=>{ref('semesters',r.semesterId,k);ref('students',r.studentId,k);}));
  data.students.forEach(s=>(s.semesterIds||[]).forEach(id=>ref('semesters',id,'학생 참여 학기')));
  data.swaps.forEach(r=>{ref('students',r.requesterStudentId,'대타 요청자');ref('students',r.assigneeId,'대타 근무자');(r.applicants||[]).forEach(a=>ref('students',a.studentId,'대타 신청'));});
  data.extraJobs.forEach(r=>(r.applicants||[]).forEach(a=>ref('students',a.studentId,'추가근무 신청')));
  const instances=new Set();data.attendances.forEach(a=>{if(!a.workInstanceId||instances.has(a.workInstanceId))throw Error('근태 인스턴스 누락 또는 중복');instances.add(a.workInstanceId);if(!a.studentId||!a.semesterId)throw Error('근태 관계 누락');});
  return integrity_(data);
}
function integrity_(data){const counts={};LEDGER_TABLES.forEach(k=>counts[k]=(data[k]||[]).length);counts.absences=(data.attendances||[]).filter(a=>a.checkoutType==='ABSENT').length;['admin','viewer','student'].forEach(role=>counts[role+'Accounts']=(data.accounts||[]).filter(a=>a.role===role).length);return{counts,checksum:checksum_(data)};}
function beginTransaction_(){const loaded=readLedger_(ledgerId_());transaction_={id:ledgerId_(),before:loaded.data,data:copy_(loaded.data),sheets:loaded.sheets,dirty:false};}
function finishTransaction_(){if(!transaction_.dirty)return;validateLedger_(transaction_.data);writeLedger_(transaction_.id,transaction_.before,transaction_.data,transaction_.sheets);}
function readStoredData_(){if(transaction_)return copy_(transaction_.data);return readLedger_(ledgerId_()).data;}
function stageStoredData_(data){if(!transaction_)throw Error('쓰기 트랜잭션이 필요합니다.');transaction_.data=copy_(data);transaction_.dirty=true;}

/** Backup envelope deliberately excludes session tokens; raw properties backup is separate. */
function backupEnvelope_(data){return{format:'seoul-workstudent-full',schemaVersion:5,createdAt:new Date().toISOString(),excluded:['sessions'],photoPolicy:'private Drive files retained; links only, not image bytes',integrity:integrity_(data),data:copy_(data)};}
function validateBackup_(backup){if(!backup||backup.format!=='seoul-workstudent-full'||backup.schemaVersion!==5)throw Error('지원하지 않는 백업 버전입니다.');validateLedger_(backup.data);if(checksum_(backup.data)!==backup.integrity.checksum)throw Error('백업 체크섬이 일치하지 않습니다.');return copy_(backup.data);}

/** Owner-only editor helpers: trailing underscore prevents google.script.run access.
 * No helper is routed by the public web API. IDs/owners are explicit, not guessed.
 */
function backupRawProperties_(folderId,expectedOwner){
  const folder=DriveApp.getFolderById(folderId);verifyPrivateAsset_(folder,expectedOwner);
  return withLock_(function(){const raw=PropertiesService.getScriptProperties().getProperties(),envelope={format:'seoul-script-properties-raw',schemaVersion:1,createdAt:new Date().toISOString(),checksum:checksum_(raw),properties:raw};
    const stamp=Utilities.formatDate(new Date(),'Asia/Seoul','yyyyMMdd-HHmmss'),file=folder.createFile('seoul-workstudent-premigration-v1-'+stamp+'.json',JSON.stringify(envelope),'application/json');
    verifyPrivateAsset_(file,expectedOwner);const check=JSON.parse(file.getBlob().getDataAsString());if(checksum_(check.properties)!==envelope.checksum)throw Error('원본 백업 검증 실패');
    return {fileId:file.getId(),checksum:envelope.checksum};
  });
}
function verifyPrivateAsset_(asset,owner){if(!owner||asset.getOwner().getEmail()!==owner||asset.getSharingAccess()!==DriveApp.Access.PRIVATE||asset.getEditors().some(u=>u.getEmail()!==owner)||asset.getViewers().length)throw Error('자산 소유권/비공개 권한을 확인하세요. 공유 자산에는 인증정보를 저장하지 않습니다.');}
function prepareLedger_(spreadsheetId,expectedOwner){
  verifyPrivateAsset_(DriveApp.getFileById(spreadsheetId),expectedOwner);
  if(PropertiesService.getScriptProperties().getProperty(LEDGER_POINTER)===spreadsheetId)throw Error('운영 원장은 초기 준비할 수 없습니다.');
  let meta=ledgerCall_(spreadsheetId+'?fields=sheets.properties'),existing=meta.sheets.map(s=>s.properties.title),requests=[];
  if(meta.sheets.length===1&&existing.indexOf('students')===-1){
    const initial=SpreadsheetApp.openById(spreadsheetId).getSheets()[0];
    if(initial.getLastRow()||initial.getLastColumn())throw Error('기존 기본 시트가 비어 있지 않습니다. 새 빈 원장을 사용하세요.');
    initial.setName('students');meta=ledgerCall_(spreadsheetId+'?fields=sheets.properties');existing=meta.sheets.map(s=>s.properties.title);
  }
  LEDGER_TABLES.concat(['settings','metadata']).filter(n=>existing.indexOf(n)===-1).forEach((n,i)=>requests.push({addSheet:{properties:{title:n,gridProperties:{rowCount:1000,columnCount:40,frozenRowCount:1}}}}));
  if(requests.length)ledgerCall_(spreadsheetId+':batchUpdate','post',{requests});
  const ready=ledgerCall_(spreadsheetId+'?fields=sheets.properties');
  // Warning-only protection: does not lock out the owner/execution identity.
  ledgerCall_(spreadsheetId+':batchUpdate','post',{requests:ready.sheets.filter(s=>LEDGER_TABLES.concat(['settings','metadata']).indexOf(s.properties.title)!==-1).map(s=>({addProtectedRange:{protectedRange:{range:{sheetId:s.properties.sheetId},description:'시스템 원장: ID/헤더/JSON/인증정보 직접 수정 금지. 앱에서 변경하세요.',warningOnly:true}}}))});
  return{spreadsheetId,prepared:true};
}
function rehearseMigration_(raw){
  const original=JSON.parse(raw),next=normalizeData_(original);next.requests=next.requests||[];
  rehearsalBackfillAttendance_(next);validateLedger_(next);
  const roundTrip=fromTables_(Object.fromEntries(Object.entries(tablesFor_(next)).map(([k,v])=>[k,recordsFromCells_(tableCells_(v))])));
  if(checksum_(roundTrip)!==checksum_(next))throw Error('원장 직렬화 검증 실패');
  return{data:next,original:integrity_(normalizeData_(original)),target:integrity_(next),uncertain:next.attendances.filter(a=>a.snapshotStatus==='REVIEW_REQUIRED').map(a=>a.attendanceId)};
}
function migrateLegacy_(spreadsheetId,backupFileId,expectedOwner){
  verifyPrivateAsset_(DriveApp.getFileById(spreadsheetId),expectedOwner);const file=DriveApp.getFileById(backupFileId);verifyPrivateAsset_(file,expectedOwner);
  return withLock_(function(){const props=PropertiesService.getScriptProperties();if(props.getProperty(LEDGER_POINTER))throw Error('이미 운영 전환됨. Legacy 재이관 금지.');
    const backup=JSON.parse(file.getBlob().getDataAsString()),raw=props.getProperty(DATA_KEY);
    if(backup.format!=='seoul-script-properties-raw'||backup.checksum!==checksum_(backup.properties)||backup.properties[DATA_KEY]!==raw)throw Error('최신 원본 백업이 아닙니다.');
    const rehearsal=rehearseMigration_(raw),loaded=readLedger_(spreadsheetId);
    if(loaded.data.migrationSourceChecksum===checksum_(raw)){if(checksum_(loaded.data)!==checksum_(Object.assign({},rehearsal.data,{migrationSourceChecksum:checksum_(raw)})))throw Error('기존 이관 대상이 수정되었습니다.');return{reused:true,integrity:integrity_(loaded.data)};}
    rehearsal.data.migrationSourceChecksum=checksum_(raw);stageFullSnapshot_(spreadsheetId,rehearsal.data);
    const verified=readLedger_(spreadsheetId).data;if(checksum_(verified)!==checksum_(rehearsal.data))throw Error('이관 후 체크섬 불일치. 운영 전환 금지.');
    return{integrity:integrity_(verified),uncertain:rehearsal.uncertain,sourceChecksum:checksum_(raw)};
  });
}
function activateLedger_(spreadsheetId,expectedOwner,expectedChecksum){
  verifyPrivateAsset_(DriveApp.getFileById(spreadsheetId),expectedOwner);
  return withLock_(function(){const props=PropertiesService.getScriptProperties();if(props.getProperty(LEDGER_POINTER))throw Error('운영 원장은 이미 지정되어 있습니다.');
    const data=readLedger_(spreadsheetId).data;validateLedger_(data);
    if(checksum_(data)!==expectedChecksum||data.migrationSourceChecksum!==checksum_(props.getProperty(DATA_KEY)))throw Error('원본 또는 이관 데이터가 바뀌었습니다. 최종 백업/검증을 다시 하세요.');
    if(data.attendances.some(a=>a.snapshotStatus==='REVIEW_REQUIRED'))throw Error('불확실한 과거 근태 확인이 먼저 필요합니다.');
    props.setProperty(LEDGER_POINTER,spreadsheetId);return{sourceOfTruth:'Google Sheets',legacy:'swtm2 READ ONLY'};
  });
}

/** Large restore/migration uses an EMPTY, owner-selected, non-production ledger.
 * Chunked staging is never readable by the production app. Publication is a single
 * pointer switch after a full read-back checksum. Old ledgers are not modified.
 */
function stageFullSnapshot_(spreadsheetId,data){
  if(PropertiesService.getScriptProperties().getProperty(LEDGER_POINTER)===spreadsheetId)throw Error('운영 원장에 분할 복원할 수 없습니다.');
  validateLedger_(data);const digest=checksum_(data),stateKey='swtm_stage_'+spreadsheetId,props=PropertiesService.getScriptProperties(),marker=props.getProperty(stateKey),loaded=readLedger_(spreadsheetId);
  if(marker&&JSON.parse(marker).checksum!==digest)throw Error('다른 데이터의 이관/복원 대상입니다. 새 빈 원장을 사용하세요.');
  if(!marker&&LEDGER_TABLES.some(k=>(loaded.data[k]||[]).length))throw Error('비어 있는 격리 원장만 사용할 수 있습니다.');
  props.setProperty(stateKey,JSON.stringify({checksum:digest,ready:false}));
  const tables=tablesFor_(data),oldTables=tablesFor_(loaded.data),requests=[];
  Object.keys(tables).forEach(n=>requests.push.apply(requests,tableWriteRequests_(n,tables[n],oldTables[n],loaded.sheets[n])));
  let batch=[],batchBytes=32;
  requests.forEach(req=>{const size=Utilities.newBlob(JSON.stringify(req)).getBytes().length+1;if(size>900000)throw Error('단일 레코드 크기를 확인하세요.');if(batchBytes+size>900000){ledgerCall_(spreadsheetId+':batchUpdate','post',{requests:batch});batch=[];batchBytes=32;}batch.push(req);batchBytes+=size;});
  if(batch.length)ledgerCall_(spreadsheetId+':batchUpdate','post',{requests:batch});
  const check=readLedger_(spreadsheetId).data;if(checksum_(check)!==digest)throw Error('분할 적재 무결성 검증 실패. 운영 포인터는 변경하지 않았습니다.');
  props.setProperty(stateKey,JSON.stringify({checksum:digest,ready:true}));return integrity_(check);
}
function restoreToPreparedLedger_(backupFileId,spreadsheetId,expectedOwner,expectedCurrentChecksum){
  verifyPrivateAsset_(DriveApp.getFileById(spreadsheetId),expectedOwner);const file=DriveApp.getFileById(backupFileId);verifyPrivateAsset_(file,expectedOwner);
  return withLock_(function(){const current=readLedger_(ledgerId_()).data;if(checksum_(current)!==expectedCurrentChecksum)throw Error('현재 원장이 변경되었습니다. 최종 백업부터 다시 확인하세요.');const next=validateBackup_(JSON.parse(file.getBlob().getDataAsString()));
    next.accounts.forEach(a=>a.authVersion=Math.max(authVersion_(a),authVersion_(current.accounts.find(x=>x.id===a.id)||{}))+1);next.requests=[];
    const result=stageFullSnapshot_(spreadsheetId,next);PropertiesService.getScriptProperties().setProperty(LEDGER_POINTER,spreadsheetId);return{sourceOfTruth:'Google Sheets',integrity:result,allSessionsRevoked:true};
  });
}
