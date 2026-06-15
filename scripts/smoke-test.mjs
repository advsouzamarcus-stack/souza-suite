import { readFileSync } from 'node:fs';
const required=['public/index.html','public/app.js','public/style.css','netlify/functions/api.mjs','netlify/functions/datajud-sync.mjs','netlify.toml'];
for(const file of required){
  const text=readFileSync(file,'utf8');
  if(!text.trim()) throw new Error(`${file} vazio`);
}
console.log('Smoke test OK');
