// inbox.mjs
// Caixa de Entrada — conversas de WhatsApp (conversations/messages) com
// leitura de histórico, resposta manual e controle de IA por conversa.

function getEnv(key) {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) { const v = Netlify.env.get(key); if (v) return v; } } catch(e) {}
  try { if (typeof process !== 'undefined' && process.env) { const v = process.env[key]; if (v) return v; } } catch(e) {}
  return undefined;
}

const SUPA_URL   = getEnv('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY   = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const JWT_SECRET = getEnv('JWT_SECRET') || getEnv('SUPABASE_JWT_SECRET') || 'configure-jwt-secret-in-netlify';
const WA_PHONE_ID = getEnv('WA_PHONE_NUMBER_ID');
const WA_TOKEN    = getEnv('WA_TOKEN');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s,headers:CORS});

const frm = s => { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return s; };
const enc = s => new TextEncoder().encode(s);
async function verifyToken(token) {
  const [h,p,s] = (token||'').split('.');
  if(!h||!p||!s) throw new Error('Token malformado');
  const k = await crypto.subtle.importKey('raw',enc(JWT_SECRET),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig = Uint8Array.from(atob(frm(s)),c=>c.charCodeAt(0));
  if(!await crypto.subtle.verify('HMAC',k,sig,enc(h+'.'+p))) throw new Error('Assinatura invalida');
  const pl = JSON.parse(atob(frm(p)));
  if(pl.exp < ~~(Date.now()/1000)) throw new Error('Token expirado');
  return pl;
}

async function supa(path, method='GET', body=null) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method==='GET' ? '' : 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return [];
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data).slice(0,300));
  return data;
}

async function sendWhatsApp(to, text) {
  if (!WA_PHONE_ID || !WA_TOKEN) return { ok:false, status:0, body:'env vars ausentes' };
  const url = `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`;
  const body = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const respBody = await r.text();
  return { ok: r.ok, status: r.status, body: respBody };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  try {
    const auth = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    await verifyToken(auth);
  } catch (e) {
    return err('Nao autorizado: ' + e.message, 401);
  }

  const url = new URL(req.url);
  const segments = url.pathname.split('/').filter(Boolean); // ['api','inbox', ...]
  const action = segments[2]; // conversationId ou undefined
  const sub = segments[3];    // 'messages' | 'reply' | 'toggle-ai'

  try {
    // GET /api/inbox — lista de conversas com nome do lead/cliente e ultima mensagem
    if (req.method === 'GET' && !action) {
      const convs = await supa('conversations?order=updated_at.desc&limit=100');
      const leadIds = [...new Set(convs.map(c => c.lead_id).filter(Boolean))];
      const clientIds = [...new Set(convs.map(c => c.client_id).filter(Boolean))];

      const [leads, clients] = await Promise.all([
        leadIds.length ? supa(`leads?id=in.(${leadIds.join(',')})&select=id,name,stage`) : [],
        clientIds.length ? supa(`clients?id=in.(${clientIds.join(',')})&select=id,name,company_name,person_type`) : [],
      ]);
      const leadMap = Object.fromEntries(leads.map(l => [l.id, l]));
      const clientMap = Object.fromEntries(clients.map(c => [c.id, c]));

      const result = await Promise.all(convs.map(async c => {
        const lastMsgArr = await supa(`messages?conversation_id=eq.${c.id}&order=created_at.desc&limit=1&select=body,direction,created_at`);
        const lastMsg = lastMsgArr[0] || null;
        const lead = c.lead_id ? leadMap[c.lead_id] : null;
        const client = c.client_id ? clientMap[c.client_id] : null;
        const nome = client ? (client.person_type === 'juridica' ? client.company_name : client.name) : (lead ? lead.name : c.external_thread_id);
        return {
          id: c.id,
          nome: nome || c.external_thread_id,
          telefone: c.external_thread_id,
          canal: c.channel,
          status: c.status,
          aiEnabled: c.ai_enabled,
          origem: client ? 'cliente' : (lead ? 'lead' : 'desconhecido'),
          updatedAt: c.updated_at,
          ultimaMensagem: lastMsg ? lastMsg.body : null,
          ultimaDirecao: lastMsg ? lastMsg.direction : null,
        };
      }));
      return ok({ ok: true, conversas: result });
    }

    // GET /api/inbox/:id/messages — historico completo da conversa
    if (req.method === 'GET' && action && sub === 'messages') {
      const msgs = await supa(`messages?conversation_id=eq.${action}&order=created_at.asc&limit=500`);
      return ok({ ok: true, mensagens: msgs });
    }

    // POST /api/inbox/:id/reply — envia mensagem manual e persiste
    if (req.method === 'POST' && action && sub === 'reply') {
      const body = await req.json();
      const texto = (body.texto || '').trim();
      if (!texto) return err('Informe o texto da mensagem.');

      const convArr = await supa(`conversations?id=eq.${action}&limit=1`);
      const conv = convArr[0];
      if (!conv) return err('Conversa nao encontrada.', 404);

      const envio = await sendWhatsApp(conv.external_thread_id, texto);
      if (!envio.ok) return err('Falha ao enviar: ' + envio.body.slice(0,200), 502);

      await supa('messages', 'POST', [{ conversation_id: conv.id, direction: 'out', sender: 'humano', body: texto }]);
      await supa(`conversations?id=eq.${conv.id}`, 'PATCH', { updated_at: new Date().toISOString() });

      return ok({ ok: true });
    }

    // POST /api/inbox/:id/toggle-ai — liga/desliga a IA para essa conversa
    if (req.method === 'POST' && action && sub === 'toggle-ai') {
      const body = await req.json();
      await supa(`conversations?id=eq.${action}`, 'PATCH', { ai_enabled: !!body.aiEnabled });
      return ok({ ok: true });
    }

    return err('Rota nao encontrada.', 404);
  } catch (e) {
    return err('Erro: ' + e.message, 500);
  }
};

export const config = { path: ['/api/inbox', '/api/inbox/:id', '/api/inbox/:id/:sub'] };
