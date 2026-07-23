// prazos-cron.mjs
// Alerta diario de prazos: tarefas vencendo nos proximos 3 dias ou ja
// atrasadas viram uma unica mensagem consolidada enviada por WhatsApp
// para o numero do escritorio (ALERTA_PRAZOS_PHONE).
//
// Observacao: hoje o campo "responsavel" das tarefas e apenas texto
// livre (assigned_to_name), sem vinculo formal com um usuario do
// sistema — por isso o alerta e consolidado, nao individual por
// advogado. Se no futuro o responsavel virar um vinculo real
// (assigned_to -> users.id com telefone), da para separar por pessoa.

function getEnv(key) {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) { const v = Netlify.env.get(key); if (v) return v; } } catch(e) {}
  try { if (typeof process !== 'undefined' && process.env) { const v = process.env[key]; if (v) return v; } } catch(e) {}
  return undefined;
}

const SUPA_URL       = getEnv('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY       = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const WA_PHONE_ID    = getEnv('WA_PHONE_NUMBER_ID');
const WA_TOKEN       = getEnv('WA_TOKEN');
const ALERTA_PHONE   = getEnv('ALERTA_PRAZOS_PHONE');

async function supa(path, method='GET', body=null) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SUPA_KEY,
      Authorization: `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method==='GET' ? '' : 'resolution=merge-duplicates,return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return [];
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data).slice(0,200));
  return data;
}

async function sendWhatsApp(to, text) {
  if (!WA_PHONE_ID || !WA_TOKEN) {
    console.error('[PRAZOS] WA_PHONE_NUMBER_ID ou WA_TOKEN nao configurados.');
    return false;
  }
  const url = `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`;
  const body = { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok;
}

function fmtData(iso) {
  if (!iso) return '';
  const d = String(iso).slice(0,10).split('-');
  return d.length===3 ? (d[2]+'/'+d[1]+'/'+d[0]) : iso;
}

export default async (req) => {
  const inicio = Date.now();
  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0,10);
  const limite = new Date(Date.now() + 3*86400000).toISOString().slice(0,10);

  try {
    const tarefas = await supa(`tasks?status=eq.pendente&due_at=lte.${limite}&select=id,title,due_at,priority,assigned_to_name,case_id,client_id&order=due_at.asc&limit=100`);

    if (!tarefas.length) {
      return new Response(JSON.stringify({ ok: true, mensagem: 'nenhum prazo proximo', duracaoMs: Date.now()-inicio }), { headers: { 'Content-Type': 'application/json' } });
    }

    const atrasadas = tarefas.filter(t => t.due_at < hojeStr);
    const proximas   = tarefas.filter(t => t.due_at >= hojeStr);

    let msg = 'Alerta de Prazos — Souza Advocacia\n\n';
    if (atrasadas.length) {
      msg += 'ATRASADAS (' + atrasadas.length + '):\n';
      atrasadas.forEach(t => { msg += '- ' + (t.title||'sem titulo') + ' (venceu ' + fmtData(t.due_at) + ', resp: ' + (t.assigned_to_name||'nao definido') + ')\n'; });
      msg += '\n';
    }
    if (proximas.length) {
      msg += 'PROXIMOS 3 DIAS (' + proximas.length + '):\n';
      proximas.forEach(t => { msg += '- ' + (t.title||'sem titulo') + ' (' + fmtData(t.due_at) + ', resp: ' + (t.assigned_to_name||'nao definido') + ')\n'; });
    }

    let enviado = false;
    if (ALERTA_PHONE) {
      enviado = await sendWhatsApp(ALERTA_PHONE, msg);
    } else {
      console.error('[PRAZOS] ALERTA_PRAZOS_PHONE nao configurado — alerta calculado mas nao enviado.');
    }

    return new Response(JSON.stringify({
      ok: true,
      duracaoMs: Date.now() - inicio,
      atrasadas: atrasadas.length,
      proximas: proximas.length,
      enviado,
      alertaConfigurado: !!ALERTA_PHONE,
    }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
};

// Roda todos os dias as 07:30 BRT (10:30 UTC)
export const config = { schedule: '30 10 * * *' };
