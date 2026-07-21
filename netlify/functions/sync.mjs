// sync.mjs v5.4 — Sincronização bidirecional + partes de processo (case_parties)

// ── UUID v5 determinístico (SHA-1 baseado) ───────────────────────
const NS = '6ba7b8109dad11d180b400c04fd430c8'; // DNS namespace
async function toUUID(localId, table) {
      const key = `souzaadv.${table}.${localId}`;
      const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(NS + key));
      const b   = new Uint8Array(buf);
      b[6] = (b[6] & 0x0f) | 0x50;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('');
      return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

const _uCache = new Map();
async function uid(localId, table) {
      const key = `${table}:${localId}`;
      if(_uCache.has(key)) return _uCache.get(key);
      if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(localId))) {
              _uCache.set(key, String(localId));
              return String(localId);
      }
      const u = await toUUID(String(localId), table);
      _uCache.set(key, u);
      return u;
}

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
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s,headers:CORS});

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

async function cliToSupa(c) {
      if(!c.id || !c.nome) return null;
      return {
              id:           await uid(c.id, 'clients'),
              name:         c.nome || '',
              cpf_cnpj:     c.cpf  || '',
              phone:        c.tel  || '',
              email:        c.email|| '',
              address:      c.end  || '',
              notes:        c.obs  || '',
              source:       c.tipo || 'Ativo',
              person_type:  c.pessoa === 'juridica' ? 'juridica' : 'fisica',
              trade_name:   c.fantasia || '',
              company_name: c.pessoa === 'juridica' ? (c.nome || '') : '',
              created_at:   c.criadoEm || c.createdAt || new Date().toISOString(),
              updated_at:   new Date().toISOString(),
      };
}
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
              pessoa:    r.person_type|| 'fisica',
              fantasia:  r.trade_name || '',
              criadoEm:  r.created_at || '',
      };
}

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
              lawyer:          p.adv   || '',
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
              adv:       r.lawyer         || '',
              obs:       r.subject        || '',
              djMov:     djInfo.mov       || '',
              djMovDt:   r.last_movement_at || '',
              djSyncAt:  djInfo.syncAt    || '',
      };
}

// PARTE DO PROCESSO: {id, procId, cliId, polo, papel, advExterno}
// → case_parties: {id, case_id, client_id, pole, role, external_lawyer}
async function partToSupa(pt) {
      if(!pt.id || !pt.procId || !pt.cliId) return null;
      return {
              id:              await uid(pt.id, 'case_parties'),
              case_id:         await uid(pt.procId, 'cases'),
              client_id:       await uid(pt.cliId, 'clients'),
              pole:            pt.polo || 'ativo',
              role:            pt.papel || 'cliente',
              external_lawyer: pt.advExterno || '',
      };
}
function supaToParte(r) {
      return {
              id:         r.id,
              procId:     r.case_id,
              cliId:      r.client_id,
              polo:       r.pole || 'ativo',
              papel:      r.role || 'cliente',
              advExterno: r.external_lawyer || '',
      };
}

async function bkToSupa(b) {
      if(!b.id) return null;
      const dateStr = b.data && b.hora ? `${b.data}T${b.hora}:00` : (b.data || new Date().toISOString().slice(0,10));
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
              customPerms: r.custom_perms || null,
      };
}
function supaToLog(r) {
      const dt = r.created_at ? new Date(r.created_at) : new Date();
      return {
              id:      r.id,
              usuario: r.usuario || '',
              perfil:  r.perfil  || '',
              data:    dt.toLocaleDateString('pt-BR'),
              hora:    dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
              mod:     r.modulo  || '',
              acao:    r.acao    || '',
              negado:  !!r.negado,
      };
}
function supaToAgenda(r) {
      let f = {};
      try {
              f = JSON.parse(r.description || '{}');
              if (typeof f !== 'object' || Array.isArray(f) || f === null) f = {};
      } catch(e) {
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
              assigned_to_name: t.resp || '',
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
              prio:   ({'alta':'Alta','media':'Média','baixa':'Baixa','urgente':'Urgente'}[r.priority] || 'Média'),
              status: ({'pendente':'Pendente','em_andamento':'Em andamento','concluida':'Concluído','cancelada':'Cancelada'}[r.status] || 'Pendente'),
              resp:   r.assigned_to_name || '',
              ok:     r.status === 'concluida',
      };
}

async function finToSupa(f) {
      if(!f.id || !f.desc) return null;
      return {
              id:          await uid(f.id, 'financial_records'),
              client_id:   f.cliId ? await uid(f.cliId, 'clients') : null,
              description: f.desc || '',
              amount:      parseFloat(f.ct || f.valor || 0),
              amount_received: parseFloat(f.rc || 0),
              kind:        ({'PIX':'receita','Transferência':'receita','TED':'receita','Crédito':'receita','Débito':'receita','Dinheiro':'receita','Boleto':'receita','Cartão':'receita','Honorários':'receita','Despesa':'despesa','despesa':'despesa','receita':'receita'}[f.pg]||'receita'),
              status:      ({'Pago':'pago','Parcial':'pago','Pendente':'pendente','Cancelado':'cancelado','Atrasado':'atrasado','pago':'pago','pendente':'pendente','atrasado':'atrasado'}[f.st]||'pendente'),
              due_at:      (f.data || new Date().toISOString()).slice(0,10),
              paid_at:     (f.st === 'Pago' || f.st === 'pago') ? f.data : null,
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
              rc:    r.amount_received || 0,
              pg:    r.kind        || 'PIX',
              st:    ({'pago':'Pago','pendente':'Pendente','atrasado':'Atrasado','cancelado':'Cancelado'}[r.status] || 'Pendente'),
              data:  (r.due_at||'').slice(0,10),
      };
}

export default async (req) => {
      if(req.method === 'OPTIONS') return new Response(null,{status:204,headers:CORS});
    
      let user;
      try {
              const auth = (req.headers.get('Authorization')||'').replace('Bearer ','');
              user = await verifyToken(auth);
      } catch(e) { return err('Não autorizado: '+e.message, 401); }
    
      const url    = new URL(req.url);
      const action = url.pathname.split('/').filter(Boolean).pop();
    
      if(req.method === 'GET' || action === 'pull') {
              try {
                        const [clients, cases, appointments, tasks, financial, usrs, logs, parties] = await Promise.all([
                                    supa('clients?order=created_at.desc&limit=500'),
                                    supa('cases?order=created_at.desc&limit=500'),
                                    supa('appointments?order=starts_at.asc&limit=500'),
                                    supa('tasks?order=due_at.asc&limit=500'),
                                    supa('financial_records?order=due_at.desc&limit=500'),
                                    supa('users?select=id,name,email,role,active,oab,cargo,tel,custom_perms&order=id.asc'),
                                    supa('access_log?order=created_at.desc&limit=300'),
                                    supa('case_parties?order=created_at.desc&limit=1000'),
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
                                                  logs:         logs.map(supaToLog),
                                                  partes:       parties.map(supaToParte),
                                    }
                        });
              } catch(e) {
                        console.error('[sync pull]', e.message);
                        return err('Erro pull: '+e.message, 500);
              }
      }
    
      if(req.method === 'POST' || action === 'push') {
              let body;
              try { body = await req.json(); } catch { return err('JSON inválido'); }
              const { data={} } = body;
          
              const results = {};
              const errors  = [];
          
              const MAPS = [
                  { key:'clientes',     table:'clients',           fn: cliToSupa  },
                  { key:'processos',    table:'cases',             fn: procToSupa },
                  { key:'agendamentos', table:'appointments',      fn: bkToSupa   },
                  { key:'tarefas',      table:'tasks',             fn: tarToSupa  },
                  { key:'financeiro',   table:'financial_records', fn: finToSupa  },
                  { key:'partes',       table:'case_parties',      fn: partToSupa },
                      ];
          
              for(const {key, table, fn} of MAPS) {
                        const rows = data[key];
                        if(!rows?.length) { results[key]=0; continue; }
                  
                        const mapped = (await Promise.all(rows.map(fn))).filter(Boolean);
                        if(!mapped.length) { results[key]=0; continue; }
                  
                        let count=0;
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
    
      if(req.method === 'DELETE') {
              let body;
              try { body = await req.json(); } catch { return err('JSON inválido'); }
              const TABLE_BY_KEY = {
                        clientes: 'clients', processos: 'cases', agendamentos: 'appointments',
                        tarefas: 'tasks', financeiro: 'financial_records', partes: 'case_parties',
              };
              const table = TABLE_BY_KEY[body.key] || body.table;
              const rawId = body.id;
              if(!table || !rawId) return err('Informe key (ou table) e id.');
              try {
                        const realId = await uid(rawId, table);
                        await supa(`${table}?id=eq.${encodeURIComponent(realId)}`, 'DELETE');
                        return ok({ ok: true, table, id: realId });
              } catch(e) {
                        return err('Erro ao excluir: '+e.message, 500);
              }
      }
    
      return err('Método não suportado', 405);
};

export const config = { path: ['/api/sync', '/api/sync/:action'] };
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
    if(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(localId))) {
          _uCache.set(key, String(localId));
          return String(localId);
    }
    const u = await toUUID(String(localId), table);
    _uCache.set(key, u);
    return u;
}

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
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s,headers:CORS});

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

async function cliToSupa(c) {
    if(!c.id || !c.nome) return null;
    return {
          id:           await uid(c.id, 'clients'),
          name:         c.nome || '',
          cpf_cnpj:     c.cpf  || '',
          phone:        c.tel  || '',
          email:        c.email|| '',
          address:      c.end  || '',
          notes:        c.obs  || '',
          source:       c.tipo || 'Ativo',
          person_type:  c.pessoa === 'juridica' ? 'juridica' : 'fisica',
          trade_name:   c.fantasia || '',
          company_name: c.pessoa === 'juridica' ? (c.nome || '') : '',
          created_at:   c.criadoEm || c.createdAt || new Date().toISOString(),
          updated_at:   new Date().toISOString(),
    };
}
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
          pessoa:    r.person_type|| 'fisica',
          fantasia:  r.trade_name || '',
          criadoEm:  r.created_at || '',
    };
}

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
          lawyer:          p.adv   || '',
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
          adv:       r.lawyer         || '',
          obs:       r.subject        || '',
          djMov:     djInfo.mov       || '',
          djMovDt:   r.last_movement_at || '',
          djSyncAt:  djInfo.syncAt    || '',
    };
}

async function bkToSupa(b) {
    if(!b.id) return null;
    const dateStr = b.data && b.hora ? `${b.data}T${b.hora}:00` : (b.data || new Date().toISOString().slice(0,10));
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
          customPerms: r.custom_perms || null,
    };
}
function supaToLog(r) {
    const dt = r.created_at ? new Date(r.created_at) : new Date();
    return {
          id:      r.id,
          usuario: r.usuario || '',
          perfil:  r.perfil  || '',
          data:    dt.toLocaleDateString('pt-BR'),
          hora:    dt.toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit' }),
          mod:     r.modulo  || '',
          acao:    r.acao    || '',
          negado:  !!r.negado,
    };
}
function supaToAgenda(r) {
    let f = {};
    try {
          f = JSON.parse(r.description || '{}');
          if (typeof f !== 'object' || Array.isArray(f) || f === null) f = {};
    } catch(e) {
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
          assigned_to_name: t.resp || '',
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
          prio:   ({'alta':'Alta','media':'Média','baixa':'Baixa','urgente':'Urgente'}[r.priority] || 'Média'),
          status: ({'pendente':'Pendente','em_andamento':'Em andamento','concluida':'Concluído','cancelada':'Cancelada'}[r.status] || 'Pendente'),
          resp:   r.assigned_to_name || '',
          ok:     r.status === 'concluida',
    };
}

async function finToSupa(f) {
    if(!f.id || !f.desc) return null;
    return {
          id:          await uid(f.id, 'financial_records'),
          client_id:   f.cliId ? await uid(f.cliId, 'clients') : null,
          description: f.desc || '',
          amount:      parseFloat(f.ct || f.valor || 0),
          amount_received: parseFloat(f.rc || 0),
          kind:        ({'PIX':'receita','Transferência':'receita','TED':'receita','Crédito':'receita','Débito':'receita','Dinheiro':'receita','Boleto':'receita','Cartão':'receita','Honorários':'receita','Despesa':'despesa','despesa':'despesa','receita':'receita'}[f.pg]||'receita'),
          status:      ({'Pago':'pago','Parcial':'pago','Pendente':'pendente','Cancelado':'cancelado','Atrasado':'atrasado','pago':'pago','pendente':'pendente','atrasado':'atrasado'}[f.st]||'pendente'),
          due_at:      (f.data || new Date().toISOString()).slice(0,10),
          paid_at:     (f.st === 'Pago' || f.st === 'pago') ? f.data : null,
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
          rc:    r.amount_received || 0,
          pg:    r.kind        || 'PIX',
          st:    ({'pago':'Pago','pendente':'Pendente','atrasado':'Atrasado','cancelado':'Cancelado'}[r.status] || 'Pendente'),
          data:  (r.due_at||'').slice(0,10),
    };
}

export default async (req) => {
    if(req.method === 'OPTIONS') return new Response(null,{status:204,headers:CORS});

    let user;
    try {
          const auth = (req.headers.get('Authorization')||'').replace('Bearer ','');
          user = await verifyToken(auth);
    } catch(e) { return err('Não autorizado: '+e.message, 401); }

    const url    = new URL(req.url);
    const action = url.pathname.split('/').filter(Boolean).pop();

    if(req.method === 'GET' || action === 'pull') {
          try {
                  const [clients, cases, appointments, tasks, financial, usrs, logs] = await Promise.all([
                            supa('clients?order=created_at.desc&limit=500'),
                            supa('cases?order=created_at.desc&limit=500'),
                            supa('appointments?order=starts_at.asc&limit=500'),
                            supa('tasks?order=due_at.asc&limit=500'),
                            supa('financial_records?order=due_at.desc&limit=500'),
                            supa('users?select=id,name,email,role,active,oab,cargo,tel,custom_perms&order=id.asc'),
                            supa('access_log?order=created_at.desc&limit=300'),
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
                                        logs:         logs.map(supaToLog),
                            }
                  });
          } catch(e) {
                  console.error('[sync pull]', e.message);
                  return err('Erro pull: '+e.message, 500);
          }
    }

    if(req.method === 'POST' || action === 'push') {
          let body;
          try { body = await req.json(); } catch { return err('JSON inválido'); }
          const { data={} } = body;

      const results = {};
          const errors  = [];

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

    if(req.method === 'DELETE') {
          let body;
          try { body = await req.json(); } catch { return err('JSON inválido'); }
          const TABLE_BY_KEY = {
                  clientes: 'clients', processos: 'cases', agendamentos: 'appointments',
                  tarefas: 'tasks', financeiro: 'financial_records',
          };
          const table = TABLE_BY_KEY[body.key] || body.table;
          const rawId = body.id;
          if(!table || !rawId) return err('Informe key (ou table) e id.');
          try {
                  const realId = await uid(rawId, table);
                  await supa(`${table}?id=eq.${encodeURIComponent(realId)}`, 'DELETE');
                  return ok({ ok: true, table, id: realId });
          } catch(e) {
                  return err('Erro ao excluir: '+e.message, 500);
          }
    }

    return err('Método não suportado', 405);
};

export const config = { path: ['/api/sync', '/api/sync/:action'] };
