import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const PROJECT_REF = 'briobxgqygjcyrbasqan';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;
const JWT_SECRET = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET || 'configure-jwt-secret-in-netlify';
const DATAJUD_API_KEY = process.env.DATAJUD_API_KEY || process.env.DATAJUD_PUBLIC_KEY;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const tables = {
  clients: ['name', 'cpf_cnpj', 'phone', 'email', 'address', 'source', 'notes'],
  cases: ['client_id', 'process_number', 'court', 'tribunal', 'class_name', 'subject', 'phase', 'status', 'last_movement_at', 'datajud_payload'],
  tasks: ['title', 'description', 'due_at', 'status', 'priority'],
  appointments: ['title', 'description', 'starts_at', 'ends_at', 'status', 'channel'],
  financial_records: ['description', 'amount', 'kind', 'status', 'due_at', 'paid_at'],
  leads: ['name', 'phone', 'email', 'source', 'stage', 'summary'],
  conversations: ['channel', 'external_thread_id', 'status', 'ai_enabled'],
  access_log: ['usuario', 'perfil', 'modulo', 'acao', 'negado']
};

const tableDefaults = {
  cases: { status: 'ativo' },
  tasks: { status: 'pendente' },
  appointments: { status: 'agendado' },
  financial_records: { status: 'pendente' },
  leads: { stage: 'novo' },
  conversations: { status: 'aberta' },
  access_log: { negado: false }
};

let db;
function supabase() {
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY não configurada no Netlify.');
  if (!db) db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  return db;
}
function response(statusCode, payload) { return { statusCode, headers: cors, body: JSON.stringify(payload) }; }
function parseBody(event) { if (!event.body) return {}; try { return JSON.parse(event.body); } catch { throw new Error('JSON inválido no corpo da requisição.'); } }
function getSegments(event) { let p = event.path || ''; p = p.replace(/^\/\.netlify\/functions\/api\/?/, ''); p = p.replace(/^\/api\/?/, ''); return p.split('/').filter(Boolean).map(decodeURIComponent); }
function bearer(event) { const h = event.headers?.authorization || event.headers?.Authorization || ''; return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; }
function safeUser(user) { if (!user) return null; const { id, name, email, role, active, created_at, updated_at } = user; return { id, name, email, role, active, created_at, updated_at }; }
function issueTokens(user) { const base = { sub: user.id, email: user.email, role: user.role, name: user.name }; return { token: jwt.sign(base, JWT_SECRET, { expiresIn: '12h' }), access_token: jwt.sign(base, JWT_SECRET, { expiresIn: '12h' }), refresh_token: jwt.sign({ ...base, type: 'refresh' }, JWT_SECRET, { expiresIn: '7d' }) }; }
function requireAuth(event) { const token = bearer(event); if (!token) throw Object.assign(new Error('Sessão ausente. Faça login novamente.'), { status: 401 }); try { return jwt.verify(token, JWT_SECRET); } catch { throw Object.assign(new Error('Sessão expirada ou inválida.'), { status: 401 }); } }
function isAdmin(user) { return ['admin', 'administrador', 'gestor'].includes(String(user?.role || '').toLowerCase()); }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }

function cleanRecord(table, input, user) {
  const allowed = tables[table];
  const out = { ...(tableDefaults[table] || {}) };
  for (const k of allowed) {
    if (!(k in input)) continue;
    let v = input[k];
    if (v === '') continue;
    if (k === 'email') v = normalizeEmail(v);
    if (k === 'process_number') v = onlyDigits(v);
    if (k === 'amount') v = Number(v || 0);
    if (k === 'ai_enabled') v = v === true || v === 'true';
    if (k === 'negado') v = v === true || v === 'true';
    out[k] = v;
  }
  if (table === 'cases' && out.process_number) out.process_number = onlyDigits(out.process_number);
  if (user?.sub && ['clients', 'cases'].includes(table)) out.created_by = user.sub;
  return out;
}

async function authLogin(event) {
  const body = parseBody(event);
  const email = normalizeEmail(body.email);
  const password = String(body.password ?? body.pwd ?? '');
  if (!email || !password) return response(400, { ok: false, error: 'Informe e-mail e senha.' });
  const { data, error } = await supabase().from('users').select('id,name,email,password_hash,role,active,created_at,updated_at').ilike('email', email).limit(1);
  if (error) throw error;
  const user = data?.[0];
  if (!user) return response(401, { ok: false, error: 'E-mail não cadastrado no banco online.' });
  if (!user.active) return response(403, { ok: false, error: 'Usuário bloqueado.' });
  const hash = String(user.password_hash || '');
  const ok = hash.startsWith('$2') ? await bcrypt.compare(password, hash) : password === hash;
  if (!ok) return response(401, { ok: false, error: 'Senha inválida.' });
  return response(200, { ok: true, ...issueTokens(user), user: safeUser(user) });
}

async function listUsers() {
  const { data, error } = await supabase().from('users').select('id,name,email,role,active,oab,cargo,tel,custom_perms,created_at,updated_at').order('created_at', { ascending: false });
  if (error) throw error;
  return response(200, data || []);
}
async function createUser(event, current) {
  if (!isAdmin(current)) return response(403, { error: 'Somente administrador pode cadastrar usuários.' });
  const body = parseBody(event);
  const name = String(body.name || body.nome || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || body.pwd || '');
  const role = String(body.role || 'advogado').trim();
  const active = body.active === undefined ? true : body.active === true || body.active === 'true';
  const oab = String(body.oab || '').trim();
  const cargo = String(body.cargo || '').trim();
  const tel = String(body.tel || '').trim();
  if (!name || !email || !password) return response(400, { error: 'Nome, e-mail e senha são obrigatórios.' });
  const password_hash = await bcrypt.hash(password, 12);
  const { data, error } = await supabase().from('users').insert({ name, email, password_hash, role, active, oab, cargo, tel }).select('id,name,email,role,active,oab,cargo,tel,custom_perms,created_at,updated_at').single();
  if (error) throw error;
  return response(201, data);
}
async function updateUser(event, id, current) {
  if (!isAdmin(current)) return response(403, { error: 'Somente administrador pode alterar usuários.' });
  const body = parseBody(event);
  const patch = {};
  if (body.name !== undefined || body.nome !== undefined) patch.name = String(body.name || body.nome || '').trim();
  if (body.email !== undefined) patch.email = normalizeEmail(body.email);
  if (body.role !== undefined) patch.role = String(body.role || 'advogado').trim();
  if (body.active !== undefined) patch.active = body.active === true || body.active === 'true';
  if (body.oab !== undefined) patch.oab = String(body.oab || '').trim();
  if (body.cargo !== undefined) patch.cargo = String(body.cargo || '').trim();
  if (body.tel !== undefined) patch.tel = String(body.tel || '').trim();
  if (body.customPerms !== undefined) patch.custom_perms = body.customPerms === null ? null : body.customPerms;
  if (body.password || body.pwd) patch.password_hash = await bcrypt.hash(String(body.password || body.pwd), 12);
  delete patch.id;
  const { data, error } = await supabase().from('users').update(patch).eq('id', id).select('id,name,email,role,active,oab,cargo,tel,custom_perms,created_at,updated_at').single();
  if (error) throw error;
  return response(200, data);
}
async function deleteUser(id, current, event) {
  if (!isAdmin(current)) return response(403, { error: 'Somente administrador pode bloquear ou excluir usuários.' });
  if (id === current.sub) return response(400, { error: 'Não é permitido bloquear/excluir o próprio usuário logado.' });
  const hard = event?.queryStringParameters?.hard === 'true' || event?.queryStringParameters?.hard === '1';
  if (hard) {
    const { error } = await supabase().from('users').delete().eq('id', id);
    if (error) throw error;
    return response(200, { ok: true, deleted: id });
  }
  const { data, error } = await supabase().from('users').update({ active: false }).eq('id', id).select('id,name,email,role,active,created_at,updated_at').single();
  if (error) throw error;
  return response(200, data);
}

// Caixa de Entrada (WhatsApp) — lista conversas com preview da ultima
// mensagem, e retorna o historico completo de uma conversa especifica.
async function handleInbox(event, seg, current) {
  if (event.httpMethod !== 'GET') return response(405, { error: 'Metodo nao suportado.' });
  const db = supabase();

  if (seg[1] && seg[2] === 'messages') {
    const { data, error } = await db.from('messages').select('*')
      .eq('conversation_id', seg[1]).order('created_at', { ascending: true }).limit(500);
    if (error) return response(500, { ok: false, error: error.message });
    return response(200, { ok: true, mensagens: (data || []).map(function(m) {
      return { id: m.id, direcao: m.direction, remetente: m.sender, texto: m.body, dataHora: m.created_at };
    }) });
  }

  const { data: convs, error: convErr } = await db.from('conversations').select('*')
    .order('updated_at', { ascending: false }).limit(100);
  if (convErr) return response(500, { ok: false, error: convErr.message });

  const result = [];
  for (const c of (convs || [])) {
    let nome = c.external_thread_id;
    if (c.client_id) {
      const { data: cli } = await db.from('clients').select('name').eq('id', c.client_id).single();
      if (cli && cli.name) nome = cli.name;
    } else if (c.lead_id) {
      const { data: lead } = await db.from('leads').select('name').eq('id', c.lead_id).single();
      if (lead && lead.name) nome = lead.name;
    }
    const { data: lastMsgArr } = await db.from('messages').select('body,direction')
      .eq('conversation_id', c.id).order('created_at', { ascending: false }).limit(1);
    const lastMsg = (lastMsgArr && lastMsgArr[0]) || null;
    result.push({
      id: c.id,
      nome: nome,
      telefone: c.external_thread_id,
      ultimaMensagem: lastMsg ? lastMsg.body : '',
      ultimaDirecao: lastMsg ? lastMsg.direction : '',
      status: c.status,
    });
  }
  return response(200, { ok: true, conversas: result });
}

async function handleTable(event, table, id, current) {
  if (table === 'users') {
    if (event.httpMethod === 'GET') return listUsers();
    if (event.httpMethod === 'POST') return createUser(event, current);
    if (['PUT', 'PATCH'].includes(event.httpMethod)) return updateUser(event, id, current);
    if (event.httpMethod === 'DELETE') return deleteUser(id, current, event);
  }
  if (!tables[table]) return response(404, { error: 'Rota não encontrada.' });
  const client = supabase().from(table);
  if (event.httpMethod === 'GET') { const q = id ? client.select('*').eq('id', id).single() : client.select('*').order('created_at', { ascending: false }); const { data, error } = await q; if (error) throw error; return response(200, data || []); }
  if (event.httpMethod === 'POST') { const payload = cleanRecord(table, parseBody(event), current); const { data, error } = await client.insert(payload).select('*').single(); if (error) throw error; return response(201, data); }
  if (['PUT', 'PATCH'].includes(event.httpMethod)) { if (!id) return response(400, { error: 'ID obrigatório para atualizar.' }); const payload = cleanRecord(table, parseBody(event), current); delete payload.created_by; const { data, error } = await client.update(payload).eq('id', id).select('*').single(); if (error) throw error; return response(200, data); }
  if (event.httpMethod === 'DELETE') { if (!id) return response(400, { error: 'ID obrigatório para excluir.' }); const { error } = await client.delete().eq('id', id); if (error) throw error; return response(200, { ok: true }); }
  return response(405, { error: 'Método não permitido.' });
}

async function legacySync(event) {
  if (event.httpMethod !== 'GET') return response(200, { ok: true, synced: { mode: 'read-through-api' } });
  const [clientes, processos, agendamentos, tarefas, financeiro, usuarios] = await Promise.all([
    supabase().from('clients').select('*').order('created_at', { ascending: false }),
    supabase().from('cases').select('*').order('created_at', { ascending: false }),
    supabase().from('appointments').select('*').order('created_at', { ascending: false }),
    supabase().from('tasks').select('*').order('created_at', { ascending: false }),
    supabase().from('financial_records').select('*').order('created_at', { ascending: false }),
    supabase().from('users').select('id,name,email,role,active,created_at,updated_at').order('created_at', { ascending: false })
  ]);
  for (const r of [clientes, processos, agendamentos, tarefas, financeiro, usuarios]) if (r.error) throw r.error;
  return response(200, { ok: true, data: { clientes: clientes.data, processos: processos.data, agendamentos: agendamentos.data, tarefas: tarefas.data, financeiro: financeiro.data, usuarios: usuarios.data } });
}

const stateMap = {'01':'tjac','02':'tjal','03':'tjap','04':'tjam','05':'tjba','06':'tjce','07':'tjdft','08':'tjes','09':'tjgo','10':'tjma','11':'tjmt','12':'tjms','13':'tjmg','14':'tjpa','15':'tjpb','16':'tjpr','17':'tjpe','18':'tjpi','19':'tjrj','20':'tjrn','21':'tjrs','22':'tjro','23':'tjrr','24':'tjsc','25':'tjse','26':'tjsp','27':'tjto'};
const treMap = {'01':'tre-ac','02':'tre-al','03':'tre-ap','04':'tre-am','05':'tre-ba','06':'tre-ce','07':'tre-dft','08':'tre-es','09':'tre-go','10':'tre-ma','11':'tre-mt','12':'tre-ms','13':'tre-mg','14':'tre-pa','15':'tre-pb','16':'tre-pr','17':'tre-pe','18':'tre-pi','19':'tre-rj','20':'tre-rn','21':'tre-rs','22':'tre-ro','23':'tre-rr','24':'tre-sc','25':'tre-se','26':'tre-sp','27':'tre-to'};
function tribunalSlug(input, numero) { const raw = String(input || '').trim().toLowerCase(); if (raw.startsWith('http')) return raw; if (raw.includes('api_publica_')) return raw.match(/api_publica_([^/]+)/)?.[1]; const cleaned = raw.replace(/[^a-z0-9-]/g, ''); if (cleaned) return cleaned.replace(/^api_publica_/, ''); const n = onlyDigits(numero); if (n.length !== 20) return ''; const ramo = n[13]; const tr = n.slice(14, 16); if (ramo === '8') return stateMap[tr] || ''; if (ramo === '4') return `trf${Number(tr)}`; if (ramo === '5') return `trt${Number(tr)}`; if (ramo === '6') return treMap[tr] || ''; if (ramo === '3') return 'stj'; return ''; }
function datajudUrl(tribunal, numero) { const slug = tribunalSlug(tribunal, numero); if (!slug) return ''; if (slug.startsWith('http')) return slug; return `https://api-publica.datajud.cnj.jus.br/api_publica_${slug}/_search`; }
function flatAssuntos(assuntos) { return (assuntos || []).flat(Infinity).filter(Boolean).map(a => a.nome).filter(Boolean).join('; '); }
function latestMovement(movimentos) { return [...(movimentos || [])].sort((a, b) => Date.parse(b.dataHora || 0) - Date.parse(a.dataHora || 0))[0] || null; }

async function syncCaseById(id) {
  if (!DATAJUD_API_KEY) return { synced: false, error: 'DATAJUD_API_KEY não configurada no Netlify.' };
  const { data: row, error } = await supabase().from('cases').select('*').eq('id', id).single();
  if (error) throw error;
  const numero = onlyDigits(row.process_number);
  if (!numero) return { synced: false, error: 'Processo sem número CNJ válido.' };
  const url = datajudUrl(row.tribunal, numero);
  if (!url) return { synced: false, error: 'Não foi possível identificar o tribunal. Informe o campo Tribunal, exemplo: tjrj, trf2, trt1.' };
  const r = await fetch(url, { method: 'POST', headers: { Authorization: `APIKey ${DATAJUD_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: { match: { numeroProcesso: numero } } }) });
  const text = await r.text(); let payload; try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
  if (!r.ok) return { synced: false, error: `DataJud retornou HTTP ${r.status}`, payload };
  const hit = payload?.hits?.hits?.[0];
  if (!hit?._source) { await supabase().from('cases').update({ datajud_payload: payload }).eq('id', id); return { synced: false, error: 'Processo não encontrado no tribunal informado.', payload }; }
  const src = hit._source; const mov = latestMovement(src.movimentos);
  const patch = { process_number: src.numeroProcesso || numero, tribunal: src.tribunal || row.tribunal || tribunalSlug(row.tribunal, numero).toUpperCase(), court: src.orgaoJulgador?.nome || row.court || null, class_name: src.classe?.nome || row.class_name || null, subject: flatAssuntos(src.assuntos) || row.subject || null, phase: mov?.nome || row.phase || null, last_movement_at: mov?.dataHora || src.dataHoraUltimaAtualizacao || row.last_movement_at || null, status: row.status || 'ativo', datajud_payload: payload };
  const { data: updated, error: updateError } = await supabase().from('cases').update(patch).eq('id', id).select('*').single();
  if (updateError) throw updateError;
  return { synced: true, case: updated };
}
const DJ_BASE_URL = 'https://api-publica.datajud.cnj.jus.br/';
const DJ_ALL_ENDPOINTS = {
  tst:'api_publica_tst',tse:'api_publica_tse',stj:'api_publica_stj',stm:'api_publica_stm',
  tjac:'api_publica_tjac',tjal:'api_publica_tjal',tjam:'api_publica_tjam',tjap:'api_publica_tjap',
  tjba:'api_publica_tjba',tjce:'api_publica_tjce',tjdft:'api_publica_tjdft',tjes:'api_publica_tjes',
  tjgo:'api_publica_tjgo',tjma:'api_publica_tjma',tjmg:'api_publica_tjmg',tjms:'api_publica_tjms',
  tjmt:'api_publica_tjmt',tjpa:'api_publica_tjpa',tjpb:'api_publica_tjpb',tjpr:'api_publica_tjpr',
  tjpe:'api_publica_tjpe',tjpi:'api_publica_tjpi',tjrj:'api_publica_tjrj',tjrn:'api_publica_tjrn',
  tjrs:'api_publica_tjrs',tjro:'api_publica_tjro',tjrr:'api_publica_tjrr',tjsc:'api_publica_tjsc',
  tjse:'api_publica_tjse',tjsp:'api_publica_tjsp',tjto:'api_publica_tjto',
  trf1:'api_publica_trf1',trf2:'api_publica_trf2',trf3:'api_publica_trf3',
  trf4:'api_publica_trf4',trf5:'api_publica_trf5',trf6:'api_publica_trf6',
  trt1:'api_publica_trt1',trt2:'api_publica_trt2',trt3:'api_publica_trt3',
  trt4:'api_publica_trt4',trt5:'api_publica_trt5',trt6:'api_publica_trt6',
  trt7:'api_publica_trt7',trt8:'api_publica_trt8',trt9:'api_publica_trt9',
  trt10:'api_publica_trt10',trt11:'api_publica_trt11',trt12:'api_publica_trt12',
  trt13:'api_publica_trt13',trt14:'api_publica_trt14',trt15:'api_publica_trt15',
  trt16:'api_publica_trt16',trt17:'api_publica_trt17',trt18:'api_publica_trt18',
  trt19:'api_publica_trt19',trt20:'api_publica_trt20',trt21:'api_publica_trt21',
  trt22:'api_publica_trt22',trt23:'api_publica_trt23',trt24:'api_publica_trt24',
};

function detectTribunalFromCNJ(num) {
  const d = String(num).replace(/\D/g,'');
  if(d.length !== 20) return null;
  const seg = d[13], tt = d.substring(14,16);
  const M = {'8':{'01':'tjac','02':'tjal','03':'tjam','04':'tjap','05':'tjba','06':'tjce',
    '07':'tjdft','08':'tjes','09':'tjgo','10':'tjma','11':'tjmt','12':'tjms','13':'tjmg',
    '14':'tjpa','15':'tjpb','16':'tjpr','17':'tjpe','18':'tjpi','19':'tjrj','20':'tjrn',
    '21':'tjrs','22':'tjro','23':'tjrr','24':'tjsc','25':'tjse','26':'tjsp','27':'tjto'},
    '9':{'01':'trt1','02':'trt2','03':'trt3','04':'trt4','05':'trt5','06':'trt6',
         '07':'trt7','08':'trt8','09':'trt9','10':'trt10','11':'trt11','12':'trt12',
         '13':'trt13','14':'trt14','15':'trt15','16':'trt16','17':'trt17','18':'trt18',
         '19':'trt19','20':'trt20','21':'trt21','22':'trt22','23':'trt23','24':'trt24','00':'tst'},
    '4':{'01':'trf1','02':'trf2','03':'trf3','04':'trf4','05':'trf5','06':'trf6'},
    '3':{'00':'stj'},'2':{'00':'tse'},'6':{'00':'stm'}};
  return (M[seg]&&M[seg][tt])||null;
}

async function handleDatajud(event, segments) {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Use POST.' });

  // sync-case e sync-all (legado)
  if (segments[1] === 'sync-case') { const out = await syncCaseById(segments[2]); return response(out.synced ? 200 : 422, out); }
  if (segments[1] === 'sync-all') { const { data, error } = await supabase().from('cases').select('id'); if (error) throw error; let synced = 0; const errors = []; for (const row of data || []) { const out = await syncCaseById(row.id); if (out.synced) synced += 1; else errors.push({ id: row.id, error: out.error }); } return response(200, { synced, errors }); }

  // BUSCA DE PROCESSOS (nova — não exige JWT)
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return response(400, { error: 'JSON inválido' }); }

  const { tribunal, numeroProcesso, query, size = 10, searchAfter } = body;

  let tribKey = (tribunal||'').toLowerCase();
  if (!tribKey && numeroProcesso) {
    const detected = detectTribunalFromCNJ(String(numeroProcesso).replace(/\D/g,''));
    if (detected) tribKey = detected;
  }
  if (!tribKey) return response(400, { error: 'Informe o tribunal ou numeroProcesso (20 dígitos)' });

  const alias = DJ_ALL_ENDPOINTS[tribKey];
  if (!alias) return response(400, { error: `Tribunal desconhecido: ${tribKey}` });

  let queryDSL = query;
  if (!queryDSL && numeroProcesso) {
    const nd = String(numeroProcesso).replace(/\D/g,'');
    queryDSL = { bool: { should: [{ match:{ numeroProcesso: nd } },{ term:{ 'numeroProcesso.keyword': nd } }], minimum_should_match: 1 } };
  }
  if (!queryDSL) return response(400, { error: 'Informe query ou numeroProcesso' });

  const djKey = process.env.DATAJUD_API_KEY || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
  const payload = { size: Math.min(size,100), query: queryDSL, sort:[{'@timestamp':{'order':'asc'}}] };
  if (searchAfter) payload.search_after = searchAfter;

  try {
    const res = await fetch(`${DJ_BASE_URL}${alias}/_search`, {
      method: 'POST',
      headers: { 'Authorization': `APIKey ${djKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      const msg = data?.error?.reason || data?.error?.type || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) return response(401, { error: `APIKey inválida: ${msg}` });
      if (res.status === 429) return response(429, { error: 'Rate limit. Aguarde.' });
      return response(res.status, { error: msg });
    }
    const hits = data?.hits?.hits || [];
    const total = data?.hits?.total?.value || 0;
    const lastSort = hits.length > 0 ? hits[hits.length-1].sort : null;
    return response(200, { ok:true, tribunal:tribKey.toUpperCase(), alias, total, hits:hits.map(h=>h._source), searchAfter:lastSort, took:data.took });
  } catch(e) {
    return response(502, { error: 'Erro ao chamar Datajud: '+e.message });
  }
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  try {
    const seg = getSegments(event);
    // IMPORTANTE: usar 'await' aqui dentro do try, e não apenas 'return funcao(...)'.
    // Sem o await, a promise é retornada antes do try/catch ter a chance de capturar
    // uma eventual rejeição — o erro escapa para o runtime do Netlify, que devolve um
    // formato bruto e ilegível ({"errorType":"object","errorMessage":"[object Object]"})
    // em vez da resposta JSON limpa que o catch abaixo deveria produzir.
    if (seg[0] === 'auth' && (seg[1] === 'login' || event.queryStringParameters?.action === 'login')) return await authLogin(event);
    const current = requireAuth(event);
    if (seg[0] === 'sync') return await legacySync(event);
    if (seg[0] === 'datajud') return await handleDatajud(event, seg);
    if (seg[0] === 'inbox') return await handleInbox(event, seg, current);
    return await handleTable(event, seg[0], seg[1], current);
  } catch (e) { return response(e.status || e.statusCode || 500, { ok: false, error: e.message || 'Erro interno.' }); }
}
