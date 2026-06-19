/**
 * Souza Advocacia — Assistente Virtual WhatsApp
 * 
 * GET  /api/whatsapp  → verificação do webhook pela Meta (challenge)
 * POST /api/whatsapp  → mensagem recebida → Gemini → resposta automática
 *
 * Variáveis de ambiente necessárias (Netlify → Site configuration → Environment variables):
 *   WA_PHONE_NUMBER_ID      – Phone Number ID da Meta for Developers
 *   WA_TOKEN                – Access token da API do WhatsApp
 *   WA_VERIFY_TOKEN         – Token de verificação (mesmo valor definido no webhook da Meta)
 *   GEMINI_API_KEY          – Chave da API do Gemini (já usada no sistema)
 */

function getEnv(key) {
  try { return Netlify.env.get(key); } catch {}
  return process.env[key];
}

const VERIFY_TOKEN      = getEnv('WA_VERIFY_TOKEN');
const WA_PHONE_ID       = getEnv('WA_PHONE_NUMBER_ID');
const WA_TOKEN          = getEnv('WA_TOKEN');
const GEMINI_KEY        = getEnv('GEMINI_API_KEY');
const GEMINI_MODEL      = 'gemini-2.5-flash';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

// ── Prompt do sistema ──────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Você é o assistente virtual do escritório Souza Advocacia, do Dr. Marcus Vinicius Souza (OAB/RJ 250.430), em Rio de Janeiro.

Sua função é atender clientes que entram em contato pelo WhatsApp, responder dúvidas gerais sobre os serviços do escritório e orientar sobre agendamentos de consultas.

Áreas de atuação do escritório:
- Direito do Trabalho (reclamatórias, verbas rescisórias, assédio, etc.)
- Direito do Consumidor (bancos, planos de saúde, telecomunicações, plataformas digitais)
- Direito Previdenciário (BPC/LOAS, aposentadoria, benefícios por incapacidade)
- Direito Civil (contratos, responsabilidade civil, família, imóveis)
- Direito Tributário e Empresarial

Regras de conduta:
1. Seja sempre cordial, profissional e objetivo.
2. Nunca forneça pareceres jurídicos definitivos — apenas orientações gerais.
3. Para casos específicos, informe que o Dr. Marcus irá analisar e responder em breve.
4. Para agendamentos, informe que a equipe entrará em contato para confirmar data e horário. Solicite nome completo e assunto brevemente.
5. Responda em português, de forma clara e concisa (máximo 3 parágrafos).
6. Nunca invente informações sobre honorários, prazos processuais ou resultados garantidos.
7. Se a pergunta for completamente fora do contexto jurídico ou do escritório, responda com gentileza que não pode ajudar com esse assunto.

Exemplos de saudação inicial: "Olá! Bem-vindo ao Souza Advocacia. Em que posso ajudá-lo(a) hoje?"`;

// ── Chamar Gemini ──────────────────────────────────────────────────────────────
async function callGemini(userMessage) {
  const key = GEMINI_KEY;
  if (!key) throw new Error('GEMINI_API_KEY não configurada.');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const body = {
    system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: userMessage }] }],
    generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Gemini ${r.status}: ${err.slice(0, 200)}`);
  }

  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini não retornou texto.');
  return text.trim();
}

// ── Enviar mensagem pelo WhatsApp ──────────────────────────────────────────────
async function sendWhatsApp(to, text) {
  if (!WA_PHONE_ID || !WA_TOKEN) {
    console.error('[WA] WA_PHONE_NUMBER_ID ou WA_TOKEN não configurados.');
    return;
  }

  const url = `https://graph.facebook.com/v21.0/${WA_PHONE_ID}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  };

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${WA_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('[WA] Erro ao enviar mensagem:', r.status, err.slice(0, 300));
  } else {
    console.log('[WA] Mensagem enviada para', to);
  }
}

// ── Handler principal ──────────────────────────────────────────────────────────
export default async function handler(req) {

  // ── GET: verificação do webhook pela Meta ───────────────────────────────────
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const mode      = url.searchParams.get('hub.mode');
    const token     = url.searchParams.get('hub.verify_token');
    const challenge = url.searchParams.get('hub.challenge');

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('[WA] Webhook verificado com sucesso.');
      return new Response(challenge, { status: 200 });
    }
    return new Response('Token de verificação inválido.', { status: 403 });
  }

  // ── POST: mensagem recebida ─────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: 'JSON inválido.' }), { status: 400, headers: CORS });
    }

    // Responder 200 imediatamente para a Meta (obrigatório em <5s)
    // O processamento acontece em paralelo
    const entry = body?.entry?.[0];
    const change = entry?.changes?.[0];
    const msg = change?.value?.messages?.[0];

    // Ignorar qualquer coisa que não seja mensagem de texto
    if (!msg || msg.type !== 'text') {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
    }

    const from    = msg.from;           // número do remetente (ex: 5521999990000)
    const text    = msg.text?.body || '';
    const msgId   = msg.id;

    console.log(`[WA] Mensagem de ${from}: ${text.slice(0, 100)}`);

    // Processar de forma assíncrona para não bloquear o 200
    (async () => {
      try {
        const reply = await callGemini(text);
        await sendWhatsApp(from, reply);
      } catch (e) {
        console.error('[WA] Erro ao processar mensagem:', e.message);
        // Enviar mensagem de fallback para não deixar o cliente sem resposta
        try {
          await sendWhatsApp(from,
            'Olá! Recebemos sua mensagem. Nossa equipe entrará em contato em breve. Para urgências, ligue: (21) 98906-1652. — Souza Advocacia'
          );
        } catch {}
      }
    })();

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: CORS });
  }

  return new Response('Método não permitido.', { status: 405 });
}

export const config = { path: '/api/whatsapp' };
