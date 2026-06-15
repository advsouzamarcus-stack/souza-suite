import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const tables = new Set(['clients','cases','tasks','appointments','financial_records','leads','conversations','messages','datajud_events','integration_jobs']);
const tableRoles = {
  clients:['admin','advogado','estagiario','recepcao'],
  cases:['admin','advogado','estagiario'],
  tasks:['admin','advogado','estagiario','recepcao'],
  appointments:['admin','advogado','estagiario','recepcao'],
  financial_records:['admin','advogado'],
  leads:['admin','advogado','recepcao'],
  conversations:['admin','advogado','recepcao'],
  messages:['admin','advogado','recepcao'],
  datajud_events:['admin','advogado','estagiario'],
  integration_jobs:['admin']
};

function env(name){
  return globalThis.Netlify?.env?.get?.(name) || process.env[name];
}
function response(status, body){
  return Response.json(body, { status });
}
function db(){
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if(!url || !key) throw Object.assign(new Error('Supabase não configurado.'), { status:500 });
  return createClient(url, key, { auth:{ persistSession:false }});
}
async function body(req){
  if(req.method === 'GET') return {};
  const text = await req.text();
  return text ? JSON.parse(text) : {};
}
function parts(req){
  const u = new URL(req.url);
  return u.pathname.replace(/^\/api\/?/,'').split('/').filter(Boolean);
}
function verify(req){
  const secret = env('JWT_SECRET');
  if(!secret) throw Object.assign(new Error('JWT_SECRET não configurado.'), { status:500 });
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if(!token) throw Object.assign(new Error('Não autenticado.'), { status:401 });
  try { return jwt.verify(token, secret); }
  catch { throw Object.assign(new Error('Sessão inválida.'), { status:401 }); }
}
function role(user, allowed){
  if(!allowed.includes(user.role)) throw Object.assign(new Error('Acesso negado.'), { status:403 });
}
function clean(table, data){
  const copy = { ...data };
  delete copy.id; delete copy.created_at; delete copy.updated_at; delete copy.password_hash;
  if(table === 'financial_records' && copy.amount) copy.amount = Number(copy.amount);
  if(table === 'cases' && copy.process_number) copy.process_number = String(copy.process_number).replace(/\D/g,'');
  return copy;
}
async function audit(supa, user, action, entity, entity_id, req){
  await supa.from('integration_jobs').insert({ integration:'audit', status:'done', input:{ action, entity, entity_id, user_id:user?.id, ip:req.headers.get('x-forwarded-for') }});
}
async function datajudQuery(processNumber, tribunal){
  const key = env('DATAJUD_API_KEY');
  if(!key) throw Object.assign(new Error('DATAJUD_API_KEY não configurada.'), { status:400 });
  const endpointMap = {
    tjrj:'api_publica_tjrj', trf2:'api_publica_trf2', trt1:'api_publica_trt1', stj:'api_publica_stj', stf:'api_publica_stf', tst:'api_publica_tst', tse:'api_publica_tse'
  };
  const endpoint = endpointMap[String(tribunal||'').toLowerCase()] || tribunal || 'api_publica_tjrj';
  const resp = await fetch(`https://api-publica.datajud.cnj.jus.br/${endpoint}/_search`, {
    method:'POST',
    headers:{ Authorization:`APIKey ${key}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ query:{ match:{ numeroProcesso:String(processNumber).replace(/\D/g,'') } }, size:10 })
  });
  const data = await resp.json().catch(()=>({}));
  if(!resp.ok) throw Object.assign(new Error(data?.error?.reason || 'Falha na consulta DataJud.'), { status:resp.status, data });
  return data;
}
async function syncCase(supa, item){
  const data = await datajudQuery(item.process_number, item.tribunal);
  const hit = data?.hits?.hits?.[0]?._source || null;
  await supa.from('cases').update({ datajud_payload:data, last_movement_at:hit?.dataHoraUltimaAtualizacao || null, updated_at:new Date().toISOString() }).eq('id', item.id);
  await supa.from('datajud_events').insert({ case_id:item.id, process_number:item.process_number, tribunal:item.tribunal, event_type:'sync', movement_at:hit?.dataHoraUltimaAtualizacao || null, payload:data });
  return data;
}
async function aiDraft(input){
  const key = env('OPENAI_API_KEY');
  if(!key) return 'Obrigado pelo contato. Para seguirmos com segurança, informe seu nome completo, telefone, área do caso e melhor horário para atendimento.';
  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST',
    headers:{ Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ model:env('OPENAI_MODEL') || 'gpt-4.1-mini', messages:[{ role:'system', content:'Você é assistente de triagem de escritório de advocacia no Brasil. Não promete resultado, não dá garantia, coleta dados, agenda atendimento e respeita LGPD e regras da OAB.' }, { role:'user', content:input }], temperature:0.2 })
  });
  const data = await resp.json().catch(()=>({}));
  return data?.choices?.[0]?.message?.content || 'Recebemos sua mensagem e vamos prosseguir com a triagem.';
}
async function outbound(channel, to, text){
  if(channel === 'whatsapp' && env('WHATSAPP_PHONE_NUMBER_ID') && env('WHATSAPP_TOKEN')){
    const resp = await fetch(`https://graph.facebook.com/v20.0/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, { method:'POST', headers:{ Authorization:`Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type':'application/json' }, body:JSON.stringify({ messaging_product:'whatsapp', to, type:'text', text:{ body:text } }) });
    return { ok:resp.ok, status:resp.status, data:await resp.json().catch(()=>({})) };
  }
  return { ok:false, skipped:true, reason:'Canal de saída não configurado.' };
}

export default async (req) => {
  try{
    const supa = db();
    const p = parts(req);
    const resource = p[0] || 'health';
    const id = p[1];
    const nestedId = p[2];

    if(resource === 'health') return response(200, { ok:true, service:'Souza Suite Cloud API' });

    if(resource === 'auth' && p[1] === 'bootstrap-admin' && req.method === 'POST'){
      const b = await body(req);
      if(!env('SETUP_KEY') || b.setupKey !== env('SETUP_KEY')) return response(403, { error:'Setup key inválida.' });
      const password_hash = bcrypt.hashSync(b.password, 12);
      const { data, error } = await supa.from('users').insert({ name:b.name || b.nome, email:b.email, password_hash, role:'admin', active:true }).select('id,name,email,role').single();
      if(error) return response(400, { error:error.message });
      return response(201, data);
    }

    if(resource === 'auth' && p[1] === 'login' && req.method === 'POST'){
      const b = await body(req);
      const { data:user, error } = await supa.from('users').select('*').eq('email', b.email).eq('active', true).single();
      if(error || !user || !bcrypt.compareSync(b.password || '', user.password_hash)) return response(401, { error:'E-mail ou senha inválidos.' });
      const token = jwt.sign({ id:user.id, name:user.name, email:user.email, role:user.role }, env('JWT_SECRET'), { expiresIn:'8h' });
      return response(200, { token, user:{ id:user.id, name:user.name, email:user.email, role:user.role } });
    }

    if(resource === 'webhooks'){
      const channel = p[1] || 'generic';
      const b = await body(req);
      const externalId = b.from || b.sender || b.phone || b.thread_id || b.id || crypto.randomUUID();
      const text = b.text || b.body || b.message || b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.text?.body || '';
      const phone = b.phone || b.from || b?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from || null;
      const { data:lead } = await supa.from('leads').insert({ name:b.name || null, phone, email:b.email || null, source:channel, summary:text, metadata:b }).select('*').single();
      const { data:conv } = await supa.from('conversations').insert({ lead_id:lead?.id, channel, external_thread_id:String(externalId), metadata:b }).select('*').single();
      if(text && conv?.id) await supa.from('messages').insert({ conversation_id:conv.id, direction:'inbound', sender:String(externalId), body:text, payload:b });
      let draft = null, sent = null;
      if(text){ draft = await aiDraft(text); if(phone) sent = await outbound(channel, phone, draft); if(conv?.id) await supa.from('messages').insert({ conversation_id:conv.id, direction:'outbound', sender:'ai', body:draft, payload:{ sent } }); }
      return response(200, { ok:true, lead_id:lead?.id, conversation_id:conv?.id, draft, sent });
    }

    const user = verify(req);

    if(resource === 'users'){
      role(user, ['admin']);
      if(req.method === 'GET'){
        const { data, error } = await supa.from('users').select('id,name,email,role,active,created_at').order('created_at',{ ascending:false });
        if(error) return response(400, { error:error.message });
        return response(200, data);
      }
      if(req.method === 'POST'){
        const b = await body(req);
        const password_hash = bcrypt.hashSync(b.password, 12);
        const { data, error } = await supa.from('users').insert({ name:b.name, email:b.email, password_hash, role:b.role || 'advogado', active:b.active !== false }).select('id,name,email,role,active').single();
        if(error) return response(400, { error:error.message });
        return response(201, data);
      }
    }

    if(resource === 'datajud'){
      role(user, ['admin','advogado','estagiario']);
      if(p[1] === 'query' && req.method === 'POST'){
        const b = await body(req);
        return response(200, await datajudQuery(b.process_number || b.numero, b.tribunal));
      }
      if(p[1] === 'sync-case' && nestedId && req.method === 'POST'){
        const { data:item, error } = await supa.from('cases').select('*').eq('id', nestedId).single();
        if(error) return response(404, { error:'Processo não encontrado.' });
        const data = await syncCase(supa, item);
        await audit(supa, user, 'datajud_sync', 'cases', nestedId, req);
        return response(200, data);
      }
      if(p[1] === 'sync-all' && req.method === 'POST'){
        const { data:items, error } = await supa.from('cases').select('*').limit(50);
        if(error) return response(400, { error:error.message });
        let synced=0, errors=[];
        for(const item of items||[]){ try{ await syncCase(supa,item); synced++; } catch(e){ errors.push({ process_number:item.process_number, error:e.message }); } }
        return response(200, { synced, errors });
      }
    }

    if(resource === 'calendar' && p[1] === 'create' && req.method === 'POST'){
      const url = env('GOOGLE_APPS_SCRIPT_URL');
      if(!url) return response(400, { error:'GOOGLE_APPS_SCRIPT_URL não configurada.' });
      const resp = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(await body(req)) });
      return response(resp.ok?200:resp.status, await resp.json().catch(()=>({ ok:resp.ok })));
    }

    if(tables.has(resource)){
      role(user, tableRoles[resource] || ['admin']);
      if(req.method === 'GET'){
        let q = supa.from(resource).select('*').order('created_at',{ ascending:false });
        if(id) q = supa.from(resource).select('*').eq('id', id).single();
        const { data, error } = await q;
        if(error) return response(400, { error:error.message });
        return response(200, data);
      }
      if(req.method === 'POST'){
        const payload = clean(resource, await body(req));
        if(['clients','cases','tasks','appointments','financial_records'].includes(resource)) payload.created_by = user.id;
        const { data, error } = await supa.from(resource).insert(payload).select('*').single();
        if(error) return response(400, { error:error.message });
        await audit(supa, user, 'create', resource, data.id, req);
        return response(201, data);
      }
      if(req.method === 'PUT' && id){
        const { data, error } = await supa.from(resource).update({ ...clean(resource, await body(req)), updated_at:new Date().toISOString() }).eq('id', id).select('*').single();
        if(error) return response(400, { error:error.message });
        await audit(supa, user, 'update', resource, id, req);
        return response(200, data);
      }
      if(req.method === 'DELETE' && id){
        role(user, ['admin','advogado']);
        const { error } = await supa.from(resource).delete().eq('id', id);
        if(error) return response(400, { error:error.message });
        await audit(supa, user, 'delete', resource, id, req);
        return response(200, { ok:true });
      }
    }

    return response(404, { error:'Rota não encontrada.' });
  }catch(e){
    return response(e.status || 500, { error:e.message || 'Erro interno.' });
  }
};

export const config = { path:'/api/*' };
