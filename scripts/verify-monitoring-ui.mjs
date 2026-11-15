import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import User from '../lib/models/User.js';
import ErrorIncident from '../lib/models/ErrorIncident.js';

export async function verifyMonitoring({ user, send, evaluate, wait, click, fill, base }) {
  await ErrorIncident.init();
  // The browser message deliberately contains sensitive fixture strings. The
  // reporting implementation receives only the event category and safe route.
  await evaluate('window.dispatchEvent(new ErrorEvent("error", {message:"fixture-password fixture-token private-mail-body", error:new Error("fixture-password fixture-token private-mail-body")}))');
  await wait('document.querySelector("aside[role=alert]")?.textContent.includes("JG-")', 'visible diagnostic reference');
  const reference = await evaluate('document.querySelector("aside[role=alert]").textContent.match(/JG-[a-f0-9-]{36}/)[0]');
  const row = await ErrorIncident.findById(reference).lean();
  assert.equal(row.kind, 'unhandled_error'); assert.equal(row.platform, 'web');
  const serialized = JSON.stringify(await ErrorIncident.collection.find({}).toArray());
  for (const secret of ['fixture-password', 'fixture-token', 'private-mail-body']) assert.equal(serialized.includes(secret), false);
  assert.equal(await evaluate('fetch("/api/admin/errors").then(r=>r.status)'), 403);
  await User.updateOne({ _id: user._id }, { $set: { role: 'admin' } });
  await send('Page.navigate', {url:base+'/dashboard/admin/errors'});
  await wait('!!document.querySelector("[data-error-item]")', 'administrator error lookup');
  await fill('input[name=reference]', reference); await click('Find errors');
  await wait(`document.querySelector('[data-error-item]')?.textContent.includes('${reference}')`, 'reference match');
  assert.equal(await evaluate('document.querySelectorAll("[data-error-item]").length'), 1);
  const directory=process.env.PROGRESS_CAPTURE_DIR || '/private/tmp/jobgenie-monitor-captures'; await fs.mkdir(directory,{recursive:true});
  await send('Emulation.setDeviceMetricsOverride',{width:1280,height:1000,deviceScaleFactor:1,mobile:false});
  const capture=await send('Page.captureScreenshot',{format:'png'});await fs.writeFile(directory+'/error-review.png',Buffer.from(capture.data,'base64'));
  await User.updateOne({_id:user._id},{$set:{role:'user'}}); await click('Refresh errors');
  await wait('document.querySelector("[role=alert]")?.textContent.includes("Administrator access required")','revoked admin denied');
  assert.equal(await evaluate('document.querySelectorAll("[data-error-item]").length'),0);
  await fs.writeFile(directory+'/monitoring-example.json', JSON.stringify({environment:'disposable local NextAuth/MongoDB/browser',reference,storedKind:row.kind,storedRoute:row.route,sensitiveFixtureValuesAbsent:true,ordinaryUserStatus:403,adminReferenceLookup:true,revocationClearsView:true},null,2));
  console.log('PASS browser error produced a visible durable reference; sensitive fixtures absent from database; administrator lookup, ordinary-user denial and revocation clearing passed.');
}
