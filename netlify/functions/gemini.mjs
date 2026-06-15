// gemini.mjs v3 — proxy Google Gemini com fallback automático
// SEM dependência de JWT_SECRET

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,X-Gemini-Model',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s, headers:CORS});

// Modelos em ordem de preferência (verificado em Jun 2026)
const MODELS = [
  'gemini-2.0-flash-exp',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash',
  'gemini-1.5-pro',
  'gemini-pro',
];

export default async (req) => {
  if(req.method === 'OPTIONS') return new Response('', {status:204, headers:CORS});
  if(req.method !== 'POST') return err('Método não suportado', 405);

  let body;
  try { body = await req.json(); }
  catch { return err('JSON inválido'); }

  const { apiKey, messages=[], system='', action, maxTokens=600 } = body;
  if(!apiKey) return err('apiKey obrigatório');

  // Validar formato da key Gemini
  if(!apiKey.startsWith('AIza')) {
    return err(
      'API Key do Gemini inválida. Keys válidas sempre começam com "AIza". ' +
      'Obtenha em: aistudio.google.com/apikey',
      400
    );
  }

  // ── Listar modelos disponíveis ───────────────────────────────
  if(action === 'list') {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      const d = await r.json();
      if(!r.ok) return err(d?.error?.message || 'Erro ao listar modelos', r.status);
      const available = (d.models||[])
        .filter(m => (m.supportedGenerationMethods||[]).includes('generateContent'))
        .map(m => ({ id: m.name.replace('models/',''), name: m.displayName }));
      return ok({ ok:true, models: available });
    } catch(e) { return err('Erro: ' + e.message, 500); }
  }

  // ── Gerar conteúdo com fallback automático ───────────────────
  const preferred = req.headers.get('X-Gemini-Model') || 'gemini-2.0-flash';
  // Colocar modelo preferido primeiro
  const order = [preferred, ...MODELS.filter(m => m !== preferred)];

  // Montar contents no formato Gemini
  const contents = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: String(m.content||'') }]
  }));
  if(!contents.length) contents.push({ role:'user', parts:[{text:'Olá'}] });

  const reqBody = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 }
  };

  const tried = [];
  for(const model of order) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const r   = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      const d = await r.json();

      if(r.ok) {
        const text = d.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return ok({ ok:true, text, model, fallback: model !== preferred });
      }

      const msg = d?.error?.message || `HTTP ${r.status}`;
      tried.push({ model, error: msg });
      // Key inválida — parar imediatamente
      if(r.status === 400 && (msg.includes('API key') || msg.includes('API_KEY'))) {
        return err('API Key inválida: ' + msg, 401);
      }
      if(r.status === 401 || r.status === 403) return err(`Auth (${r.status}): ${msg}`, 401);
      // Modelo não encontrado — tentar próximo
      continue;

    } catch(e) {
      tried.push({ model, error: e.message });
      continue;
    }
  }

  return ok({ ok:false, error:'Nenhum modelo Gemini disponível', tried,
    hint:'Verifique se a API Key tem acesso ao Gemini Developer API em aistudio.google.com' });
};

export const config = { path: '/api/gemini' };
