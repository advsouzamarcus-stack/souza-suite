# Protecao Veicular Premium - Consultor Julio Beraka

Modulo de assistente virtual para atendimento de protecao veicular, com botao de WhatsApp, fluxo de consentimento, validacao de placa, consulta veicular por backend seguro e integracao preparada para SERPRO/SENATRAN e FIPE.

## WhatsApp de atendimento

+55 21 99594-7016

## Objetivo

Permitir que o cliente envie a placa do veiculo, autorize a consulta e receba confirmacao dos dados basicos do automovel para cotacao, analise de protecao veicular e agendamento com o Consultor Julio Beraka.

## Fluxo

1. Cliente acessa a pagina ou chatbot.
2. Assistente informa que o atendimento e gratuito e 24h.
3. Cliente informa dados basicos.
4. Cliente envia a placa.
5. Sistema solicita consentimento para consulta.
6. Backend valida e normaliza a placa.
7. Backend consulta SERPRO/SENATRAN.
8. Backend remove dados sensiveis.
9. Backend consulta FIPE.
10. Assistente confirma os dados com o cliente.
11. Cliente e direcionado para WhatsApp ou agendamento com Julio Beraka.

## Seguranca

- Nunca expor credenciais SERPRO no front-end.
- Usar variaveis de ambiente.
- Filtrar dados sensiveis no backend.
- Nao exibir nome do proprietario, CPF, endereco, RENAVAM completo ou chassi completo.
- Usar a finalidade apenas para atendimento, cotacao e analise de protecao veicular.

## Variaveis de ambiente necessarias

SERPRO_BASE_URL=
SERPRO_ACCESS_TOKEN=
FIPE_PROVIDER=brasilapi
WHATSAPP_NUMBER=5521995947016
