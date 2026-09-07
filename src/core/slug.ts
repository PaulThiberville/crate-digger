/** Windows reserved device names — illegal as file or folder names. */
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Lowercase ASCII slug, safe on Windows and macOS. */
export function slugify(input: string, fallback = 'untitled'): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  if (!slug) return fallback;
  return RESERVED.test(slug) ? `${slug}-track` : slug;
}

/** Permalinks are already URL-safe; keep them recognisable, only make them filesystem-safe. */
export function safeName(permalink: string, fallback = 'unknown'): string {
  const name = permalink
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
  if (!name) return fallback;
  return RESERVED.test(name) ? `${name}-user` : name;
}
