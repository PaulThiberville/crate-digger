/** Windows reserved device names: illegal as a base file name. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
/** Characters Windows refuses in file names, plus control characters. */
const ILLEGAL = /[<>:"/\\|?*\p{Cc}]/gu;

/** `Uploader - Title.ext`: readable in a flat folder, safe on Windows and macOS. */
export function fileName(uploader: string, title: string, ext: string): string {
  const clean = (s: string) => s.normalize('NFC').replace(ILLEGAL, '').replace(/\s+/g, ' ').trim();
  let base = [clean(uploader), clean(title)].filter(Boolean).join(' - ').slice(0, 120).replace(/[. ]+$/, '');
  if (!base) base = 'untitled';
  if (RESERVED.test(base)) base = `${base} (track)`;
  return `${base}.${ext}`;
}
