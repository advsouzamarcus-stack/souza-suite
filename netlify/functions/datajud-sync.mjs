import { createClient } from '@supabase/supabase-js';
function env(name){ return globalThis.Netlify?.env?.get?.(name) || process.env[name]; }
function db(){ return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth:{ persistSession:false }}); }
async function queryDataJud(processNumber, tribunal){
  const map={tjrj:'api_publica_tjrj',trf2:'api_publica_trf2',trt1:'api_publica_trt1',stj:'api_publica_stj',stf:'api_publica_stf',tst:'api_publica_tst',tse:'api_publica_tse'};
  const endpoint=map[String(tribunal||'').toLowerCase()]||tribunal||'api_publica_tjrj';
  const r=await fetch(`https://api-publica.datajud.cnj.jus.br/${endpoint}/_search`,{method:'POST',headers:{Authorization:`APIKey ${env('DATAJUD_API_KEY')}`,'Content-Type':'application/json'},body:JSON.stringify({query:{match:{numeroProcesso:String(processNumber).replace(/\D/g,'')}},size:10})});
  if(!r.ok) throw new Error(`DataJud ${r.status}`);
  return r.json();
}
export default async () => {
  if(!env('SUPABASE_URL') || !env('SUPABASE_SERVICE_ROLE_KEY') || !env('DATAJUD_API_KEY')) return;
  const supa=db();
  const {data:items}=await supa.from('cases').select('*').order('updated_at',{ascending:true}).limit(25);
  for(const item of items||[]){
    try{
      const payload=await queryDataJud(item.process_number,item.tribunal);
      const hit=payload?.hits?.hits?.[0]?._source||null;
      await supa.from('cases').update({datajud_payload:payload,last_movement_at:hit?.dataHoraUltimaAtualizacao||null,updated_at:new Date().toISOString()}).eq('id',item.id);
      await supa.from('datajud_events').insert({case_id:item.id,process_number:item.process_number,tribunal:item.tribunal,event_type:'scheduled_sync',movement_at:hit?.dataHoraUltimaAtualizacao||null,payload});
    }catch(error){
      await supa.from('integration_jobs').insert({integration:'datajud',status:'error',input:{case_id:item.id,process_number:item.process_number},error:error.message});
    }
  }
};
export const config={schedule:'0 * * * *'};
