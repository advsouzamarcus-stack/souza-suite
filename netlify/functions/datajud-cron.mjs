// datajud-cron.mjs
// Sincronizacao automatica diaria com o Datajud CNJ para todos os processos
// ativos, com registro de historico (datajud_events) e criacao automatica
// de tarefa quando a movimentacao mais recente sugerir intimacao/prazo.

function getEnv(key) {
  try { if (typeof Netlify !== 'undefined' && Netlify.env) { const v = Netlify.env.get(key); if (v) return v; } } catch(e) {}
  try { if (typeof process !== 'undefined' && process.env) { const v = process.env[key]; if (v) return v; } } catch(e) {}
  return undefined;
}

const SUPA_URL = getEnv('SUPABASE_URL') || 'https://briobxgqygjcyrbasqan.supabase.co';
const SUPA_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const DJ_KEY   = getEnv('DATAJUD_API_KEY') || getEnv('DATAJUD_PUBLIC_KEY') || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DJ_BASE  = 'https://api-publica.datajud.cnj.jus.br/';

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

// Deteccao de tribunal pelo numero CNJ (20 digitos) — mesma tabela corrigida
// (padrao CNJ Resolucao 65/2008) usada em datajud.mjs.
function detectTribunal(num) {
  const d = String(num).replace(/\D/g,'');
  if (d.length !== 20) return null;
  const seg = d[13];
  const tt  = d.substring(14,16);
  const MAP = {
    '8': {'01':'tjac','02':'tjal','03':'tjam','04':'tjap','05':'tjba','06':'tjce',
          '07':'tjdft','08':'tjes','09':'tjgo','10':'tjma','11':'tjmt','12':'tjms',
          '13':'tjmg','14':'tjpa','15':'tjpb','16':'tjpr','17':'tjpe','18':'tjpi',
          '19':'tjrj','20':'tjrn','21':'tjrs','22':'tjro','23':'tjrr','24':'tjsc',
          '25':'tjse','26':'tjsp','27':'tjto'},
    '5': {'01':'trt1','02':'trt2','03':'trt3','04':'trt4','05':'trt5','06':'trt6',
          '07':'trt7','08':'trt8','09':'trt9','10':'trt10','11':'trt11','12':'trt12',
          '13':'trt13','14':'trt14','15':'trt15','16':'trt16','17':'trt17','18':'trt18',
          '19':'trt19','20':'trt20','21':'trt21','22':'trt22','23':'trt23','24':'trt24',
          '00':'tst'},
    '4': {'01':'trf1','02':'trf2','03':'trf3','04':'trf4','05':'trf5','06':'trf6'},
    '3': {'00':'stj'},
    '6': {'01':'treac','02':'treal','03':'tream','04':'treap','05':'treba','06':'trece',
          '07':'tredft','08':'trees','09':'trego','10':'trema','11':'tremt','12':'trems',
          '13':'tremg','14':'trepa','15':'trepb','16':'trepr','17':'trepe','18':'trepi',
          '19':'trerj','20':'trern','21':'trers','22':'trero','23':'trerr','24':'tresc',
          '25':'trese','26':'tresp','27':'treto','00':'tse'},
    '7': {'00':'stm'},
    '9': {'13':'tjmmg','21':'tjmrs','26':'tjmsp'},
  };
  return (MAP[seg] && MAP[seg][tt]) || null;
}

export default async (req) => {
  const inicio = Date.now();
  const resultados = [];

  try {
    const casos = await supa('cases?process_number=not.is.null&select=id,process_number,client_id,status&limit=200');

    for (const c of casos) {
      const st = String(c.status || '').toLowerCase();
      if (st.includes('arquiv') || st.includes('encerr') || st.includes('baix') || st.includes('transitad')) continue;

      const numClean = String(c.process_number || '').replace(/\D/g, '');
      if (numClean.length !== 20) { resultados.push({ case_id: c.id, ok: false, erro: 'numero invalido' }); continue; }

      const trib = detectTribunal(numClean);
      if (!trib) { resultados.push({ case_id: c.id, ok: false, erro: 'tribunal nao identificado' }); continue; }

      try {
        const resp = await fetch(`${DJ_BASE}api_publica_${trib}/_search`, {
          method: 'POST',
          headers: { Authorization: `APIKey ${DJ_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ size: 1, query: { match: { numeroProcesso: numClean } } }),
        });
        const data = await resp.json();
        const hit = data && data.hits && data.hits.hits && data.hits.hits[0] && data.hits.hits[0]._source;
        if (!hit) { resultados.push({ case_id: c.id, ok: false, erro: 'nao encontrado no datajud' }); continue; }

        const movs = hit.movimentos || [];
        const ultimoMov = movs.slice().sort((a, b) => new Date(b.dataHora || 0) - new Date(a.dataHora || 0))[0];

        await supa(`cases?id=eq.${c.id}`, 'PATCH', {
          datajud_payload: JSON.stringify({ mov: hit, syncAt: new Date().toISOString() }),
          last_movement_at: (ultimoMov && ultimoMov.dataHora) || null,
          updated_at: new Date().toISOString(),
        });

        await supa('datajud_events', 'POST', [{
          case_id: c.id,
          process_number: c.process_number,
          tribunal: trib.toUpperCase(),
          event_type: 'sync_automatico',
          movement_at: (ultimoMov && ultimoMov.dataHora) || null,
          payload: hit,
        }]);

        if (ultimoMov && /intima|prazo|citac/i.test(ultimoMov.nome || '')) {
          await supa('tasks', 'POST', [{
            case_id: c.id,
            client_id: c.client_id,
            title: 'Verificar movimentacao: ' + (ultimoMov.nome || 'nova movimentacao') + ' (' + c.process_number + ')',
            due_at: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
            status: 'pendente',
            priority: 'alta',
          }]);
        }

        resultados.push({ case_id: c.id, tribunal: trib.toUpperCase(), ok: true });
      } catch (e) {
        resultados.push({ case_id: c.id, ok: false, erro: e.message });
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

// Roda todos os dias as 09:00 BRT (12:00 UTC)
export const config = { schedule: '0 12 * * *' };
