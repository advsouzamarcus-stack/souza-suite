import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function replaceInFile(path, replacements) {
  if (!existsSync(path)) return;
  let text = readFileSync(path, 'utf8');
  let changed = false;

  for (const [pattern, replacement] of replacements) {
    const next = text.replace(pattern, replacement);
    if (next !== text) {
      text = next;
      changed = true;
    }
  }

  if (changed) {
    writeFileSync(path, text, 'utf8');
    console.log('[sanitize] cleaned ' + path);
  }
}

replaceInFile('netlify/functions/sync.mjs', [
  [
    /const\s+SUPA_URL\s*=\s*Netlify\.env\.get\('SUPABASE_URL'\)\s*\|\|\s*['"]https:\/\/[^'"]+\.supabase\.co['"];/g,
    "const SUPA_URL = Netlify.env.get('SUPABASE_URL');"
  ]
]);

replaceInFile('index.html', [
  [/key\s*:\s*['"]AIza[^'"]+['"]/g, "key:''"],
  [/calIcsPriv\s*:\s*['"][^'"]+['"]/g, "calIcsPriv:''"]
]);

console.log('Secret sanitizer OK');
