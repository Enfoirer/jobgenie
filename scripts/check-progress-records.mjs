// Validate the public delivery records without rerunning historical application tests.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.join(repo,'docs/progress');
const index=JSON.parse(await fs.readFile(path.join(root,'evidence-index.json'),'utf8'));
const resolve=relative=>{
 const full=path.resolve(root,relative);
 assert(full.startsWith(root+path.sep),'Evidence path escapes progress directory');
 return full;
};
assert.equal(index.workbook,'JobGenie项目进展.xlsx');
const ids=new Set();
for(const record of index.records) {
 assert.match(record.id,/^JG-\d{3}$/);assert(!ids.has(record.id),'Duplicate milestone');ids.add(record.id);
 assert.match(record.commitSha,/^[a-f0-9]{40}$/);
 execFileSync('git',['cat-file','-e',record.commitSha+'^{commit}'],{cwd:repo,stdio:'pipe'});
 const text=await fs.readFile(resolve(record.record),'utf8');
 for(const heading of ['需求与关键决策','测试与构建记录','成果画面或接口示例','部署记录']) assert(text.includes('## '+heading),record.id+' missing '+heading);
 for(const file of [...record.rawLogs,...record.visuals]) await fs.access(resolve(file));
}
for(const artifact of index.artifacts) {
 const data=await fs.readFile(resolve(artifact.file));
 assert.equal(crypto.createHash('sha256').update(data).digest('hex'),artifact.sha256,'Changed artifact: '+artifact.file);
 assert(artifact.collectedAt && artifact.description,'Missing provenance');
 if(artifact.kind==='test_log') {
  const text=data.toString('utf8');
  assert(!/\/Users\/[a-zA-Z0-9_-]+\//.test(text),'Home path in public log');
  const credentials=[...text.matchAll(/\b(?:NEXTAUTH_SECRET|OPENAI_API_KEY|GOOGLE_CLIENT_SECRET|OUTLOOK_CLIENT_SECRET|RESEND_API_KEY|MONGODB_URI)\s*[=:]\s*([^\s,;]+)/g)];
  assert(credentials.every(match=>match[1]==='[REDACTED]'),'Credential assignment in public log');
 }
}
async function countBooks(directory) {
 let count=0;
 for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
  if(entry.isDirectory()) count+=await countBooks(path.join(directory,entry.name));
  else if(entry.name.endsWith('.xlsx')) count++;
 }
 return count;
}
assert.equal(await countBooks(root),1,'Maintain only the original progress workbook');
console.log(JSON.stringify({result:'passed',milestones:ids.size,artifacts:index.artifacts.length,workbooks:1},null,2));
