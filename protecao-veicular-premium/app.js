const WHATSAPP_NUMBER = "5521995947016";

function normalizarPlaca(placa) {
  return String(placa || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function placaValida(placa) {
  const p = normalizarPlaca(placa);
  return /^[A-Z]{3}[0-9]{4}$/.test(p) || /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(p);
}

function montarLinkWhatsApp(mensagem) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(mensagem)}`;
}

function setWhatsAppLinks() {
  const mensagem = "Ola, quero atendimento sobre Protecao Veicular Premium com o Consultor Julio Beraka.";
  document.getElementById("whatsappTop").href = montarLinkWhatsApp(mensagem);
  document.getElementById("whatsappBottom").href = montarLinkWhatsApp(mensagem);
}

async function consultarVeiculo(placa) {
  const response = await fetch("/.netlify/functions/consultar-veiculo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placa, consentimento: true })
  });

  return response.json();
}

function formatarResultado(data, formData) {
  if (!data.success) {
    return `Nao foi possivel consultar a placa.\n\nErro: ${data.message || "Falha na consulta."}`;
  }

  const v = data.vehicle || {};
  const fipe = data.fipe || {};

  return [
    "Localizei os dados basicos do veiculo pela placa informada.",
    "",
    "Confirme se esta correto:",
    `Placa: ${v.plate || formData.placa}`,
    `Marca: ${v.brand || "Nao informado"}`,
    `Modelo: ${v.model || "Nao informado"}`,
    `Ano fabricacao: ${v.year_manufacture || "Nao informado"}`,
    `Ano modelo: ${v.year_model || "Nao informado"}`,
    `Cor: ${v.color || "Nao informado"}`,
    `Categoria: ${v.category || "Nao informado"}`,
    `Combustivel: ${v.fuel || "Nao informado"}`,
    `Valor FIPE aproximado: ${fipe.value || "A confirmar"}`,
    "",
    "Dados pessoais ou sigilosos nao foram exibidos."
  ].join("\n");
}

function montarMensagemWhatsApp(formData, resultado) {
  const v = resultado.vehicle || {};
  const fipe = resultado.fipe || {};

  return [
    "Ola, quero atendimento sobre Protecao Veicular Premium com o Consultor Julio Beraka.",
    "",
    `Nome: ${formData.nome}`,
    `Telefone: ${formData.telefone}`,
    `Cidade/Estado: ${formData.cidade}`,
    `E-mail: ${formData.email}`,
    `Forma de atendimento: ${formData.formaAtendimento}`,
    "",
    "Dados do veiculo:",
    `Placa: ${v.plate || formData.placa}`,
    `Marca: ${v.brand || "A confirmar"}`,
    `Modelo: ${v.model || "A confirmar"}`,
    `Ano fabricacao: ${v.year_manufacture || "A confirmar"}`,
    `Ano modelo: ${v.year_model || "A confirmar"}`,
    `Cor: ${v.color || "A confirmar"}`,
    `Valor FIPE: ${fipe.value || "A confirmar"}`,
    "",
    "Autorizo o atendimento e a analise inicial para cotacao de protecao veicular."
  ].join("\n");
}

window.addEventListener("DOMContentLoaded", () => {
  setWhatsAppLinks();

  const form = document.getElementById("leadForm");
  const resultadoEl = document.getElementById("resultado");
  const whatsappBottom = document.getElementById("whatsappBottom");
  const placaInput = document.getElementById("placa");

  placaInput.addEventListener("input", () => {
    placaInput.value = normalizarPlaca(placaInput.value);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const formData = Object.fromEntries(new FormData(form).entries());
    formData.placa = normalizarPlaca(formData.placa);

    resultadoEl.classList.remove("hidden");

    if (!placaValida(formData.placa)) {
      resultadoEl.textContent = "A placa informada parece estar em formato incorreto. Envie no formato ABC1234 ou ABC1D23.";
      return;
    }

    resultadoEl.textContent = "Consultando dados basicos do veiculo...";

    try {
      const consulta = await consultarVeiculo(formData.placa);
      resultadoEl.textContent = formatarResultado(consulta, formData);

      const mensagem = consulta.success
        ? montarMensagemWhatsApp(formData, consulta)
        : `Ola, quero atendimento com o Consultor Julio Beraka. Minha placa e ${formData.placa}, mas a consulta automatica nao foi concluida.`;

      whatsappBottom.href = montarLinkWhatsApp(mensagem);
    } catch (error) {
      resultadoEl.textContent = "Consulta indisponivel no momento. Voce pode continuar o atendimento pelo WhatsApp.";
      whatsappBottom.href = montarLinkWhatsApp(`Ola, quero atendimento com o Consultor Julio Beraka. Minha placa e ${formData.placa}.`);
    }
  });
});
