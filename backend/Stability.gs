/** Request-scoped safety boundary shared by EVERY web mutation. */
function handle_(req){
  try{return respond_(withLock_(function(){
    if(req.action==='health')return{ok:true,protocolVersion:5,ready:!!PropertiesService.getScriptProperties().getProperty(LEDGER_POINTER)};
    beginTransaction_();
    try{
      const readOnly=['login','logout','session','loadApp','getProfilePhoto','adminExportBackup'].indexOf(req.action)!==-1;
      if(!readOnly&&req.clientVersion!==5)throw Error('화면 버전이 변경되었습니다. 새로고침 후 다시 시도하세요.');
      let user=null,receipt=null;
      if(!readOnly){
        user=requireUser_(req.token);const requestId=String(req.requestId||''),issuedAt=Number(requestId.split(':')[0]);
        if(!requestId||!Number.isFinite(issuedAt)||Math.abs(Date.now()-issuedAt)>86400000)throw Error('유효한 요청 ID가 필요합니다. 새로고침하세요.');
        const fingerprint=checksum_(Object.assign({},req,{token:undefined}));
        receipt=transaction_.data.requests.find(r=>r.id===requestId&&r.userId===user.id);
        if(receipt){if(receipt.fingerprint!==fingerprint)throw Error('요청 ID 충돌');return{ok:true,replayed:true,data:dataForUser_(transaction_.data,user)};}
        assertRequestRevision_(req,transaction_.data);
        receipt={id:requestId,userId:user.id,fingerprint,createdAt:new Date().toISOString()};
      }
      const result=dispatch_(req);
      if(result.ok&&transaction_.dirty){
        stampRevisions_(transaction_.before,transaction_.data);
        backfillAttendance_(transaction_.data);
        if(req.action!=='adminRestoreBackup'){
          guardRecordedWork_(transaction_.before,transaction_.data);
          validateChangedConflicts_(transaction_.before,transaction_.data);
          validateChangedOperationalRules_(transaction_.before,transaction_.data);
        }
        if(receipt)transaction_.data.requests=transaction_.data.requests.filter(r=>Date.parse(r.createdAt)>Date.now()-2*86400000).concat(receipt);
        finishTransaction_();
        if(result.data)result.data=dataForUser_(transaction_.data,user||requireUser_(req.token));
      }
      return result;
    }finally{transaction_=null;}
  }));}catch(err){return respond_({ok:false,error:err.message||'저장 실패. 다시 조회하세요.'});}
}
function assertRequestRevision_(req,data){
  const targets={adminUpsertUser:['accounts',req.user?.id],adminDeleteUser:['accounts',req.userId],adminUpsertExtraJob:['extraJobs',req.job?.id],adminUpdateSwap:['swaps',req.swapId],adminCancelExtraJob:['extraJobs',req.jobId],adminUpdateExtraApplicant:['extraJobs',req.jobId],adminUpdateBudget:['semesters',req.budget?.semesterId]};
  const target=targets[req.action];if(!target||!target[1])return;const record=data[target[0]].find(r=>r.id===target[1]);if(!record)throw Error('수정 대상이 없습니다.');
  if(Number(req.expectedRevision||0)!==Number(record.revision||0))throw Error('다른 사용자가 수정했습니다. 새로고침하세요.');
}
function stampRevisions_(before,next){LEDGER_TABLES.filter(k=>k!=='requests').forEach(k=>next[k].forEach(record=>{const previous=before[k].find(r=>rowKey_(r)===rowKey_(record));if(canonical_(previous)!==canonical_(record))record.revision=Number(previous?.revision||0)+1;}));}
function authVersion_(user){return Number(user.authVersion||0);}
function sensitiveAccountChange_(old,next){return ['passwordHash','h','salt','s','role','active','studentId','username'].some(k=>old[k]!==next[k]);}
function assertLastAdmin_(data,id,next){if(data.accounts.find(a=>a.id===id&&a.role==='admin'&&a.active)&&(!next||next.role!=='admin'||!next.active)&&!data.accounts.some(a=>a.id!==id&&a.role==='admin'&&a.active))throw Error('마지막 활성 Admin은 비활성화·권한 변경·삭제할 수 없습니다.');}
function pick_(record,fields){const out={};fields.forEach(k=>{if(record[k]!==undefined)out[k]=record[k];});return out;}
function publicStudentData_(data,user){
  const s=studentForUser_(data,user),site=s.site,term=data.settings.activeSemesterId;
  const scoped=items=>items.filter(r=>r.semesterId===term&&(r.site===site||r.site==='all'));
  const eventFields=['id','site','semesterId','studentId','studentName','kind','date','weekday','start','end','scheduleId','type','periodType','effectiveFrom','effectiveUntil'];
  const ownAttendance=data.attendances.filter(a=>a.semesterId===term&&a.studentId===s.id).map(a=>{const safe=pick_(a,['attendanceId','workInstanceId','semesterId','site','studentId','scheduleId','sourceType','workDate','scheduledStart','scheduledEnd','actualCheckIn','actualCheckOut','checkoutType','correctedByAdmin','snapshotVersion','snapshotStatus','recognizedMinutes']);if(a.snapshot)safe.snapshot=pick_(a.snapshot,['id','studentId','studentName','semesterId','site','workDate','start','end','sourceType','isSubstitute','isExtraWork','originalStudentName','title','place']);return safe;});
  return{version:4,protocolVersion:5,settings:{activeSemesterId:term},semesters:data.semesters.map(t=>pick_(t,['id','name','startDate','endDate','termEndDate','vacationStartDate','vacationHours','termWeeklyLimit','vacationWeeklyLimit','mixedWeekPolicy','active'])),students:[safeStudent_(s)],accounts:[],attendanceAudit:[],budgetAudit:[],
    schedules:scoped(data.schedules).map(r=>pick_(r,eventFields)),
    workEligibility:data.students.filter(p=>p.site===site).map(p=>Object.assign(pick_(p,['id','active','inactiveFrom']),{semesterIds:(p.semesterIds||[]).includes(term)?[term]:[],participationEndDates:p.participationEndDates?.[term]?{[term]:p.participationEndDates[term]}:{}})),
    exceptions:scoped(data.exceptions).map(r=>pick_(r,eventFields)),
    swaps:scoped(data.swaps).map(r=>Object.assign(pick_(r,['id','scheduleId','site','semesterId','requesterStudentId','requesterName','date','status','assigneeId','assigneeName']),{reason:r.requesterStudentId===s.id?r.reason:'',applicants:(r.applicants||[]).filter(a=>a.studentId===s.id).map(a=>pick_(a,['studentId','name','appliedAt']))})),
    extraJobs:scoped(data.extraJobs).map(r=>Object.assign(pick_(r,['id','semesterId','site','title','place','date','start','end','capacity','description','status']),{applicantCount:(r.applicants||[]).filter(a=>!['CANCELLED','REJECTED'].includes(a.status)).length,applicants:(r.applicants||[]).filter(a=>a.studentId===s.id||a.status==='CONFIRMED').map(a=>pick_(a,['studentId','name','status']))})),
    attendances:ownAttendance.concat(data.attendances.filter(a=>a.semesterId===term&&a.site===site&&a.studentId!==s.id&&a.checkoutType==='ABSENT').map(a=>pick_(a,['workInstanceId','semesterId','site','studentId','workDate','checkoutType']))),
    notices:scoped(data.notices).map(r=>Object.assign(pick_(r,['id','semesterId','site','title','content','important','author','createdAt']),{readBy:(r.readBy||[]).includes(user.id)?[user.id]:[]})),
    handovers:scoped(data.handovers).map(r=>pick_(r,['id','semesterId','site','title','content','url','important','author','createdAt'])),
    handoverNotes:data.handoverNotes.filter(r=>r.site===site).map(r=>Object.assign(pick_(r,['id','site','authorName','content','createdAt']),{canDelete:r.authorUserId===user.id}))};
}
const MUTABLE_FIELDS={
 students:['name','site','type','studentNumber','phone','email','color','active','semesterIds','participationEndDates','inactiveFrom'],
 schedules:['semesterId','site','studentId','studentName','periodType','kind','weekday','date','start','end','effectiveFrom','effectiveUntil'],
 exceptions:['semesterId','site','type','date','scheduleId','studentId','studentName','start','end','reason'],
 notices:['semesterId','site','title','content','url','important','author','createdAt'],
 handovers:['semesterId','site','title','content','url','important','author','createdAt'],
 semesters:['name','startDate','endDate','termEndDate','vacationStartDate','vacationHours','termWeeklyLimit','vacationWeeklyLimit','mixedWeekPolicy','budgets','active'],settings:['activeSemesterId']
};
function adminMutate_(token,changes){
  const admin=requireAdmin_(token),data=data_();if(!Array.isArray(changes)||!changes.length||changes.length>200)throw Error('변경 항목은 1~200개여야 합니다.');
  const touched=new Set();
  changes.forEach(c=>{
    if(!MUTABLE_FIELDS[c.entity]||!c.id||!['upsert','delete'].includes(c.operation))throw Error('허용하지 않는 변경입니다.');
    const key=c.entity+':'+c.id;if(touched.has(key))throw Error('같은 항목 중복 변경');touched.add(key);
    const list=c.entity==='settings'?[data.settings]:data[c.entity],old=c.entity==='settings'?data.settings:list.find(r=>r.id===c.id);
    if(Number(c.expectedRevision)!==Number(old?.revision||0))throw Error('다른 사용자가 수정했습니다. 새로고침 후 다시 시도하세요.');
    if(c.operation==='delete'){
      if(['students','semesters','settings'].includes(c.entity))throw Error('핵심 데이터는 삭제 대신 참여 종료/비활성화하세요.');
      if(!old)throw Error('삭제 대상이 없습니다.');data[c.entity]=list.filter(r=>r.id!==c.id);return;
    }
    if(!c.fields||Object.keys(c.fields).some(k=>!MUTABLE_FIELDS[c.entity].includes(k)))throw Error('허용하지 않는 필드입니다.');
    const next=Object.assign({},old||{id:c.id,createdAt:new Date().toISOString()},c.fields,{revision:Number(old?.revision||0)+1,updatedAt:new Date().toISOString()});
    if(c.entity==='students'){
      if(!next.name||!['general','holmz'].includes(next.site))throw Error('학생 이름/근무지를 확인하세요.');
      if(old&&old.active!==false&&next.active===false)next.inactiveFrom=today_();
      if(old&&old.active===false&&next.active)delete next.inactiveFrom;
      if(old&&old.site!==next.site){
        const cutoff=today_();data.schedules.filter(r=>r.studentId===old.id&&(!r.effectiveUntil||r.effectiveUntil>=cutoff)).forEach(r=>{if(r.kind==='date'&&r.date<cutoff)return;const future=Object.assign({},r,{id:Utilities.getUuid(),site:next.site,studentName:next.name,effectiveFrom:cutoff,revision:1});r.effectiveUntil=previousDate_(cutoff);r.revision=Number(r.revision||0)+1;data.schedules.push(future);});
      }
    }
    if(c.entity==='schedules'||c.entity==='exceptions'){
      if(!data.students.some(s=>s.id===next.studentId)||!data.semesters.some(s=>s.id===next.semesterId))throw Error('학생 또는 학기를 찾을 수 없습니다.');
      if(next.type!=='cancel'&&(!validTime_(next.start)||!validTime_(next.end)||minutes_(next.end)<=minutes_(next.start)))throw Error('근무시간을 확인하세요.');
      if(c.entity==='schedules'&&['TERM','VACATION'].indexOf(next.periodType||'TERM')===-1)throw Error('근무 일정의 운영 기간을 확인하세요.');
      if(c.entity==='schedules'&&!participates_(data,next.studentId,next.semesterId,next.date||today_()))throw Error('해당 학기에 참여 중인 학생만 배정할 수 있습니다.');
    }
    if(c.entity==='semesters'){
      if(old&&c.fields.budgets!==undefined&&canonical_(c.fields.budgets)!==canonical_(old.budgets))throw Error('예산 변경은 예산 설정 전용 요청을 사용하세요.');
      next.termWeeklyLimit=Number(next.termWeeklyLimit||20);next.vacationWeeklyLimit=Number(next.vacationWeeklyLimit||30);next.termEndDate=next.termEndDate||'';next.vacationStartDate=next.vacationStartDate||'';next.vacationHours=next.vacationHours||{};next.mixedWeekPolicy=next.mixedWeekPolicy||'';
      if(!next.startDate||!next.endDate||next.endDate<next.startDate)throw Error('학기 기간을 확인하세요.');
      if((next.termEndDate||next.vacationStartDate)&&(semesterPeriodForDate_(next,next.startDate)===PERIOD_CONFIG_REQUIRED))throw Error('종강일은 학기 안에, 방학 시작일은 종강일 다음부터 학기 종료일 사이로 설정하세요.');
      ['general','holmz'].forEach(function(site){const hours=next.vacationHours[site]||{},hasStart=!!hours.start,hasEnd=!!hours.end;if(hasStart!==hasEnd||(hasStart&&(!validTime_(hours.start)||!validTime_(hours.end)||minutes_(hours.end)<=minutes_(hours.start))))throw Error('방학 운영시간의 시작·종료를 모두 올바르게 설정하세요.');});
      if(!Number.isFinite(Number(next.termWeeklyLimit))||Number(next.termWeeklyLimit)<=0||!Number.isFinite(Number(next.vacationWeeklyLimit))||Number(next.vacationWeeklyLimit)<=0)throw Error('주간 최대시간은 0보다 커야 합니다.');
      if(next.mixedWeekPolicy&&['SEPARATE_PERIOD_LIMITS','STRICTER_TOTAL_LIMIT'].indexOf(next.mixedWeekPolicy)===-1)throw Error('올바른 경계 주간 정책을 선택하세요.');
    }
    if(c.entity==='settings'){if(!data.semesters.some(s=>s.id===next.activeSemesterId))throw Error('운영 학기를 찾을 수 없습니다.');data.settings=next;data.semesters.forEach(s=>s.active=s.id===next.activeSemesterId);}
    else if(old)list[list.indexOf(old)]=next;else list.push(next);
  });
  saveData_(data);return{ok:true,data:dataForUser_(data,admin)};
}
function validTime_(t){return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)||t==='24:00';}
function previousDate_(key){return Utilities.formatDate(new Date(dateTime_(key,'12:00').getTime()-86400000),TIMEZONE,'yyyy-MM-dd');}
function participates_(data,id,term,date){const s=data.students.find(s=>s.id===id);if(!s)return false;if(s.semesterIds&&!s.semesterIds.includes(term))return false;const end=s.participationEndDates?.[term];if(end&&date>=end)return false;if(s.active===false&&(!s.inactiveFrom||date>=s.inactiveFrom))return false;return true;}
function eventFromAttendance_(a){if(a.snapshot)return Object.assign({},a.snapshot,{workInstanceId:a.workInstanceId,workDate:a.workDate,semesterId:a.semesterId,studentId:a.studentId,site:a.site,start:a.scheduledStart,end:a.scheduledEnd,snapshotStatus:a.snapshotStatus});return null;}
function recognizedMinutes_(a,now){if(a.checkoutType==='ABSENT')return 0;if(!a.actualCheckIn)return 0;const end=dateTime_(a.workDate,a.scheduledEnd),start=dateTime_(a.workDate,a.scheduledStart);if(!a.actualCheckOut&&now<end)return null;return Math.max(0,(Math.min(a.actualCheckOut?Date.parse(a.actualCheckOut):end.getTime(),end.getTime())-Math.max(Date.parse(a.actualCheckIn),start.getTime()))/60000);}
function backfillAttendance_(data){
  data.attendances.forEach(a=>{
    if(!a.snapshot){
      if(!a.studentId||!a.semesterId||!a.site||!/^\d{4}-\d{2}-\d{2}$/.test(a.workDate)||!validTime_(a.scheduledStart)||!validTime_(a.scheduledEnd)||minutes_(a.scheduledEnd)<=minutes_(a.scheduledStart)||(a.actualCheckIn&&!Number.isFinite(Date.parse(a.actualCheckIn)))||(a.actualCheckOut&&!Number.isFinite(Date.parse(a.actualCheckOut)))){a.snapshotStatus='REVIEW_REQUIRED';return;}
      // Only persisted attendance facts are authoritative. Never infer historic worker/site/time from today's schedule.
      a.snapshot={id:a.scheduleId||a.workInstanceId,studentId:a.studentId,studentName:a.studentName||a.studentId,semesterId:a.semesterId,site:a.site,workDate:a.workDate,start:a.scheduledStart,end:a.scheduledEnd,sourceType:a.sourceType,isExtraWork:a.sourceType==='extra',substitutionStatus:a.isSubstitute===undefined?'UNKNOWN_LEGACY':'RECORDED'};
      if(a.isSubstitute!==undefined)a.snapshot.isSubstitute=!!a.isSubstitute;
      a.snapshotVersion=1;a.snapshotStatus='RECORDED_FACTS';
    }
    if(a.recognizedMinutes===undefined||a.recognizedMinutes===null)a.recognizedMinutes=recognizedMinutes_(a,new Date());
  });
}
function captureAttendance_(data,event){data.attendances.filter(a=>a.workInstanceId===event.workInstanceId).forEach(a=>{if(!a.snapshot){a.snapshot=pick_(event,['id','studentId','studentName','semesterId','site','workDate','start','end','periodType','sourceType','isSubstitute','isExtraWork','originalStudentId','originalStudentName','swapId','extraJobId','title','place']);a.snapshotVersion=1;a.snapshotStatus='CAPTURED';const s=data.students.find(s=>s.id===a.studentId),t=data.semesters.find(t=>t.id===a.semesterId),category=budgetCategory_(t,a.site,s&&s.type);a.snapshot.workType=s&&s.type||'';a.snapshot.budgetWorkType=category.key;a.snapshot.wage=category.wage||0;}a.recognizedMinutes=recognizedMinutes_(a,new Date());});}
function guardRecordedWork_(before,next){
  // A changed/cancelled source may not redirect an already recorded instance.
  const shape=event=>event?pick_(event,['studentId','site','start','end']):null;
  before.attendances.forEach(a=>{
    const original=rawEventsForDate_(before,a.site,a.workDate,a.semesterId,'').find(e=>e.workInstanceId===a.workInstanceId);
    const changed=rawEventsForDate_(next,a.site,a.workDate,a.semesterId,'').find(e=>e.workInstanceId===a.workInstanceId);
    if(a.workDate>=today_()&&canonical_(shape(original))!==canonical_(shape(changed)))throw Error('이미 근태/결근 기록이 있는 당일·미래 근무는 변경할 수 없습니다. 근태 보정 절차를 사용하세요.');
    const record=next.attendances.find(r=>r.workInstanceId===a.workInstanceId);
    if(record&&a.snapshot&&canonical_(record.snapshot)!==canonical_(a.snapshot))throw Error('완료 근무 스냅샷 변경은 허용되지 않습니다.');
  });
}
function validateChangedConflicts_(before,next){
  if(['schedules','exceptions','extraJobs','swaps','students'].every(k=>canonical_(before[k])===canonical_(next[k])))return;
  next.semesters.forEach(term=>{const start=term.startDate>today_()?term.startDate:today_();for(let key=start;key<=term.endDate;key=Utilities.formatDate(new Date(dateTime_(key,'12:00').getTime()+86400000),TIMEZONE,'yyyy-MM-dd')){
    const conflicts=data=>{const events=['general','holmz'].flatMap(site=>eventsForDate_(data,site,key,term.id,'')),result=[];events.forEach((a,i)=>events.slice(i+1).forEach(b=>{if(a.studentId===b.studentId&&minutes_(a.start)<minutes_(b.end)&&minutes_(a.end)>minutes_(b.start))result.push([a.workInstanceId,b.workInstanceId].sort().join('|'));}));return result;};
    const old=new Set(conflicts(before));if(conflicts(next).some(k=>!old.has(k)))throw Error('동일 학생의 실제 근무시간이 겹칩니다.');
  }});
}
function adminExportBackup_(token){requireAdmin_(token);return{ok:true,backup:backupEnvelope_(data_())};}
function adminRestoreBackup_(token,backup,expectedChecksum){
  requireAdmin_(token);const before=data_();if(checksum_(before)!==expectedChecksum)throw Error('백업 이후 데이터가 바뀌었습니다. 다시 백업하세요.');const next=validateBackup_(backup);
  // Revoke every existing session on restoration, including sessions from a different backup generation.
  next.accounts.forEach(a=>a.authVersion=Math.max(authVersion_(a),authVersion_(before.accounts.find(b=>b.id===a.id)||{}))+1);
  next.requests=[];saveData_(next);return{ok:true,reauthenticate:true};
}
