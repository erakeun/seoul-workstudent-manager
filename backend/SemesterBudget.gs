/** Semester/vacation policy and four-way budget rules for the V5 candidate. */
const WORK_TYPE_NATIONAL = 'NATIONAL';
const WORK_TYPE_INTERNAL = 'INTERNAL';
const PERIOD_TERM = 'TERM';
const PERIOD_GAP = 'BREAK_GAP';
const PERIOD_VACATION = 'VACATION';
const PERIOD_OUTSIDE = 'OUTSIDE';
const PERIOD_CONFIG_REQUIRED = 'CONFIG_REQUIRED';

function normalizedWorkType_(value){
  const text=String(value||'').trim().toLowerCase();
  if(['국가근로','국가','national','nation'].indexOf(text)!==-1)return WORK_TYPE_NATIONAL;
  if(['교내근로','교내','internal','campus'].indexOf(text)!==-1)return WORK_TYPE_INTERNAL;
  return '';
}
function semesterPeriodForDate_(semester,key){
  if(!semester||!key||key<semester.startDate||key>semester.endDate)return PERIOD_OUTSIDE;
  if(!semester.termEndDate||!semester.vacationStartDate||semester.termEndDate<semester.startDate||semester.vacationStartDate<=semester.termEndDate||semester.vacationStartDate>semester.endDate)return PERIOD_CONFIG_REQUIRED;
  if(key<=semester.termEndDate)return PERIOD_TERM;
  if(key<semester.vacationStartDate)return PERIOD_GAP;
  return PERIOD_VACATION;
}
function vacationHoursForSite_(semester,site){
  const hours=semester&&semester.vacationHours||{},candidate=hours[site]||hours.default||{};
  return validTime_(candidate.start)&&validTime_(candidate.end)&&minutes_(candidate.end)>minutes_(candidate.start)?candidate:null;
}
function budgetCategory_(semester,site,workType){
  const key=normalizedWorkType_(workType),legacy=semester&&semester.budgets&&semester.budgets[site]||{},current=legacy.byWorkType&&legacy.byWorkType[key]||{};
  const legacyRate=key===WORK_TYPE_NATIONAL?legacy.rates&&legacy.rates['국가근로']:key===WORK_TYPE_INTERNAL?legacy.rates&&legacy.rates['교내근로']:undefined;
  const total=current.total===null||current.total===undefined?null:Number(current.total),wage=current.wage===null||current.wage===undefined?(legacyRate===undefined?null:Number(legacyRate)):Number(current.wage);
  return{key:key,total:total,wage:wage,configured:!!key&&Number.isFinite(total)&&total>=0&&Number.isFinite(wage)&&wage>0};
}
function kstDateAdd_(key,days){return Utilities.formatDate(new Date(dateTime_(key,'12:00').getTime()+days*86400000),TIMEZONE,'yyyy-MM-dd');}
function mondayKey_(key){const date=dateTime_(key,'12:00'),day=date.getDay()||7;return kstDateAdd_(key,1-day);}
function plannedMinutes_(data,event,key){
  const attendance=data.attendances.find(function(a){return a.workInstanceId===event.workInstanceId;});
  if(attendance&&attendance.checkoutType==='ABSENT')return 0;
  if(attendance&&attendance.recognizedMinutes!==undefined&&attendance.recognizedMinutes!==null&&(key<today_()||attendance.actualCheckOut))return Number(attendance.recognizedMinutes)||0;
  if(key<today_())return 0;
  return Math.max(0,minutes_(event.end)-minutes_(event.start));
}
function weeklyPolicyState_(data,semester){
  const weeks={},start=semester.startDate;
  for(let key=start;key<=semester.endDate;key=kstDateAdd_(key,1)){
    const period=semesterPeriodForDate_(semester,key);if([PERIOD_TERM,PERIOD_VACATION].indexOf(period)===-1)continue;
    const week=mondayKey_(key),weekState=weeks[week]||(weeks[week]={periods:{},students:{}});weekState.periods[period]=true;
    ['general','holmz'].forEach(function(site){eventsForDate_(data,site,key,semester.id,'').forEach(function(event){const s=weekState.students[event.studentId]||(weekState.students[event.studentId]={TERM:0,VACATION:0});s[period]+=plannedMinutes_(data,event,key);});});
  }
  return weeks;
}
function operationalViolations_(data){
  const violations=[];
  data.semesters.forEach(function(semester){
    if(semesterPeriodForDate_(semester,semester.startDate)===PERIOD_CONFIG_REQUIRED)return;
    for(let key=semester.startDate;key<=semester.endDate;key=kstDateAdd_(key,1)){
      if(key<today_())continue;
      if(semesterPeriodForDate_(semester,key)!==PERIOD_VACATION)continue;
      ['general','holmz'].forEach(function(site){const hours=vacationHoursForSite_(semester,site);eventsForDate_(data,site,key,semester.id,'').forEach(function(event){if(!hours||minutes_(event.start)<minutes_(hours.start)||minutes_(event.end)>minutes_(hours.end))violations.push({key:'hours:'+event.workInstanceId,type:'VACATION_HOURS',semesterId:semester.id,site:site,date:key,event:event,hours:hours});});});
    }
    const weeks=weeklyPolicyState_(data,semester),termLimit=Number(semester.termWeeklyLimit||20)*60,vacationLimit=Number(semester.vacationWeeklyLimit||30)*60;
    Object.keys(weeks).forEach(function(week){if(kstDateAdd_(week,6)<today_())return;const state=weeks[week];Object.keys(state.students).forEach(function(studentId){const totals=state.students[studentId];
      [[PERIOD_TERM,termLimit],[PERIOD_VACATION,vacationLimit]].forEach(function(pair){const minutes=totals[pair[0]]||0;if(minutes>pair[1])violations.push({key:'limit:'+semester.id+':'+week+':'+studentId+':'+pair[0],type:'WEEKLY_LIMIT',semesterId:semester.id,week:week,studentId:studentId,period:pair[0],minutes:minutes,limit:pair[1]});});
    });});
  });return violations;
}
function validateChangedOperationalRules_(before,next){
  if(['schedules','exceptions','extraJobs','swaps','students','semesters'].every(function(k){return canonical_(before[k])===canonical_(next[k]);}))return;
  const oldMap={};operationalViolations_(before).forEach(function(v){oldMap[v.key]=v;});
  const violation=operationalViolations_(next).find(function(v){return!oldMap[v.key]||Number(v.minutes||0)>Number(oldMap[v.key].minutes||0);});if(!violation)return;
  if(violation.type==='VACATION_HOURS')throw Error('방학 일정이 설정된 운영시간을 벗어납니다. 방학 시작·종료시간을 확인하세요.');
  const student=next.students.find(function(s){return s.id===violation.studentId;}),beforeSemester=before.semesters.find(function(s){return s.id===violation.semesterId;}),oldWeek=beforeSemester&&weeklyPolicyState_(before,beforeSemester)[violation.week],oldTotals=oldWeek&&oldWeek.students[violation.studentId]||{TERM:0,VACATION:0},current=(violation.period==='MIXED'?oldTotals.TERM+oldTotals.VACATION:Number(oldTotals[violation.period]||0))/60,expected=violation.minutes/60,added=Math.max(0,expected-current),label=violation.period===PERIOD_VACATION?'방학중':violation.period===PERIOD_TERM?'학기중':'경계 주간';
  throw Error((student&&student.name||'학생')+' '+label+' 주간 한도 초과: 현재 '+current.toFixed(1)+'시간 + 추가 '+added.toFixed(1)+'시간 = 예상 '+expected.toFixed(1)+'시간, 허용 최대 '+(violation.limit/60).toFixed(1)+'시간');
}
function adminUpdateBudget_(token,incoming){
  const admin=requireAdmin_(token),data=data_(),semester=data.semesters.find(function(s){return incoming&&s.id===incoming.semesterId;}),site=incoming&&incoming.site,key=normalizedWorkType_(incoming&&incoming.workType),total=Number(incoming&&incoming.total),wage=Number(incoming&&incoming.wage);
  if(!semester||['general','holmz'].indexOf(site)===-1||!key)throw Error('학기·근무지·근로유형을 확인하세요.');
  if(!Number.isFinite(total)||total<0||!Number.isFinite(wage)||wage<=0)throw Error('배정예산은 0원 이상, 시급은 0원보다 커야 합니다.');
  semester.budgets=semester.budgets||{};semester.budgets[site]=semester.budgets[site]||{};semester.budgets[site].byWorkType=semester.budgets[site].byWorkType||{};
  const before=copy_(semester.budgets[site].byWorkType[key]||null),after={total:total,wage:wage};semester.budgets[site].byWorkType[key]=after;
  data.budgetAudit.unshift({id:Utilities.getUuid(),semesterId:semester.id,site:site,workType:key,before:before,after:copy_(after),adminId:admin.id,adminName:admin.name,createdAt:new Date().toISOString()});
  saveData_(data);return{ok:true,data:dataForUser_(data,admin)};
}
