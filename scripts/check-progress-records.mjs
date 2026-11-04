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
assert.equal(index.workbook,'project-progress.xlsx');
await fs.access(resolve(index.workbook));
const ids=new Set();
for(const record of index.records) {
 assert.match(record.id,/^JG-\d{3}$/);assert(!ids.has(record.id),'Duplicate milestone');ids.add(record.id);
 assert.match(record.commitSha,/^[a-f0-9]{40}$/);
 execFileSync('git',['cat-file','-e',record.commitSha+'^{commit}'],{cwd:repo,stdio:'pipe'});
 const text=await fs.readFile(resolve(record.record),'utf8');
 for(const heading of ['Requirements and key decisions','Tests and builds','Screenshots or API examples','Deployment observations']) assert(text.includes('## '+heading),record.id+' missing '+heading);
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
// English prose is required for maintained records. Original logs/images and
// fixed historical sources retain their language and byte identity.
let authoredFiles=0,localLinks=0;
async function checkEnglish(directory) {
 for(const entry of await fs.readdir(directory,{withFileTypes:true})) {
  const file=path.join(directory,entry.name);
  if(entry.isDirectory()) await checkEnglish(file);
  else if(/\.(md|json)$/.test(entry.name)) {
   const text=await fs.readFile(file,'utf8');
   assert(!/\p{Script=Han}/u.test(entry.name+text),'Non-English maintained record: '+path.relative(repo,file));
   authoredFiles++;
   if(entry.name.endsWith('.md')) for(const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
    const href=match[1];
    if(/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#')) continue;
    const target=path.resolve(path.dirname(file),decodeURIComponent(href.split('#')[0]));
    assert(target.startsWith(repo+path.sep),'Documentation link escapes repository');
    await fs.access(target);localLinks++;
   }
  }
 }
}
await checkEnglish(root);
await checkEnglish(path.join(repo,'docs/evidence'));
for(const name of await fs.readdir(path.join(repo,'docs'))) {
 if(!name.endsWith('-acceptance.md')) continue;
 const text=await fs.readFile(path.join(repo,'docs',name),'utf8');
 assert(!/\p{Script=Han}/u.test(text),'Non-English acceptance record: '+name);
 authoredFiles++;
}
console.log(JSON.stringify({result:'passed',milestones:ids.size,artifacts:index.artifacts.length,workbooks:1,englishRecordFiles:authoredFiles,localLinks},null,2));
