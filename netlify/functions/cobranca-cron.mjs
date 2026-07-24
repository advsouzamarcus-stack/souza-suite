// redeploy-trigger 1784819121782
// cobranca-cron.mjs
// Cobranca automatica diaria: verifica lancamentos financeiros pendentes
// ou atrasados e envia lembrete via WhatsApp para o cliente, registrando
// a mensagem no historico de conversa (CRM).

function getEnv(key) {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) { const v = Netlify.env.get(key); if (v) return v; } } catch(e) {}
  try { if (typeof process !== 'undefined' && process.env) { const v = process.env[key]; if (v) return v; } } catch(e) {}
  return undefined;
}

const SUPA_URL  = getEnv('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY  = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const WA_PHONE_ID = getEnv('WA_PHONE_NUMBER_ID');
const WA_TOKEN    = getEnv('WA_TOKEN');

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
    console.error('[COBRANCA] WA_PHONE_NUMBER_ID ou WA_TOKEN nao configurados.');
    return { ok: false, status: 0, body: 'env vars ausentes' };
  }
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

function fmtData(iso) {
  if (!iso) return '';
  const d = String(iso).slice(0,10).split('-');
  return d.length===3 ? (d[2]+'/'+d[1]+'/'+d[0]) : iso;
}
function fmtValor(v) {
  return (Number(v)||0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Localiza (ou cria) a conversa de WhatsApp deste cliente
async function getOuCriarConversaCliente(phone, clientId) {
  const existentes = await supa(`conversations?channel=eq.whatsapp&external_thread_id=eq.${phone}&limit=1`);
  if (existentes.length) return existentes[0];
  const nova = await supa('conversations', 'POST', [{
    client_id: clientId,
    channel: 'whatsapp',
    external_thread_id: phone,
    status: 'aberta',
    ai_enabled: true,
  }]);
  return nova[0];
}

export default async (req) => {
  const inicio = Date.now();
  const resultados = [];
  const hoje = new Date().toISOString().slice(0,10);

  try {
    const lancamentos = await supa(`financial_records?status=in.(pendente,atrasado)&select=id,client_id,description,amount,due_at,status&order=due_at.asc&limit=200`);

    for (const f of lancamentos) {
      if (!f.due_at) continue;
      try {
        const clientes = await supa(`clients?id=eq.${f.client_id}&select=id,name,phone`);
        const cli = clientes[0];
        if (!cli || !cli.phone) { resultados.push({ id: f.id, ok: false, erro: 'cliente sem telefone' }); continue; }

        const atrasado = f.due_at < hoje;
        const valor = fmtValor(f.amount);
        const msg = atrasado
          ? ('Ola ' + (cli.name||'') + '! Identificamos um pagamento em atraso referente a "' + (f.description||'') + '" no valor de ' + valor + ' (vencimento ' + fmtData(f.due_at) + '). Por favor, entre em contato conosco para regularizar. Qualquer duvida estamos a disposicao. — Souza Advocacia')
          : ('Ola ' + (cli.name||'') + '! Lembrete: "' + (f.description||'') + '" no valor de ' + valor + ' vence em ' + fmtData(f.due_at) + '. — Souza Advocacia');

        const envio = await sendWhatsApp(cli.phone, msg);
        if (!envio.ok) { resultados.push({ id: f.id, ok: false, erro: 'whatsapp ' + envio.status + ': ' + envio.body.slice(0,200) }); continue; }

        const conversa = await getOuCriarConversaCliente(cli.phone, cli.id);
        await supa('messages', 'POST', [{ conversation_id: conversa.id, direction: 'outbound', sender: 'sistema', body: msg }]);
        await supa(`conversations?id=eq.${conversa.id}`, 'PATCH', { updated_at: new Date().toISOString() });

        resultados.push({ id: f.id, ok: true, atrasado });
      } catch (e) {
        resultados.push({ id: f.id, ok: false, erro: e.message });
      }
    }
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    ok: true,
    duracaoMs: Date.now() - inicio,
    processados: resultados.length,
    resultados,
  }), { headers: { 'Content-Type': 'application/json' } });
};

// Roda todos os dias as 08:00 BRT (11:00 UTC)
export const config = { schedule: '0 11 * * *' };
