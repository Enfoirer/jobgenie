// Capture existing project records without inventing dates, hours or business activity.
// Run from any directory: node scripts/archive-project-evidence.mjs
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const capturedAt = new Date().toISOString();
const stamp = capturedAt.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const root = path.resolve(repo, '../records/jobgenie/snapshots');
const output = path.join(root, stamp);
await fs.mkdir(root, { recursive: true, mode: 0o700 });
await fs.mkdir(output, { mode: 0o700 });
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
const head = git(['rev-parse', 'HEAD']).trim();
const status = git(['status', '--porcelain']);
const remote = git(['config', '--get', 'remote.origin.url']).trim();
if (!/^https:\/\/github\.com\/Enfoirer\/jobgenie(?:\.git)?$/.test(remote)) throw new Error('Unexpected repository remote');
await fs.writeFile(path.join(output, 'working-tree-status.txt'), status || 'clean\n');
await fs.writeFile(path.join(output, 'commits.jsonl'), git(['log', '--all', '--date=iso-strict', '--format={"sha":"%H","author_date":"%aI","committer_date":"%cI"}']));
await fs.writeFile(path.join(output, 'commit-subjects.txt'), git(['log', '--all', '--date=iso-strict', '--format=%H%x09%aI%x09%cI%x09%s']));
await fs.writeFile(path.join(output, 'head.txt'), head + '\n');
execFileSync('git', ['bundle', 'create', path.join(output, 'repository.bundle'), 'main'], { cwd: repo, stdio: 'pipe' });
execFileSync('git', ['archive', '--format=tar', '--output=' + path.join(output, 'tracked-source.tar'), head], { cwd: repo, stdio: 'pipe' });
const logs = [
  '/private/tmp/job-documents-all-tests2.log',
  '/private/tmp/job-documents-ios-regression.log',
  '/private/tmp/job-documents-final-build.log',
  '/private/tmp/job-documents-web-ui.log',
  '/private/tmp/job-documents-native2.log',
  '/private/tmp/jobgenie-share-tests.log',
  '/private/tmp/jobgenie-share-acceptance3.log',
  '/private/tmp/jobgenie-share-release.log',
];
const copiedLogs = [], missingLogs = [];
await fs.mkdir(path.join(output, 'logs'), { mode: 0o700 });
for (const source of logs) {
  try {
    const info = await fs.stat(source);
    if (!info.isFile() || info.size > 10 * 1024 * 1024) throw new Error('Unsupported log');
    const relative = 'logs/' + path.basename(source);
    await fs.copyFile(source, path.join(output, relative));
    copiedLogs.push({ file: relative, originalPath: source, observedMtime: info.mtime.toISOString() });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    missingLogs.push(source);
  }
}
const files = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(full);
    else {
      const bytes = await fs.readFile(full);
      files.push({ path: path.relative(output, full), bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
  }
}
await collect(output);
await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  capturedAt, timezone: 'Asia/Shanghai', repository: remote, capturedHead: head,
  maintainedWorkbook: 'docs/progress/project-progress.xlsx; no separate workbook copy created',
  sourceArchiveScope: 'Tracked files at capturedHead; uncommitted files are excluded from tar and bundle.',
  timestampLimit: 'Git dates and file modification times are mutable metadata. Capture time and hashes are not third-party timestamp certificates, work-hour records or proof of business revenue.',
  copiedLogs, missingLogs, files,
}, null, 2) + '\n');
for (const file of files) {
  const bytes = await fs.readFile(path.join(output, file.path));
  if (crypto.createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Archive hash mismatch');
}
execFileSync('git', ['bundle', 'verify', path.join(output, 'repository.bundle')], { cwd: repo, stdio: 'pipe' });
console.log(JSON.stringify({ output, capturedAt, capturedHead: head, files: files.length, copiedLogs: copiedLogs.length, missingLogs: missingLogs.length }, null, 2));
