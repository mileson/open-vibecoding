import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function pickerUrl() {
  const directory = process.env.OVC_E2E_DATA_DIR;
  const url = directory
    ? pathToFileURL(path.join(directory, '.fixture', 'web', 'picker.html'))
    : new URL('./picker.html', import.meta.url);
  url.searchParams.set('variant', process.env.PHOTO_VARIANT ?? 'fixed');
  return url.href;
}
