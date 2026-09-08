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
function verifyPastAttendanceImmutability(){
  const original=normalizeData_(JSON.parse(PropertiesService.getScriptProperties().getProperty(DATA_KEY))),target=readLedger_(REHEARSAL_SPREADSHEET_ID).data,fields=['attendanceId','workInstanceId','semesterId','site','studentId','scheduleId','sourceType','workDate','scheduledStart','scheduledEnd','actualCheckIn','actualCheckOut','checkoutType','correctedByAdmin','createdAt','updatedAt'],mismatches=[];
  original.attendances.forEach(a=>{const b=target.attendances.find(x=>(x.attendanceId||x.id)===(a.attendanceId||a.id));if(!b||fields.some(k=>canonical_(a[k])!==canonical_(b[k])))mismatches.push(a.attendanceId||a.id);});
  return rehearsalLog_('ATTENDANCE_IMMUTABILITY',{sourceCount:original.attendances.length,targetCount:target.attendances.length,unchanged:mismatches.length===0,mismatchCount:mismatches.length});
}
function verifyKstUtcInAppsScript(){const samples=[['2026-09-08','00:00','2026-09-07T15:00:00.000Z'],['2026-12-31','24:00','2026-12-31T15:00:00.000Z']];const results=samples.map(s=>{const date=dateTime_(s[0],s[1]),roundTrip=Utilities.formatDate(date,TIMEZONE,'yyyy-MM-dd HH:mm');return{input:s[0]+' '+s[1],iso:date.toISOString(),roundTrip:roundTrip,pass:date.toISOString()===s[2]};});return rehearsalLog_('KST_UTC',{timezone:TIMEZONE,pass:results.every(r=>r.pass),results:results});}
function rehearsalBackfillAttendance_(data){
  const valid=t=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)||t==='24:00';
  data.attendances.forEach(a=>{
    if(!a.snapshot){if(!a.studentId||!a.semesterId||!a.site||!/^\d{4}-\d{2}-\d{2}$/.test(a.workDate)||!valid(a.scheduledStart)||!valid(a.scheduledEnd)||minutes_(a.scheduledEnd)<=minutes_(a.scheduledStart)||(a.actualCheckIn&&!Number.isFinite(Date.parse(a.actualCheckIn)))||(a.actualCheckOut&&!Number.isFinite(Date.parse(a.actualCheckOut)))){a.snapshotStatus='REVIEW_REQUIRED';return;}a.snapshot={id:a.scheduleId||a.workInstanceId,studentId:a.studentId,studentName:a.studentName||a.studentId,semesterId:a.semesterId,site:a.site,workDate:a.workDate,start:a.scheduledStart,end:a.scheduledEnd,sourceType:a.sourceType,isExtraWork:a.sourceType==='extra',substitutionStatus:a.isSubstitute===undefined?'UNKNOWN_LEGACY':'RECORDED'};if(a.isSubstitute!==undefined)a.snapshot.isSubstitute=!!a.isSubstitute;a.snapshotVersion=1;a.snapshotStatus='RECORDED_FACTS';}
    if(a.recognizedMinutes===undefined||a.recognizedMinutes===null){if(a.checkoutType==='ABSENT'||!a.actualCheckIn)a.recognizedMinutes=0;else{const end=dateTime_(a.workDate,a.scheduledEnd),start=dateTime_(a.workDate,a.scheduledStart),now=new Date();if(!a.actualCheckOut&&now<end)a.recognizedMinutes=null;else a.recognizedMinutes=Math.max(0,(Math.min(a.actualCheckOut?Date.parse(a.actualCheckOut):end.getTime(),end.getTime())-Math.max(Date.parse(a.actualCheckIn),start.getTime()))/60000);}}
  });
}
