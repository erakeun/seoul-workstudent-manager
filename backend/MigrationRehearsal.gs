/** Owner-run production migration rehearsal. Never switches LEDGER_POINTER. */
const REHEARSAL_BACKUP_FOLDER_ID='1cgXvSe3c4AM31NAZ2XwYSLIzpioulRg-';
const REHEARSAL_SPREADSHEET_ID='1b8WiwwkI0WVv4uZaGGHEvzvylqlpk_HyNx5jDOgsV2U';

function rehearsalOwner_(){const owner=Session.getEffectiveUser().getEmail();if(!owner)throw Error('실행 계정을 확인할 수 없습니다.');return owner;}
function latestMatchingRawBackup_(){
  const folder=DriveApp.getFolderById(REHEARSAL_BACKUP_FOLDER_ID),owner=rehearsalOwner_();verifyPrivateAsset_(folder,owner);
  const raw=PropertiesService.getScriptProperties().getProperty(DATA_KEY),files=folder.getFiles();let best=null;
  while(files.hasNext()){
    const file=files.next();if(file.getMimeType()!=='application/json')continue;
    try{const value=JSON.parse(file.getBlob().getDataAsString());if(value.format==='seoul-script-properties-raw'&&value.schemaVersion===1&&value.checksum===checksum_(value.properties)&&value.properties[DATA_KEY]===raw&&(!best||file.getDateCreated()>best.file.getDateCreated()))best={file:file,value:value};}catch(_){}
  }
  if(!best)throw Error('현재 swtm2와 일치하는 재읽기 검증 백업이 없습니다.');verifyPrivateAsset_(best.file,owner);return best;
}
function rehearsalLog_(label,value){console.log(label+': '+JSON.stringify(value));return value;}
function prepareProductionLedgerCandidate(){return rehearsalLog_('PREPARE',prepareLedger_(REHEARSAL_SPREADSHEET_ID,rehearsalOwner_()));}
function diagnoseSheetsApiAccess(){const response=UrlFetchApp.fetch('https://sheets.googleapis.com/v4/spreadsheets/'+REHEARSAL_SPREADSHEET_ID+'?fields=spreadsheetId%2Cproperties.title',{headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},muteHttpExceptions:true});let body={};try{body=JSON.parse(response.getContentText());}catch(_){body={message:response.getContentText().slice(0,500)};}return rehearsalLog_('SHEETS_API',{status:response.getResponseCode(),error:body.error?{code:body.error.code,status:body.error.status,message:body.error.message}:null,title:body.properties&&body.properties.title});}
function runProductionMigrationRehearsal(){const backup=latestMatchingRawBackup_(),started=Date.now(),result=migrateLegacy_(REHEARSAL_SPREADSHEET_ID,backup.file.getId(),rehearsalOwner_()),summary={backupFileId:backup.file.getId(),backupChecksum:backup.value.checksum,elapsedMs:Date.now()-started,integrity:result.integrity,reviewRequiredCount:(result.uncertain||[]).length,reused:!!result.reused,sourceOfTruth:PropertiesService.getScriptProperties().getProperty(LEDGER_POINTER)?'Google Sheets':'swtm2'};return rehearsalLog_('MIGRATION',summary);}
function removedCandidateRows_(before,next){
  const beforeTables=tablesFor_(before),nextTables=tablesFor_(next),removed=[];
  Object.keys(beforeTables).forEach(function(name){
    const nextIds=new Set(nextTables[name].map(rowKey_));
    beforeTables[name].map(rowKey_).filter(Boolean).forEach(function(id){if(!nextIds.has(id))removed.push(name+':'+id);});
  });
  return removed;
}
/** Refreshes a previously verified rehearsal ledger after additive/updated V4 data.
 * It refuses any operation that would remove a row, never changes the production
 * pointer, and requires a fresh raw backup matching the current swtm2 value.
 */
function refreshProductionMigrationCandidate(){
  const owner=rehearsalOwner_(),backup=latestMatchingRawBackup_();
  verifyPrivateAsset_(DriveApp.getFileById(REHEARSAL_SPREADSHEET_ID),owner);
  return withLock_(function(){
    const props=PropertiesService.getScriptProperties();
    if(props.getProperty(LEDGER_POINTER))throw Error('운영 원장 전환 전 후보에서만 실행할 수 있습니다.');
    const raw=props.getProperty(DATA_KEY),source=rehearseMigration_(raw),next=source.data;
    if(backup.value.properties[DATA_KEY]!==raw)throw Error('최신 원본 백업이 아닙니다.');
    next.migrationSourceChecksum=checksum_(raw);
    const loaded=readLedger_(REHEARSAL_SPREADSHEET_ID),removed=removedCandidateRows_(loaded.data,next);
    if(removed.length)throw Error('후보 갱신에 행 삭제가 필요합니다. 새 빈 원장을 사용하세요. 삭제 대상 '+removed.length+'건');
    writeLedger_(REHEARSAL_SPREADSHEET_ID,loaded.data,next,loaded.sheets);
    const verified=readLedger_(REHEARSAL_SPREADSHEET_ID).data,digest=checksum_(next);
    if(checksum_(verified)!==digest)throw Error('후보 갱신 후 체크섬 불일치. 운영 전환 금지.');
    props.setProperty('swtm_stage_'+REHEARSAL_SPREADSHEET_ID,JSON.stringify({checksum:digest,ready:true}));
    return rehearsalLog_('REFRESH',{backupFileId:backup.file.getId(),integrity:integrity_(verified),reviewRequiredCount:source.uncertain.length,removedCount:0,sourceOfTruth:'swtm2'});
  });
}
function activateProductionLedgerCandidate(){
  const owner=rehearsalOwner_(),backup=latestMatchingRawBackup_(),props=PropertiesService.getScriptProperties(),raw=props.getProperty(DATA_KEY);
  if(props.getProperty(LEDGER_POINTER))throw Error('운영 원장이 이미 지정되어 있습니다.');
  if(backup.value.properties[DATA_KEY]!==raw)throw Error('최종 백업 이후 운영 원본이 변경되었습니다. 다시 백업하세요.');
  const source=rehearseMigration_(raw),target=readLedger_(REHEARSAL_SPREADSHEET_ID).data,expected=copy_(source.data);expected.migrationSourceChecksum=checksum_(raw);
  if(checksum_(target)!==checksum_(expected))throw Error('최종 원본과 후보 원장이 다릅니다. 운영 전환 금지.');
  if(source.uncertain.length)throw Error('불확실한 과거 근태 확인이 먼저 필요합니다.');
  const activated=activateLedger_(REHEARSAL_SPREADSHEET_ID,owner,checksum_(target));
  return rehearsalLog_('ACTIVATE',{backupFileId:backup.file.getId(),integrity:integrity_(target),sourceOfTruth:activated.sourceOfTruth,legacy:activated.legacy});
}
function verifyProductionMigrationRehearsal(){
  const raw=PropertiesService.getScriptProperties().getProperty(DATA_KEY),source=rehearseMigration_(raw),started=Date.now(),target=readLedger_(REHEARSAL_SPREADSHEET_ID).data,readMs=Date.now()-started,validated=validateLedger_(target),expected=copy_(source.data);expected.migrationSourceChecksum=checksum_(raw);
  return rehearsalLog_('VERIFY',{source:source.original,target:integrity_(target),expectedTarget:integrity_(expected),countsMatch:canonical_(source.target.counts)===canonical_(integrity_(target).counts),checksumMatch:checksum_(expected)===checksum_(target),relationIntegrity:validated,reviewRequiredCount:source.uncertain.length,readMs:readMs,sourceOfTruth:PropertiesService.getScriptProperties().getProperty(LEDGER_POINTER)?'Google Sheets':'swtm2'});
}
function runCandidateReadWriteRoundTrip(){
  return withLock_(function(){
    const loaded=readLedger_(REHEARSAL_SPREADSHEET_ID),before=copy_(loaded.data),beforeChecksum=checksum_(before),probe=copy_(before),token=Utilities.getUuid();probe.rehearsalProbe={token:token,createdAt:new Date().toISOString()};
    const writeStarted=Date.now();writeLedger_(REHEARSAL_SPREADSHEET_ID,before,probe,loaded.sheets);const writeMs=Date.now()-writeStarted,changed=readLedger_(REHEARSAL_SPREADSHEET_ID),changedOk=changed.data.rehearsalProbe&&changed.data.rehearsalProbe.token===token;
    const restoreStarted=Date.now();writeLedger_(REHEARSAL_SPREADSHEET_ID,changed.data,before,changed.sheets);const restoreMs=Date.now()-restoreStarted,restored=readLedger_(REHEARSAL_SPREADSHEET_ID).data,restoredChecksum=checksum_(restored);
    if(!changedOk||restoredChecksum!==beforeChecksum)throw Error('실제 Sheets 변경/복원 round-trip 검증 실패');
    return rehearsalLog_('ROUND_TRIP',{changedReadback:true,restored:true,beforeChecksum:beforeChecksum,restoredChecksum:restoredChecksum,writeMs:writeMs,restoreMs:restoreMs});
  });
}
function runCandidateConcurrencyWriterA(){return candidateConcurrencyWriter_('A');}
function runCandidateConcurrencyWriterB(){return candidateConcurrencyWriter_('B');}
function candidateConcurrencyWriter_(label){
  return withLock_(function(){const loaded=readLedger_(REHEARSAL_SPREADSHEET_ID),next=copy_(loaded.data),token=Utilities.getUuid();next.rehearsalConcurrency=Object.assign({},next.rehearsalConcurrency||{});next.rehearsalConcurrency[label]={token:token,createdAt:new Date().toISOString()};Utilities.sleep(1800);writeLedger_(REHEARSAL_SPREADSHEET_ID,loaded.data,next,loaded.sheets);return rehearsalLog_('CONCURRENCY_'+label,{writer:label,token:token,retained:Object.keys(readLedger_(REHEARSAL_SPREADSHEET_ID).data.rehearsalConcurrency||{}).sort()});});
}
function verifyAndRestoreCandidateConcurrency(){
  return withLock_(function(){const loaded=readLedger_(REHEARSAL_SPREADSHEET_ID),retained=Object.keys(loaded.data.rehearsalConcurrency||{}).sort(),next=copy_(loaded.data);delete next.rehearsalConcurrency;writeLedger_(REHEARSAL_SPREADSHEET_ID,loaded.data,next,loaded.sheets);const restored=readLedger_(REHEARSAL_SPREADSHEET_ID).data,raw=PropertiesService.getScriptProperties().getProperty(DATA_KEY),expected=rehearseMigration_(raw).data;expected.migrationSourceChecksum=checksum_(raw);const result={retained:retained,bothRetained:canonical_(retained)===canonical_(['A','B']),restored:checksum_(restored)===checksum_(expected)};if(!result.bothRetained||!result.restored)throw Error('실제 Sheets Lost Update/복원 검증 실패');return rehearsalLog_('CONCURRENCY_VERIFY',result);});
}
function verifyPastAttendanceImmutability(){
  const original=normalizeData_(JSON.parse(PropertiesService.getScriptProperties().getProperty(DATA_KEY))),target=readLedger_(REHEARSAL_SPREADSHEET_ID).data,fields=['attendanceId','workInstanceId','semesterId','site','studentId','scheduleId','sourceType','workDate','scheduledStart','scheduledEnd','actualCheckIn','actualCheckOut','checkoutType','correctedByAdmin','createdAt','updatedAt'],mismatches=[];
  original.attendances.forEach(a=>{const b=target.attendances.find(x=>(x.attendanceId||x.id)===(a.attendanceId||a.id));if(!b||fields.some(k=>canonical_(a[k])!==canonical_(b[k])))mismatches.push(a.attendanceId||a.id);});
  return rehearsalLog_('ATTENDANCE_IMMUTABILITY',{sourceCount:original.attendances.length,targetCount:target.attendances.length,unchanged:mismatches.length===0,mismatchCount:mismatches.length});
}
function verifyKstUtcInAppsScript(){const samples=[['2026-09-08','00:00','2026-09-07T15:00:00.000Z'],['2026-12-31','24:00','2026-12-31T15:00:00.000Z']];const results=samples.map(s=>{const date=dateTime_(s[0],s[1]),roundTrip=Utilities.formatDate(date,TIMEZONE,'yyyy-MM-dd HH:mm');return{input:s[0]+' '+s[1],iso:date.toISOString(),roundTrip:roundTrip,pass:date.toISOString()===s[2]};});return rehearsalLog_('KST_UTC',{timezone:TIMEZONE,pass:results.every(r=>r.pass),results:results});}
function verifyCurrentSessionRevokeBoundary(){const props=PropertiesService.getScriptProperties().getProperties(),keys=Object.keys(props).filter(k=>k.indexOf(SESSION_PREFIX)===0),sessions=[],invalid=[];keys.forEach(k=>{try{sessions.push(JSON.parse(props[k]));}catch(_){invalid.push(k);}});const result={currentSessionCount:keys.length,parseableCount:sessions.length,invalidCount:invalid.length,allCurrentSessionsRejectedByV5:sessions.every(s=>s.authVersion===undefined),mutationPerformed:false};return rehearsalLog_('SESSION_BOUNDARY',result);}
function rehearsalBackfillAttendance_(data){
  const valid=t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)||t==='24:00';
  data.attendances.forEach(a=>{
    if(!a.snapshot){if(!a.studentId||!a.semesterId||!a.site||!/^\d{4}-\d{2}-\d{2}$/.test(a.workDate)||!valid(a.scheduledStart)||!valid(a.scheduledEnd)||minutes_(a.scheduledEnd)<=minutes_(a.scheduledStart)||(a.actualCheckIn&&!Number.isFinite(Date.parse(a.actualCheckIn)))||(a.actualCheckOut&&!Number.isFinite(Date.parse(a.actualCheckOut)))){a.snapshotStatus='REVIEW_REQUIRED';return;}a.snapshot={id:a.scheduleId||a.workInstanceId,studentId:a.studentId,studentName:a.studentName||a.studentId,semesterId:a.semesterId,site:a.site,workDate:a.workDate,start:a.scheduledStart,end:a.scheduledEnd,sourceType:a.sourceType,isExtraWork:a.sourceType==='extra',substitutionStatus:a.isSubstitute===undefined?'UNKNOWN_LEGACY':'RECORDED'};if(a.isSubstitute!==undefined)a.snapshot.isSubstitute=!!a.isSubstitute;a.snapshotVersion=1;a.snapshotStatus='RECORDED_FACTS';}
    if(a.recognizedMinutes===undefined||a.recognizedMinutes===null){if(a.checkoutType==='ABSENT'||!a.actualCheckIn)a.recognizedMinutes=0;else{const end=dateTime_(a.workDate,a.scheduledEnd),start=dateTime_(a.workDate,a.scheduledStart),now=new Date();if(!a.actualCheckOut&&now<end)a.recognizedMinutes=null;else a.recognizedMinutes=Math.max(0,(Math.min(a.actualCheckOut?Date.parse(a.actualCheckOut):end.getTime(),end.getTime())-Math.max(Date.parse(a.actualCheckIn),start.getTime()))/60000);}}
  });
}
