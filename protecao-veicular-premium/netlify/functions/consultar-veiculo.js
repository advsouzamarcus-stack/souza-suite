function normalizarPlaca(placa) {
  return String(placa || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function placaValida(placa) {
  const p = normalizarPlaca(placa);
  return /^[A-Z]{3}[0-9]{4}$/.test(p) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p);
}

function resposta(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(body)
  };
}

function filtrarDadosSensiveis(dados) {
  return {
    plate: dados.placa || dados.plate || null,
    brand: dados.marca || dados.brand || null,
    model: dados.modelo || dados.model || null,
    year_manufacture: dados.anoFabricacao || dados.year_manufacture || null,
    year_model: dados.anoModelo || dados.year_model || null,
    color: dados.cor || dados.color || null,
    category: dados.categoria || dados.category || null,
    vehicle_type: dados.tipoVeiculo || dados.especie || dados.vehicle_type || null,
    fuel: dados.combustivel || dados.fuel || null,
    city: dados.municipio || dados.city || null,
    state: dados.uf || dados.state || null,
    situacao_basica: dados.situacaoBasica || dados.situacao_basica || null,
    restricoes_publicas: dados.restricoesPublicas || dados.restricoes_publicas || null
  };
}

async function consultarSerproSenatran(placa) {
  const baseUrl = process.env.SERPRO_BASE_URL;
  const token = process.env.SERPRO_ACCESS_TOKEN;

  if (!baseUrl || !token) {
    throw new Error("SERPRO_NOT_CONFIGURED");
  }

  // Ajuste o endpoint abaixo conforme a documentacao oficial contratada no SERPRO/SENATRAN.
  const endpoint = `${baseUrl.replace(/\/$/, "")}/veiculos/placa/${placa}`;

  const response = await fetch(endpoint, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/json"
    }
  });

  if (!response.ok) {
    throw new Error("SENATRAN_UNAVAILABLE");
  }

  return response.json();
}

async function consultarFipe(vehicle) {
  // A consulta FIPE depende da correspondencia entre marca, modelo, ano e versao.
  // Esta funcao esta pronta para ser conectada a BrasilAPI, API FIPE ou provedor contratado.
  // Quando houver multiplas versoes, retorne MULTIPLE_FIPE_VERSIONS para o assistente pedir confirmacao.
  return {
    code: null,
    value: null,
    reference_month: null,
    version_confirmed: false,
    warning: "FIPE_MATCH_REQUIRED"
  };
}

exports.handler = async function(event) {
  if (event.httpMethod === "OPTIONS") {
    return resposta(200, { success: true });
  }

  if (event.httpMethod !== "POST") {
    return resposta(405, {
      success: false,
      error: "METHOD_NOT_ALLOWED",
      message: "Use POST."
    });
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const placa = normalizarPlaca(body.placa);
    const consentimento = body.consentimento === true;

    if (!consentimento) {
      return resposta(403, {
        success: false,
        error: "CONSENT_REQUIRED",
        message: "E necessario consentimento do cliente antes da consulta."
      });
    }

    if (!placaValida(placa)) {
      return resposta(400, {
        success: false,
        error: "INVALID_PLATE",
        message: "Placa em formato invalido."
      });
    }

    const dadosSerpro = await consultarSerproSenatran(placa);
    const vehicle = filtrarDadosSensiveis(dadosSerpro);
    const fipe = await consultarFipe(vehicle);

    return resposta(200, {
      success: true,
      source: "SERPRO/SENATRAN + FIPE",
      vehicle,
      fipe,
      privacy: {
        sensitive_data_removed: true
      }
    });
  } catch (error) {
    if (error.message === "SERPRO_NOT_CONFIGURED") {
      return resposta(500, {
        success: false,
        error: "SERPRO_NOT_CONFIGURED",
        message: "Credenciais SERPRO/SENATRAN nao configuradas."
      });
    }

    if (error.message === "SENATRAN_UNAVAILABLE") {
      return resposta(503, {
        success: false,
        error: "SENATRAN_UNAVAILABLE",
        message: "Consulta veicular indisponivel no momento."
      });
    }

    return resposta(500, {
      success: false,
      error: "INTERNAL_ERROR",
      message: "Erro interno ao consultar veiculo."
    });
  }
};
