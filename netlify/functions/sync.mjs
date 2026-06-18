// sync.mjs v5.3 — rebuild 1781581891 — Sincronização bidirecional CORRETA

// ── UUID v5 determinístico (SHA-1 baseado) ───────────────────────
// Garante que ID local (número ou string) sempre mapeia para o mesmo UUID
const NS = '6ba7b8109dad11d180b400c04fd430c8'; // DNS namespace
async function toUUID(localId, table) {
  const key = `souzaadv.${table}.${localId}`;
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(NS + key));
  const b   = new Uint8Array(buf);
  b[6] = (b[6] & 0x0f) | 0x50; // version 5
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  const h = Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

// Cache de UUIDs (evitar recalcular)
const _uCache = new Map();
async function uid(localId, table) {
  const key = `${table}:${localId}`;
  if(_uCache.has(key)) return _uCache.get(key);
  // Se já é UUID (36 chars com traços), usar direto
  if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(localId))) {
    _uCache.set(key, String(localId));
    return String(localId);
  }
  const u = await toUUID(String(localId), table);
  _uCache.set(key, u);
  return u;
}


// Mapeia campos PT (frontend) ↔ EN (Supabase)
// Tabelas Supabase: clients, cases, appointments, tasks, financial_records

function getEnv(key) {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) { const v = Netlify.env.get(key); if (v) return v; } } catch(e) {}
  try { if (typeof process !== 'undefined' && process.env) { const v = process.env[key]; if (v) return v; } } catch(e) {}
  return undefined;
}
const SUPA_URL = getEnv('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const _S = getEnv('JWT_SECRET') || 'sza-2026-' + (SUPA_KEY||'').slice(-16);

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s,headers:CORS});

// ── JWT verify ────────────────────────────────────────────────────
const frm = s => { s=s.replace(/-/g,'+').replace(/_/g,'/'); while(s.length%4)s+='='; return s; };
const enc = s => new TextEncoder().encode(s);
async function verifyToken(token) {
  const [h,p,s] = (token||'').split('.');
  if(!h||!p||!s) throw new Error('Token malformado');
  const k = await crypto.subtle.importKey('raw',enc(_S),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const sig = Uint8Array.from(atob(frm(s)),c=>c.charCodeAt(0));
  if(!await crypto.subtle.verify('HMAC',k,sig,enc(h+'.'+p))) throw new Error('Assinatura inválida');
  const pl = JSON.parse(atob(frm(p)));
  if(pl.exp < ~~(Date.now()/1000)) throw new Error('Token expirado');
  return pl;
}

// ── Supabase REST ─────────────────────────────────────────────────
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
  if(r.status === 204) return [];
  const data = await r.json();
  if(!r.ok) throw new Error(JSON.stringify(data).slice(0,200));
  return data;
}

// ════════════════════════════════════════════════════════════════
// MAPEAMENTOS PT → EN (frontend → Supabase)
// ════════════════════════════════════════════════════════════════

// CLIENTE: {id, nome, cpf, tel, email, end, tipo, obs}
// → clients: {id, name, cpf_cnpj, phone, email, address, notes, source}
async function cliToSupa(c) {
  if(!c.id || !c.nome) return null;
  return {
    id:          await uid(c.id, 'clients'),
    name:        c.nome || '',
    cpf_cnpj:    c.cpf  || '',
    phone:       c.tel  || '',
    email:       c.email|| '',
    address:     c.end  || '',
    notes:       c.obs  || '',
    source:      c.tipo || 'Ativo',
    created_at:  c.criadoEm || c.createdAt || new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };
}
// clients → PT
function supaToCliente(r) {
  return {
    id:        r.id,
    nome:      r.name       || '',
    cpf:       r.cpf_cnpj   || '',
    tel:       r.phone      || '',
    email:     r.email      || '',
    end:       r.address    || '',
    obs:       r.notes      || '',
    tipo:      r.source     || 'Ativo',
    criadoEm:  r.created_at || '',
  };
}

// PROCESSO: {id, num, cliId, tipo, vara, status, ini, prox, adv, obs, djMov, djMovDt}
// → cases: {id, client_id, process_number, court, tribunal, class_name, subject, phase, status}
async function procToSupa(p) {
  if(!p.id || !p.num) return null;
  return {
    id:              await uid(p.id, 'cases'),
    client_id:       p.cliId ? await uid(p.cliId, 'clients') : null,
    process_number:  p.num   || '',
    court:           p.vara  || '',
    tribunal:        p.trib  || '',
    class_name:      p.tipo  || '',
    subject:         p.obs   || '',
    phase:           p.fase  || p.prox || '',
    status:          p.status|| 'Em andamento',
    last_movement_at: p.djMovDt || null,
    datajud_payload: p.djMov ? JSON.stringify({mov: p.djMov, syncAt: p.djSyncAt}) : null,
    created_at:      p.ini   || p.criadoEm || new Date().toISOString(),
    updated_at:      new Date().toISOString(),
  };
}
function supaToProc(r) {
  let djInfo = {};
  try { if(r.datajud_payload) djInfo = JSON.parse(r.datajud_payload); } catch {}
  return {
    id:        r.id,
    num:       r.process_number || '',
    cliId:     r.client_id      || null,
    tipo:      r.class_name     || '',
    vara:      r.court          || '',
    trib:      r.tribunal       || '',
    status:    r.status         || 'Em andamento',
    ini:       r.created_at     || '',
    prox:      r.phase          || '',
    obs:       r.subject        || '',
    djMov:     djInfo.mov       || '',
    djMovDt:   r.last_movement_at || '',
    djSyncAt:  djInfo.syncAt    || '',
  };
}

// AGENDAMENTO: {id, type, status, nome, tel, email, cidade, estado, area, resumo, modal, data, hora, createdAt}
// → appointments: {id, client_id, title, description, starts_at, ends_at, status, channel}
async function bkToSupa(b) {
  if(!b.id) return null;
  const dateStr = b.data && b.hora ? `${b.data}T${b.hora}:00` : (b.data || new Date().toISOString().slice(0,10));
  // JSON em vez de campos separados por ' | ': formato anterior não tinha
  // espaço para email/cidade/estado (ficavam sempre perdidos) e, com filter
  // antes do join, ainda desalinhava os campos quando algum vinha vazio.
  const descObj = {
    nome: b.nome||'', tel: b.tel||'', email: b.email||'', cidade: b.cidade||'',
    estado: b.estado||'', resumo: b.resumo||'', status: b.status||'solicitado', type: b.type||'',
  };
  return {
    id:          await uid(b.id, 'appointments'),
    title:       b.area || b.type || 'Atendimento',
    description: JSON.stringify(descObj),
    starts_at:   dateStr,
    ends_at:     dateStr,
    status:      ({'solicitado':'agendado','confirmado':'confirmado','realizado':'realizado','cancelado':'cancelado','remarcado':'remarcado','aguardando_docs':'agendado','contratado':'realizado','Confirmado':'confirmado','Cancelado':'cancelado','Contratado':'realizado','Realizado':'realizado','Solicitado':'agendado'}[b.status]||'agendado'),
    channel:     b.modal  || 'presencial',
    created_at:  b.createdAt || b.criadoEm || new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };
}
function supaToUser(r) {
  return {
    id:     r.id,
    nome:   r.name  || '',
    email:  r.email || '',
    oab:    r.oab    || '',
    cargo:  r.cargo  || '',
    tel:    r.tel    || '',
    role:   r.role  || 'advogado',
    ativo:  r.active !== false,
  };
}
function supaToAgenda(r) {
  let f = {};
  try {
    f = JSON.parse(r.description || '{}');
    if (typeof f !== 'object' || Array.isArray(f) || f === null) f = {};
  } catch(e) {
    // Formato antigo (campos separados por ' | '), de registros sincronizados
    // antes desta correção — sem email/cidade/estado, que nunca foram
    // capturados nesse formato.
    const parts = (r.description||'').split(' | ');
    f = { nome: parts[0]||'', tel: parts[1]||'', resumo: parts[2]||'', status: parts[3]||'', type: parts[4]||'' };
  }
  return {
    id:        r.id,
    type:      f.type   || r.title || '',
    area:      r.title  || '',
    status:    f.status || r.status || 'solicitado',
    nome:      f.nome   || '',
    tel:       f.tel    || '',
    email:     f.email  || '',
    cidade:    f.cidade || '',
    estado:    f.estado || '',
    resumo:    f.resumo || '',
    modal:     r.channel  || 'presencial',
    data:      (r.starts_at||'').slice(0,10),
    hora:      (r.starts_at||'').slice(11,16),
    createdAt: r.created_at || '',
  };
}

// TAREFA: {id, data, desc, cliId, procId, prio, status, resp, local, ok}
// → tasks: {id, client_id, case_id, title, description, due_at, status, priority, assigned_to}
async function tarToSupa(t) {
  if(!t.id || !t.desc) return null;
  return {
    id:          await uid(t.id, 'tasks'),
    client_id:   t.cliId  ? await uid(t.cliId,  'clients') : null,
    case_id:     t.procId ? await uid(t.procId,  'cases')   : null,
    title:       t.desc   || '',
    description: t.local  || '',
    due_at:      (t.data ? t.data.slice(0,10)+'T00:00:00+00:00' : null),
    status:      t.ok ? 'concluida' : ({'Pendente':'pendente','Em andamento':'em_andamento','Concluída':'concluida','Cancelada':'cancelada','concluida':'concluida','pendente':'pendente'}[t.status]||'pendente'),
    priority:    ({'Alta':'alta','Média':'media','Media':'media','Baixa':'baixa','Urgente':'urgente','alta':'alta','media':'media','baixa':'baixa'}[t.prio]||'media'),
    assigned_to: null,
    created_at:  t.criadoEm || new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };
}
function supaToTarefa(r) {
  return {
    id:     r.id,
    data:   (r.due_at||'').slice(0,10),
    desc:   r.title       || '',
    local:  r.description || '',
    cliId:  r.client_id   || null,
    procId: r.case_id     || null,
    prio:   r.priority    || 'Média',
    status: r.status      || 'Pendente',
    resp:   r.assigned_to || '',
    ok:     r.status === 'Concluída',
  };
}

// FINANCEIRO: {id, cliId, desc, ct, rc, pg, st, data}
// → financial_records: {id, client_id, description, amount, kind, status, due_at, paid_at}
async function finToSupa(f) {
  if(!f.id || !f.desc) return null;
  return {
    id:          await uid(f.id, 'financial_records'),
    client_id:   f.cliId ? await uid(f.cliId, 'clients') : null,
    description: f.desc || '',
    amount:      parseFloat(f.ct || f.valor || 0),
    kind:        ({'PIX':'receita','Transferência':'receita','TED':'receita','Crédito':'receita','Débito':'receita','Dinheiro':'receita','Boleto':'receita','Cartão':'receita','Honorários':'receita','Despesa':'despesa','despesa':'despesa','receita':'receita'}[f.pg]||'receita'),
    status:      ({'Pago':'pago','Parcial':'pago','Pendente':'pendente','Cancelado':'cancelado','Atrasado':'atrasado','pago':'pago','pendente':'pendente','atrasado':'atrasado'}[f.st]||'pendente'),
    due_at:      (f.data || new Date().toISOString()).slice(0,10),
    paid_at:     f.st === 'Pago' ? f.data : null,
    created_at:  f.criadoEm || new Date().toISOString(),
    updated_at:  new Date().toISOString(),
  };
}
function supaToFin(r) {
  return {
    id:    r.id,
    cliId: r.client_id   || null,
    desc:  r.description || '',
    ct:    r.amount      || 0,
    rc:    r.status === 'Pago' ? r.amount : 0,
    pg:    r.kind        || 'PIX',
    st:    r.status      || 'Pendente',
    data:  (r.due_at||'').slice(0,10),
  };
}

// ════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ════════════════════════════════════════════════════════════════
export default async (req) => {
  if(req.method === 'OPTIONS') return new Response('',{status:204,headers:CORS});

  // Verificar JWT
  let user;
  try {
    const auth = (req.headers.get('Authorization')||'').replace('Bearer ','');
    user = await verifyToken(auth);
  } catch(e) { return err('Não autorizado: '+e.message, 401); }

  const url    = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop();

  // ── PULL — baixar todos os dados do Supabase ─────────────────
  if(req.method === 'GET' || action === 'pull') {
    try {
      const [clients, cases, appointments, tasks, financial, usrs] = await Promise.all([
        supa('clients?order=created_at.desc&limit=500'),
        supa('cases?order=created_at.desc&limit=500'),
        supa('appointments?order=starts_at.asc&limit=500'),
        supa('tasks?order=due_at.asc&limit=500'),
        supa('financial_records?order=due_at.desc&limit=500'),
        supa('users?select=id,name,email,role,active&order=id.asc'),
      ]);
      return ok({
        ok: true,
        ts: new Date().toISOString(),
        data: {
          clientes:     clients.map(supaToCliente),
          processos:    cases.map(supaToProc),
          agendamentos: appointments.map(supaToAgenda),
          tarefas:      tasks.map(supaToTarefa),
          financeiro:   financial.map(supaToFin),
          usuarios:     usrs.map(supaToUser),
        }
      });
    } catch(e) {
      console.error('[sync pull]', e.message);
      return err('Erro pull: '+e.message, 500);
    }
  }

  // ── PUSH — salvar dados locais no Supabase ───────────────────
  if(req.method === 'POST' || action === 'push') {
    let body;
    try { body = await req.json(); } catch { return err('JSON inválido'); }
    const { data={} } = body;

    const results = {};
    const errors  = [];

    // Mapear cada coleção e fazer upsert
    const MAPS = [
      { key:'clientes',     table:'clients',           fn: cliToSupa  },
      { key:'processos',    table:'cases',             fn: procToSupa },
      { key:'agendamentos', table:'appointments',      fn: bkToSupa   },
      { key:'tarefas',      table:'tasks',             fn: tarToSupa  },
      { key:'financeiro',   table:'financial_records', fn: finToSupa  },
    ];

    for(const {key, table, fn} of MAPS) {
      const rows = data[key];
      if(!rows?.length) { results[key]=0; continue; }

      const mapped = (await Promise.all(rows.map(fn))).filter(Boolean);
      if(!mapped.length) { results[key]=0; continue; }

      let count=0;
      // Upsert em lotes de 50
      for(let i=0; i<mapped.length; i+=50) {
        const batch = mapped.slice(i,i+50);
        try {
          await supa(`${table}?on_conflict=id`, 'POST', batch);
          count += batch.length;
        } catch(e) {
          errors.push({ table, error: e.message.slice(0,100), batch_size: batch.length });
        }
      }
      results[key] = count;
    }

    return ok({
      ok: errors.length === 0,
      synced: results,
      errors: errors.length ? errors : undefined,
      ts: new Date().toISOString(),
    });
  }

  return err('Método não suportado', 405);
};

export const config = { path: ['/api/sync', '/api/sync/:action'] };
