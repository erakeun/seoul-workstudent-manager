/** Standalone PRE-MIGRATION helper. May be added alongside V4 without replacing Code.gs.
 * Fill the NON-SECRET folder ID only after the owner chooses a private folder.
 * Never routes through the Web App; never edits any Script Property or existing file.
 */
const PRE_MIGRATION_BACKUP_FOLDER_ID = '';
function createPreMigrationBackup(){
  if(!PRE_MIGRATION_BACKUP_FOLDER_ID)throw Error('백업 폴더 확인이 먼저 필요합니다.');
  const executionOwner=Session.getEffectiveUser().getEmail();
  if(!executionOwner)throw Error('실행 계정을 확인할 수 없습니다.');
  const folder=DriveApp.getFolderById(PRE_MIGRATION_BACKUP_FOLDER_ID);
  if(folder.getOwner().getEmail()!==executionOwner||folder.getSharingAccess()!==DriveApp.Access.PRIVATE||folder.getEditors().some(u=>u.getEmail()!==executionOwner)||folder.getViewers().length)throw Error('실행 계정 소유자 전용 비공개 백업 폴더가 필요합니다.');
  const original=PropertiesService.getScriptProperties().getProperties();
  const canonical=v=>{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);};
  const checksum=v=>Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canonical(v)));
  const payload={format:'seoul-script-properties-raw',schemaVersion:1,createdAt:new Date().toISOString(),checksum:checksum(original),properties:original};
  const stamp=Utilities.formatDate(new Date(),'Asia/Seoul','yyyyMMdd-HHmmss');
  const file=folder.createFile('seoul-workstudent-premigration-v1-'+stamp+'.json',JSON.stringify(payload),'application/json');
  const readback=JSON.parse(file.getBlob().getDataAsString());if(checksum(readback.properties)!==payload.checksum)throw Error('백업 검증 실패');
  // No secrets are logged. Caller receives only the recovery-file locator and digest.
  return{fileId:file.getId(),fileName:file.getName(),checksum:payload.checksum,propertyCount:Object.keys(original).length,legacyBytes:Utilities.newBlob(original.swtm2||'').getBytes().length,legacyUnchanged:PropertiesService.getScriptProperties().getProperty('swtm2')===original.swtm2,readbackVerified:true};
}
