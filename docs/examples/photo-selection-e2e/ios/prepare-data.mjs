import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout } from 'node:timers/promises';

const run = promisify(execFile);
const udid = process.env.PHOTO_SIM_UDID;
if (!udid) throw new Error('PHOTO_SIM_UDID must identify the task-owned, booted simulator');
const app = 'org.openvibecoding.PhotoSelection';
const { stdout } = await run('xcrun', ['simctl', 'get_app_container', udid, app, 'data'], { timeout: 10_000 });
const token = randomUUID();
const receipt = path.join(stdout.trim(), 'Documents', 'ovc-data-' + token + '.json');
await run('xcrun', ['simctl', 'launch', '--terminate-running-process', udid, app, '-photoDataProbe', token], { timeout: 15_000 });
const deadline = Date.now() + 15_000;
while (Date.now() < deadline) {
  try {
    await fs.copyFile(receipt, path.join(process.env.OVC_E2E_DATA_DIR, 'app-initial-state.json'));
    await fs.unlink(receipt);
    process.exit(0);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await setTimeout(250);
}
throw new Error('The launched app did not return its initial selection and photo inventory');
