// booking.mjs — Endpoint público para captação de agendamentos do site
// Propositalmente SEM autenticação: visitantes anônimos do site público
// precisam conseguir registrar um agendamento sem estar logados.
// Isolado em arquivo próprio (não compartilha código com sync.mjs/api.mjs)
// para que esta única rota pública nunca possa, por engano, expor ou
// comprometer as rotas autenticadas existentes.

const SUPA_URL = Netlify.env.get('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m, s = 400) => new Response(JSON.stringify({ ok: false, error: m }), { status: s, headers: CORS });

// UUID v5 determinístico — mesmo algoritmo usado em sync.mjs, para que um
// agendamento criado aqui (sem login) e depois também presente no array
// local de alguém logado nunca duplique registro no Supabase.
const NS = '6ba7b8109dad11d180b400c04fd430c8';
async function toUUID(localId, table) {
  const key = `souzaadv.${table}.${localId}`;
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(NS + key));
  const b = new Uint8Array(buf);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

async function supa(path, method = 'GET', body = null) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return [];
  const data = await r.json();
  if (!r.ok) throw new Error(data?.message || data?.error || `Supabase HTTP ${r.status}`);
  return data;
}

function clean(s, max) {
  return String(s ?? '').trim().slice(0, max);
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: CORS });
  if (req.method !== 'POST') return err('Método não permitido.', 405);
  if (!SUPA_KEY) return err('Servidor não configurado (SUPABASE_SERVICE_ROLE_KEY ausente).', 500);

  let body;
  try { body = await req.json(); } catch { return err('JSON inválido.'); }

  // Validação mínima — defesa de servidor, não confia só no front-end.
  const nome = clean(body.nome, 200);
  const tel  = clean(body.tel, 40);
  if (!nome) return err('Nome é obrigatório.');
  if (!tel)  return err('Telefone/WhatsApp é obrigatório.');
  if (nome.length < 2) return err('Nome inválido.');

  const localId = clean(body.id, 100) || `pub-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
  const data    = clean(body.data, 10);
  const hora    = clean(body.hora, 5);
  const startsAt = (data && hora) ? `${data}T${hora}:00` : (data || new Date().toISOString().slice(0,10));

  const statusMap = { solicitado:'agendado', confirmado:'confirmado', realizado:'realizado', cancelado:'cancelado', remarcado:'remarcado' };
  const row = {
    id:          await toUUID(localId, 'appointments'),
    title:       clean(body.area, 120) || clean(body.type, 60) || 'Atendimento',
    description: [nome, tel, clean(body.resumo, 500), 'solicitado'].filter(Boolean).join(' | '),
    starts_at:   startsAt,
    ends_at:     startsAt,
    status:      statusMap[body.status] || 'agendado',
    channel:     clean(body.modal, 30) || 'presencial',
    created_at:  new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };

  try {
    await supa('appointments?on_conflict=id', 'POST', [row]);
    return ok({ ok: true, id: localId });
  } catch (e) {
    console.error('[booking público]', e.message);
    return err('Não foi possível registrar o agendamento agora. Tente novamente em alguns minutos.', 502);
  }
};

export const config = { path: '/api/booking' };
