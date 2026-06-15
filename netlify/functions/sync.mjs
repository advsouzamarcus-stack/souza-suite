// sync.mjs v3 — Sync Supabase (tabelas em inglês)
// Mapeia: clients, cases, appointments, tasks, financial_records

const SUPA_URL = Netlify.env.get('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
const _S = Netlify.env.get('JWT_SECRET') || 'sza-2026-' + (SUPA_KEY||'').slice(-16);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s, headers:CORS});

const frm64 = s => { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return s; };
const enc   = s => new TextEncoder().encode(s);

async function verifyToken(token) {
  const [h,p,s] = (token||'').split('.');
  if(!h||!p||!s) throw new Error('Token malformado');
  const k   = await crypto.subtle.importKey('raw', enc(_S), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const sig = Uint8Array.from(atob(frm64(s)), c=>c.charCodeAt(0));
  if(!await crypto.subtle.verify('HMAC', k, sig, enc(h+'.'+p))) throw new Error('Assinatura inválida');
  const pl  = JSON.parse(atob(frm64(p)));
  if(pl.exp < ~~(Date.now()/1000)) throw new Error('Token expirado');
  return pl;
}

async function supa(path, method='GET', body=null) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey:SUPA_KEY, Authorization:`Bearer ${SUPA_KEY}`, 'Content-Type':'application/json',
      Prefer: method==='GET' ? '' : 'resolution=merge-duplicates,return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  if(r.status === 204) return [];
  return r.json();
}

export default async (req) => {
  if(req.method === 'OPTIONS') return new Response('', {status:204, headers:CORS});

  // Verificar token JWT
  let user;
  try {
    const auth = (req.headers.get('Authorization')||'').replace('Bearer ','');
    user = await verifyToken(auth);
  } catch(e) { return err('Não autorizado: '+e.message, 401); }

  const url    = new URL(req.url);
  const action = url.pathname.split('/').pop();

  // PULL — baixar todos os dados
  if(req.method === 'GET' || action === 'pull') {
    try {
      const [clients, cases, appointments, tasks, financial, users] = await Promise.all([
        supa('clients?order=created_at.desc&limit=500'),
        supa('cases?order=created_at.desc&limit=500'),
        supa('appointments?order=starts_at.asc&limit=500'),
        supa('tasks?order=created_at.desc&limit=500'),
        supa('financial_records?order=created_at.desc&limit=500'),
        supa('users?select=id,name,email,role,active&order=id.asc'),
      ]);
      // Mapear para nomes em português (compatível com o frontend)
      return ok({ ok:true, ts: new Date().toISOString(), data: {
        clientes: clients, processos: cases, agendamentos: appointments,
        tarefas: tasks, financeiro: financial, usuarios: users
      }});
    } catch(e) { return err('Erro sync: '+e.message, 500); }
  }

  // PUSH — enviar dados locais
  if(req.method === 'POST' || action === 'push') {
    try {
      const { data } = await req.json();
      const results = {};
      const MAP = { clientes:'clients', processos:'cases', agendamentos:'appointments', tarefas:'tasks', financeiro:'financial_records' };
      for(const [local, remote] of Object.entries(MAP)) {
        const rows = data?.[local];
        if(!rows?.length) { results[local]=0; continue; }
        let count=0;
        for(let i=0; i<rows.length; i+=50) {
          const batch = rows.slice(i,i+50).map(r=>({...r, updated_at: new Date().toISOString()}));
          await supa(remote+'?on_conflict=id', 'POST', batch);
          count+=batch.length;
        }
        results[local]=count;
      }
      return ok({ ok:true, synced:results, ts:new Date().toISOString() });
    } catch(e) { return err('Erro push: '+e.message, 500); }
  }

  return err('Método não suportado', 405);
};

export const config = { path: ['/api/sync', '/api/sync/:action'] };
