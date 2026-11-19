/**
 * Guardrail e Sanitizador de Saída
 * Valida a integridade da intenção, itens e mensagens do motor de diálogo,
 * impedindo termos indevidos, vazamentos e garantindo coerência de dados com o cardápio.
 */

import { normalizeString } from '../cart/pricing.js';
import { validateCustomizations, validateObservation } from '../utils/customizationHelper.js';

// Lista de intenções válidas e suportadas
export const VALID_INTENTS = [
  'listar_cardapio',
  'adicionar_item',
  'remover_item',
  'alterar_item',
  'ver_carrinho',
  'definir_entrega',
  'confirmar_pedido',
  'cancelar_pedido',
  'tirar_duvida',
  'fora_de_escopo',
  'esclarecer_ambiguidade'
];

// Frases e termos críticos de injeção ou vazamento que nunca devem vazar para o usuário
const PROMPT_LEAK_PHRASES = [
  'dado nao confiavel',
  'dado não confiável',
  'fonte da verdade',
  'guardrail',
  'guardrails',
  'system prompt',
  'regras deterministicas',
  'regras determinísticas',
  'você é um agente de vendas de marmitas',
  'voce e um agente de vendas de marmitas',
  'nunca calcular preco',
  'nunca calcule preço',
  'tool calling',
  'schema json',
  '<user_data>',
  '</user_data>',
  'user_data'
];

/**
 * Detecta se a mensagem gerada contém trechos internos de prompt ou termos de vazamento.
 * @param {string} text
 * @returns {boolean}
 */
export function detectPromptLeakage(text) {
  if (typeof text !== 'string') return false;
  const norm = normalizeString(text);
  return PROMPT_LEAK_PHRASES.some(phrase => norm.includes(normalizeString(phrase)));
}

/**
 * Detecta promessas não autorizadas de descontos, gratuidade ou promoções inventadas.
 * @param {string} text
 * @returns {boolean}
 */
export function detectUnauthorizedOffers(text) {
  if (typeof text !== 'string') return false;
  const norm = normalizeString(text);
  const forbidden = [
    'desconto de', 'cupom de', 'sai de graca', 'sai de graça', 'de graca', 'de graça',
    'sem pagar nada', 'preco zero', 'preço zero', 'cortesia por minha conta',
    'vou te dar um desconto', 'te dou de graca', 'te dou de graça'
  ];
  return forbidden.some(term => norm.includes(normalizeString(term)));
}

/**
 * Detecta respostas fora de escopo (geração de código, aconselhamento médico, etc.)
 * @param {string} text
 * @returns {boolean}
 */
export function detectOutOfScopeResponse(text) {
  if (typeof text !== 'string') return false;
  const norm = normalizeString(text);
  const outOfScopePatterns = [
    /```(python|javascript|bash|sh|php|java|c|cpp|sql|html)/i,
    /\bdef\s+[a-zA-Z_]\w*\s*\(/i,
    /\bfunction\s+[a-zA-Z_]\w*\s*\(/i,
    /\bimport\s+[a-zA-Z_]/i,
    /remédio|remedio|tarja preta|prescrição|prescricao|posologia|diagnóstico|diagnostico médico/,
    /eleição|eleicao|voto|partido político|candidato a presidente/
  ];
  return outOfScopePatterns.some(pattern => pattern.test(norm) || pattern.test(text));
}

/**
 * Validador de formato de objeto de diálogo.
 * @param {string|object} output
 * @returns {{ valid: boolean, parsed?: object, reason?: string }}
 */
export function validateLLMJsonSchema(output) {
  let obj = output;
  if (typeof output === 'string') {
    try {
      obj = JSON.parse(output);
    } catch (_) {
      return { valid: false, reason: 'json_parse_error' };
    }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { valid: false, reason: 'not_an_object' };
  }

  if (!obj.intent || !VALID_INTENTS.includes(obj.intent)) {
    return { valid: false, reason: 'invalid_intent' };
  }

  if (obj.items !== undefined && !Array.isArray(obj.items)) {
    return { valid: false, reason: 'items_not_array' };
  }

  return { valid: true, parsed: obj };
}

/**
 * Valida e sanitiza o objeto de resposta gerado pelo motor de diálogo.
 * @param {object} rawOutput
 * @param {object} cartStore
 * @returns {{ output: object, sanitizedMessage: string, safe: boolean, reason?: string }}
 */
export function validateAndSanitizeOutput(rawOutput, cartStore) {
  if (!rawOutput || typeof rawOutput !== 'object') {
    return {
      output: { intent: 'tirar_duvida', mensagem_ao_usuario: 'Como posso te ajudar hoje?' },
      sanitizedMessage: 'Como posso te ajudar hoje?',
      safe: false,
      reason: 'Resposta nula ou inválida.'
    };
  }

  const schemaCheck = validateLLMJsonSchema(rawOutput);
  let intent = schemaCheck.valid ? rawOutput.intent : 'tirar_duvida';

  let message = typeof rawOutput.mensagem_ao_usuario === 'string'
    ? rawOutput.mensagem_ao_usuario.trim()
    : 'Como posso te ajudar com o seu pedido?';

  // Sanitiza remoção de tags de injeção ou HTML acidental
  message = message.replace(/<[^>]*>/g, '').trim();

  // Verifica vazamentos de prompt
  if (detectPromptLeakage(message)) {
    return {
      output: { intent: 'tirar_duvida', mensagem_ao_usuario: 'Como posso te ajudar com seu pedido hoje?' },
      sanitizedMessage: 'Como posso te ajudar com seu pedido hoje?',
      safe: false,
      reason: 'prompt_leak_detected'
    };
  }

  // Verifica ofertas não autorizadas
  if (detectUnauthorizedOffers(message)) {
    return {
      output: { intent: 'tirar_duvida', mensagem_ao_usuario: 'Consulte os preços oficiais no nosso cardápio.' },
      sanitizedMessage: 'Consulte os preços oficiais no nosso cardápio.',
      safe: false,
      reason: 'unauthorized_offer_detected'
    };
  }

  // Verifica saídas fora de escopo
  if (detectOutOfScopeResponse(message)) {
    return {
      output: { intent: 'fora_de_escopo', mensagem_ao_usuario: 'Só posso atender pedidos da Marmitaria.' },
      sanitizedMessage: 'Só posso atender pedidos da Marmitaria.',
      safe: false,
      reason: 'out_of_scope_detected'
    };
  }

  // Validação dos itens referenciados na ação
  const sanitizedItems = [];
  if (Array.isArray(rawOutput.items) && cartStore) {
    for (const item of rawOutput.items) {
      if (!item || typeof item.id !== 'string') continue;

      const menuItem = typeof cartStore.getItemById === 'function'
        ? cartStore.getItemById(item.id)
        : cartStore.findMenuItem(item.id);

      if (!menuItem) continue;

      let qtd = parseInt(item.quantidade, 10);
      if (isNaN(qtd) || qtd < 1) qtd = 1;

      // Filtra personalizacoes permitidas usando a mesma regra central do
      // CartStore (normalizacao de acentos/caixa e conflitos).
      const { validCustomizations } = validateCustomizations(menuItem, item.personalizacoes);

      // Sanitiza observação com a mesma regra central e limite configurado.
      const obsLimit = cartStore?.configData?.limits?.max_obs_length ?? 140;
      const obsValidation = validateObservation(item.observacoes, obsLimit);
      const obs = obsValidation.sanitized;

      sanitizedItems.push({
        id: menuItem.id,
        nome: menuItem.nome,
        preco_unitario: menuItem.preco_unitario,
        quantidade: qtd,
        personalizacoes: validCustomizations,
        observacoes: obs
      });
    }
  }

  return {
    output: {
      intent,
      items: sanitizedItems,
      delivery: rawOutput.delivery,
      termo_ambiguo: rawOutput.termo_ambiguo,
      mensagem_ao_usuario: message
    },
    sanitizedMessage: message,
    safe: true
  };
}

// Alias para compatibilidade com suítes de teste legadas
export const validateAndSanitizeLLMOutput = validateAndSanitizeOutput;
