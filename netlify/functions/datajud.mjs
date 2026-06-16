// datajud.mjs — 1781616505 — Proxy seguro para a API Pública do Datajud/CNJ
// A API Key fica no servidor (não exposta no frontend)
// Elimina problemas de CORS e exposição da chave

const DJ_KEY  = Netlify.env.get('DATAJUD_API_KEY') || 'cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';
const DJ_BASE = 'https://api-publica.datajud.cnj.jus.br/';

// Mapa completo de tribunais
const DJ_EP = {
  // Superiores
  tst:'api_publica_tst', tse:'api_publica_tse', stj:'api_publica_stj', stm:'api_publica_stm',
  // Estaduais
  tjac:'api_publica_tjac', tjal:'api_publica_tjal', tjam:'api_publica_tjam', tjap:'api_publica_tjap',
  tjba:'api_publica_tjba', tjce:'api_publica_tjce', tjdft:'api_publica_tjdft', tjes:'api_publica_tjes',
  tjgo:'api_publica_tjgo', tjma:'api_publica_tjma', tjmg:'api_publica_tjmg', tjms:'api_publica_tjms',
  tjmt:'api_publica_tjmt', tjpa:'api_publica_tjpa', tjpb:'api_publica_tjpb', tjpr:'api_publica_tjpr',
  tjpe:'api_publica_tjpe', tjpi:'api_publica_tjpi', tjrj:'api_publica_tjrj', tjrn:'api_publica_tjrn',
  tjrs:'api_publica_tjrs', tjro:'api_publica_tjro', tjrr:'api_publica_tjrr', tjsc:'api_publica_tjsc',
  tjse:'api_publica_tjse', tjsp:'api_publica_tjsp', tjto:'api_publica_tjto',
  // Federais
  trf1:'api_publica_trf1', trf2:'api_publica_trf2', trf3:'api_publica_trf3',
  trf4:'api_publica_trf4', trf5:'api_publica_trf5', trf6:'api_publica_trf6',
  // Trabalho
  trt1:'api_publica_trt1', trt2:'api_publica_trt2', trt3:'api_publica_trt3',
  trt4:'api_publica_trt4', trt5:'api_publica_trt5', trt6:'api_publica_trt6',
  trt7:'api_publica_trt7', trt8:'api_publica_trt8', trt9:'api_publica_trt9',
  trt10:'api_publica_trt10', trt11:'api_publica_trt11', trt12:'api_publica_trt12',
  trt13:'api_publica_trt13', trt14:'api_publica_trt14', trt15:'api_publica_trt15',
  trt16:'api_publica_trt16', trt17:'api_publica_trt17', trt18:'api_publica_trt18',
  trt19:'api_publica_trt19', trt20:'api_publica_trt20', trt21:'api_publica_trt21',
  trt22:'api_publica_trt22', trt23:'api_publica_trt23', trt24:'api_publica_trt24',
  // Eleitorais
  treac:'api_publica_treac', treal:'api_publica_treal', tream:'api_publica_tream',
  treap:'api_publica_treap', treba:'api_publica_treba', trece:'api_publica_trece',
  tredft:'api_publica_tredft', trees:'api_publica_trees', trego:'api_publica_trego',
  trema:'api_publica_trema', tremg:'api_publica_tremg', trems:'api_publica_trems',
  tremt:'api_publica_tremt', trepa:'api_publica_trepa', trepb:'api_publica_trepb',
  trepe:'api_publica_trepe', trepi:'api_publica_trepi', trepr:'api_publica_trepr',
  trerj:'api_publica_trerj', trern:'api_publica_trern', trero:'api_publica_trero',
  trerr:'api_publica_trerr', trers:'api_publica_trers', tresc:'api_publica_tresc',
  trese:'api_publica_trese', tresp:'api_publica_tresp', treto:'api_publica_treto',
  // Militar
  tjmmg:'api_publica_tjmmg', tjmrs:'api_publica_tjmrs', tjmsp:'api_publica_tjmsp',
};

// Detectar tribunal pelo número CNJ (20 dígitos)
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
    '9': {'01':'trt1','02':'trt2','03':'trt3','04':'trt4','05':'trt5','06':'trt6',
           '07':'trt7','08':'trt8','09':'trt9','10':'trt10','11':'trt11','12':'trt12',
           '13':'trt13','14':'trt14','15':'trt15','16':'trt16','17':'trt17','18':'trt18',
           '19':'trt19','20':'trt20','21':'trt21','22':'trt22','23':'trt23','24':'trt24',
           '00':'tst'},
    '4': {'01':'trf1','02':'trf2','03':'trf3','04':'trf4','05':'trf5','06':'trf6'},
    '3': {'00':'stj'}, '2': {'00':'tse'}, '6': {'00':'stm'},
  };
  return (MAP[seg] && MAP[seg][tt]) || null;
}

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};
const ok  = d => new Response(JSON.stringify(d), { headers: CORS });
const err = (m,s=400) => new Response(JSON.stringify({error:m}), {status:s,headers:CORS});

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('',{status:204,headers:CORS});
  if (req.method !== 'POST') return err('Use POST',405);

  let body;
  try { body = await req.json(); }
  catch { return err('JSON inválido'); }

  const { tribunal, numeroProcesso, query, size = 10, searchAfter } = body;

  // Determinar o tribunal
  let tribKey = tribunal?.toLowerCase();

  // Se passou número do processo, detectar automaticamente
  if (!tribKey && numeroProcesso) {
    const detected = detectTribunal(String(numeroProcesso).replace(/\D/g,''));
    if (detected) tribKey = detected;
  }

  if (!tribKey) return err('Informe o tribunal ou numeroProcesso com 20 dígitos');
  const alias = DJ_EP[tribKey];
  if (!alias) return err(`Tribunal desconhecido: ${tribKey}. Use a sigla (ex: tjrj, trt1, stj)`);

  // Montar query DSL
  let queryDSL = query;
  if (!queryDSL && numeroProcesso) {
    const numClean = String(numeroProcesso).replace(/\D/g,'');
    queryDSL = {
      bool: {
        should: [
          { match:  { numeroProcesso: numClean } },
          { term:   { 'numeroProcesso.keyword': numClean } }
        ],
        minimum_should_match: 1
      }
    };
  }
  if (!queryDSL) return err('Informe query ou numeroProcesso');

  const payload = {
    size: Math.min(size, 100),
    query: queryDSL,
    sort: [{ '@timestamp': { order: 'asc' } }],
    ...(searchAfter ? { search_after: searchAfter } : {}),
  };

  try {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), 20000);

    const resp = await fetch(`${DJ_BASE}${alias}/_search`, {
      method:  'POST',
      headers: {
        'Authorization': `APIKey ${DJ_KEY}`,
        'Content-Type':  'application/json',
      },
      body:    JSON.stringify(payload),
      signal:  ctrl.signal,
    });
    clearTimeout(tid);

    const data = await resp.json();

    if (!resp.ok) {
      const msg = data?.error?.reason || data?.error?.type || `HTTP ${resp.status}`;
      if (resp.status === 401 || resp.status === 403)
        return err(`APIKey inválida ou sem permissão: ${msg}`, 401);
      if (resp.status === 429)
        return err('Limite de requisições atingido. Aguarde alguns segundos.', 429);
      return err(`Erro Datajud (${resp.status}): ${msg}`, resp.status);
    }

    const hits  = data?.hits?.hits || [];
    const total = data?.hits?.total?.value || 0;

    // Extrair search_after do último hit para paginação
    const lastSort = hits.length > 0 ? hits[hits.length - 1].sort : null;

    return ok({
      ok:          true,
      tribunal:    tribKey.toUpperCase(),
      alias,
      total,
      hits:        hits.map(h => h._source),
      searchAfter: lastSort,
      took:        data.took,
    });

  } catch(e) {
    if (e.name === 'AbortError')
      return err('Timeout: a API Datajud demorou mais de 20 segundos', 504);
    console.error('[datajud]', e.message);
    return err('Erro interno: ' + e.message, 500);
  }
};

export const config = { path: '/api/datajud' };
