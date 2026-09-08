/** Standalone PRE-MIGRATION helper. May be added alongside V4 without replacing Code.gs.
 * Fill these two NON-SECRET values only after the owner chooses a private folder.
 * Never routes through the Web App; never edits any Script Property or existing file.
 */
const PRE_MIGRATION_BACKUP_FOLDER_ID = '';
const PRE_MIGRATION_EXPECTED_OWNER = '';
function createPreMigrationBackup(){
  if(!PRE_MIGRATION_BACKUP_FOLDER_ID||!PRE_MIGRATION_EXPECTED_OWNER)throw Error('백업 폴더와 소유자 확인이 먼저 필요합니다.');
  const folder=DriveApp.getFolderById(PRE_MIGRATION_BACKUP_FOLDER_ID);
  if(folder.getOwner().getEmail()!==PRE_MIGRATION_EXPECTED_OWNER||folder.getSharingAccess()!==DriveApp.Access.PRIVATE||folder.getEditors().some(u=>u.getEmail()!==PRE_MIGRATION_EXPECTED_OWNER)||folder.getViewers().length)throw Error('소유자 전용 비공개 백업 폴더가 필요합니다.');
  const original=PropertiesService.getScriptProperties().getProperties();
  const canonical=v=>{if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return JSON.stringify(v);};
  const checksum=v=>Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,canonical(v)));
  const payload={format:'seoul-script-properties-raw',schemaVersion:1,createdAt:new Date().toISOString(),checksum:checksum(original),properties:original};
  const file=folder.createFile('private-properties-'+Date.now()+'.json',JSON.stringify(payload),'application/json');
  const readback=JSON.parse(file.getBlob().getDataAsString());if(checksum(readback.properties)!==payload.checksum)throw Error('백업 검증 실패');
  // No secrets are logged. Caller receives only the recovery-file locator and digest.
  return{fileId:file.getId(),checksum:payload.checksum,legacyUnchanged:PropertiesService.getScriptProperties().getProperty('swtm2')===original.swtm2};
}
