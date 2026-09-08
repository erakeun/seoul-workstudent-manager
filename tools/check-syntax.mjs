import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
execFileSync(process.execPath,['--check','app.js'],{stdio:'inherit'});
const files=fs.readdirSync('backend').filter(f=>f.endsWith('.gs'));
new vm.Script(files.map(f=>fs.readFileSync('backend/'+f,'utf8')).join('\n'));
console.log('app.js and all Apps Script files: syntax OK');
