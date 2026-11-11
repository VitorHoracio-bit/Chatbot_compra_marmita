/**
 * Guardrail de Saida (Pos-LLM)
 * Valida a resposta do LLM, rejeita schemas invalidos, verifica coerencia de precos,
 * previne vazamento do system prompt e assegura limites de negocio.
 */

import { normalizeString } from '../cart/pricing.js';

// Lista de intencoes permitidas pelo agente
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

// Frases e termos criticos do system prompt que nunca devem vazar para o usuario
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
 * Detecta se a mensagem gerada contem trechos internos do prompt do sistema.
 * @param {string} text
 * @returns {boolean}
 */
export function detectPromptLeakage(text) {
  if (!text || typeof text !== 'string') return false;
  const norm = normalizeString(text);
  for (const phrase of PROMPT_LEAK_PHRASES) {
    if (norm.includes(normalizeString(phrase))) {
      return true;
    }
  }
  return false;
}

/**
 * Detecta se a resposta do modelo tenta oferecer descontos, precos zerados ou beneficios nao autorizados.
 * @param {string} text
 * @returns {boolean}
 */
export function detectUnauthorizedOffers(text) {
  if (!text || typeof text !== 'string') return false;
  const patterns = [
    /desconto\s+(especial|de\s+\d+|exclusivo|cortesia)/i,
    /sai(u)?\s+(de\s+gra[çc]a|gr[áa]tis|0\s+reais)/i,
    /sem\s+custo\s+algum/i,
    /pre[çc]o\s+zerado/i,
    /cupom\s+aplicado/i,
    /promo[çc][ãa]o\s+secreta/i
  ];
  return patterns.some(p => p.test(text));
}

/**
 * Detecta se a mensagem do LLM respondeu a questoes fora do escopo do restaurante
 * (ex.: gerou codigo, conselhos medicos/juridicos, opiniao politica).
 * @param {string} text
 * @returns {boolean}
 */
export function detectOutOfScopeResponse(text) {
  if (!text || typeof text !== 'string') return false;
  const patterns = [
    /```(python|javascript|js|ts|html|css|bash|sh|c|cpp|sql)/i,
    /function\s+\w+\(/i,
    /def\s+\w+\(/i,
    /const\s+\w+\s*=/i,
    /partido\s+pol[íi]tico|elei[çc][õo]es|candidato/i,
    /diagn[óo]stico\s+m[ée]dico|receita\s+m[ée]dica|rem[ée]dio\s+tarja/i
  ];
  return patterns.some(p => p.test(text));
}

/**
 * Valida a estrutura JSON bruta retornada pelo LLM.
 * Rejeita campos nao permitidos e valida tipos basicos.
 * @param {any} rawOutput
 * @returns {{ valid: boolean, parsed?: object, error?: string }}
 */
export function validateLLMJsonSchema(rawOutput) {
  let parsed = rawOutput;

  if (typeof rawOutput === 'string') {
    try {
      // Tenta remover delimitadores de markdown caso o LLM os envie
      const cleaned = rawOutput
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return {
        valid: false,
        error: `JSON malformado retornado pelo LLM: ${e.message}`
      };
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'A saída do LLM deve ser um objeto JSON no nível raiz.'
    };
  }

  // Valida campo 'intent'
  if (!parsed.intent || typeof parsed.intent !== 'string') {
    return {
      valid: false,
      error: 'Campo "intent" é obrigatório e deve ser uma string.'
    };
  }

  if (!VALID_INTENTS.includes(parsed.intent)) {
    return {
      valid: false,
      error: `Intenção desconhecida: "${parsed.intent}". Permitidas: ${VALID_INTENTS.join(', ')}`
    };
  }

  // Valida campo 'items' se presente
  if (parsed.items !== undefined) {
    if (!Array.isArray(parsed.items)) {
      return {
        valid: false,
        error: 'Campo "items" deve ser um array.'
      };
    }

    for (let i = 0; i < parsed.items.length; i++) {
      const it = parsed.items[i];
      if (!it || typeof it !== 'object') {
        return { valid: false, error: `Item no índice ${i} deve ser um objeto.` };
      }
      if (!it.id || typeof it.id !== 'string') {
        return { valid: false, error: `Item no índice ${i} deve ter "id" em formato string.` };
      }
      if (it.quantidade !== undefined && (typeof it.quantidade !== 'number' || it.quantidade <= 0)) {
        return { valid: false, error: `Item "${it.id}" tem quantidade inválida: ${it.quantidade}` };
      }
      if (it.personalizacoes !== undefined && !Array.isArray(it.personalizacoes)) {
        return { valid: false, error: `Item "${it.id}" tem campo "personalizacoes" não-array.` };
      }
    }
  }

  // Valida campo 'delivery' se presente
  if (parsed.delivery !== undefined && (typeof parsed.delivery !== 'object' || parsed.delivery === null)) {
    return {
      valid: false,
      error: 'Campo "delivery" deve ser um objeto.'
    };
  }

  // Valida campo 'mensagem_ao_usuario'
  if (parsed.mensagem_ao_usuario !== undefined && typeof parsed.mensagem_ao_usuario !== 'string') {
    return {
      valid: false,
      error: 'Campo "mensagem_ao_usuario" deve ser uma string.'
    };
  }

  return {
    valid: true,
    parsed
  };
}

/**
 * Valida a saida completa do LLM aplicando todas as camadas do Guardrail de Saida.
 * Se houver violacao, descarta o texto livre do LLM e aplica resposta de fallback segura.
 * @param {any} rawOutput
 * @param {object} cartStore Instancia da loja para validacao de regras deterministica
 * @returns {{ safe: boolean, output: object, sanitizedMessage: string, reason?: string }}
 */
export function validateAndSanitizeLLMOutput(rawOutput, cartStore) {
  const schemaResult = validateLLMJsonSchema(rawOutput);
  if (!schemaResult.valid) {
    return {
      safe: false,
      output: { intent: 'fora_de_escopo' },
      sanitizedMessage: 'Desculpe, tive uma oscilação na resposta. Pode repetir seu pedido ou escolher uma das opções?',
      reason: schemaResult.error
    };
  }

  const data = schemaResult.parsed;
  let userMsg = data.mensagem_ao_usuario || '';

  // 1. Deteccao de vazamento do prompt do sistema
  if (detectPromptLeakage(userMsg)) {
    return {
      safe: false,
      output: { intent: 'fora_de_escopo' },
      sanitizedMessage: 'Olá! Sou o atendente virtual da Marmitaria Sabor de Casa. Como posso ajudar com o seu pedido hoje?',
      reason: 'prompt_leakage_detected'
    };
  }

  // 2. Deteccao de promessas de precos/descontos nao autorizados pelo LLM
  if (detectUnauthorizedOffers(userMsg)) {
    return {
      safe: false,
      output: { intent: data.intent, items: data.items, delivery: data.delivery },
      sanitizedMessage: 'Aqui na Marmitaria nossos preços e condições seguem estritamente nossa tabela oficial. Como gostaria de prosseguir?',
      reason: 'unauthorized_pricing_claim'
    };
  }

  // 3. Deteccao de resposta fora de escopo (codigo, polui, etc.)
  if (detectOutOfScopeResponse(userMsg) || data.intent === 'fora_de_escopo') {
    return {
      safe: true,
      output: { intent: 'fora_de_escopo' },
      sanitizedMessage: 'Meu foco é somente ajudar você a escolher as melhores marmitas e acompanhar seu pedido! Deseja ver o cardápio de hoje?',
      reason: 'out_of_scope'
    };
  }

  // 4. Verificacao de IDs de itens e disponibilidade
  if (Array.isArray(data.items) && cartStore) {
    for (const it of data.items) {
      const found = cartStore.findMenuItem(it.id);
      if (!found) {
        // Se o LLM alucinou um ID, corrige ou avisa
        return {
          safe: true,
          output: { ...data, items: [] },
          sanitizedMessage: `O prato "${it.id}" não consta em nosso cardápio. Gostaria de ver as opções disponíveis hoje?`,
          reason: 'hallucinated_item_id'
        };
      }
    }
  }

  return {
    safe: true,
    output: data,
    sanitizedMessage: userMsg
  };
}
