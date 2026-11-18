import fs from 'node:fs/promises';
import path from 'node:path';

const receipt = path.join(process.env.OVC_E2E_DATA_DIR, 'app-initial-state.json');
const state = JSON.parse(await fs.readFile(receipt, 'utf8'));
await fs.writeFile(process.env.OVC_E2E_DATA_OBSERVATIONS, JSON.stringify({
  'photo-ids': state.photoIds,
  'selected-ids': state.selectedIds,
}, null, 2) + '\n');
