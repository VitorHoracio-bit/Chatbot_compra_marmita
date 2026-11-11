/**
 * Guardrail de Entrada (Pre-LLM)
 * Sanitiza, normaliza, limita taxa e detecta ataques de Prompt Injection e Jailbreak.
 */

// Mapeamento de homoglifos cirilicos mais comuns para caracteres latinos
const HOMOGLYPHS = {
  '\u0430': 'a', '\u0410': 'A', // Cyrillic 'a'
  '\u0435': 'e', '\u0415': 'E', // Cyrillic 'e'
  '\u043E': 'o', '\u041E': 'O', // Cyrillic 'o'
  '\u0440': 'p', '\u0420': 'P', // Cyrillic 'p'
  '\u0441': 'c', '\u0421': 'C', // Cyrillic 'c'
  '\u0445': 'x', '\u0425': 'X', // Cyrillic 'x'
  '\u0443': 'y', '\u0423': 'Y', // Cyrillic 'y'
  '\u0456': 'i', '\u0406': 'I', // Cyrillic 'i'
  '\u0458': 'j', '\u0408': 'J'  // Cyrillic 'j'
};

/**
 * Normaliza o texto de entrada:
 * - Unicode NFKC
 * - Remove caracteres invisiveis / zero-width
 * - Substitui homoglifos conhecidos
 * - Remove caracteres de controle
 */
export function normalizeInput(text) {
  if (typeof text !== 'string') return '';

  // Normalizacao NFKC
  let clean = text.normalize('NFKC');

  // Remove caracteres invisiveis (zero-width spaces, joiners, direction overrides)
  clean = clean.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2060-\u206F]/g, '');

  // Substitui homoglifos
  clean = clean.replace(/[\u0400-\u04FF]/g, char => HOMOGLYPHS[char] || char);

  // Remove caracteres de controle ASCII e Unicode, exceto quebras de linha normais
  clean = clean.replace(/[\x00-\x09\x0B-\x1F\x7F-\x9F]/g, '');

  // Colapsa multiplos espacos consecutivos em um unico espaco
  clean = clean.replace(/\s+/g, ' ');

  return clean.trim();
}

/**
 * Gerenciador de Taxa de Mensagens (Rate Limiter)
 */
export class RateLimiter {
  constructor(maxPerMinute = 10) {
    this.maxPerMinute = maxPerMinute;
    this.timestamps = [];
  }

  isAllowed() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    this.timestamps = this.timestamps.filter(t => t > oneMinuteAgo);

    if (this.timestamps.length >= this.maxPerMinute) {
      const oldest = this.timestamps[0];
      const waitSeconds = Math.ceil((oldest + 60000 - now) / 1000);
      return { allowed: false, waitSeconds: Math.max(1, waitSeconds) };
    }

    this.timestamps.push(now);
    return { allowed: true, waitSeconds: 0 };
  }

  reset() {
    this.timestamps = [];
  }
}

/**
 * Regex para deteccao de injecao de prompt, jailbreaks, personificacao,
 * tentativas de extracao do prompt e delimitadores falsos (PT-BR e EN).
 */
const INJECTION_PATTERNS = [
  // 1. Ignorar instrucoes
  /ignore\s+(todas\s+as|as|minhas|suas)?\s*(instru[çc][õo]es|regras|diretrizes|mensagens)/i,
  /ignore\s+(all\s+)?(previous|prior|system|above)\s*(instructions|rules|prompts|guidelines)/i,
  /esque[çc]a\s+(todas\s+as|as|suas)?\s*(instru[çc][õo]es|regras)/i,
  /forget\s+(all\s+)?(previous|prior)\s*(instructions|rules)/i,
  /desconsidere\s+(as|suas|quaisquer)?\s*(instru[çc][õo]es|regras)/i,
  /disregard\s+(all\s+)?(previous|prior)?\s*instructions/i,

  // 2. Jailbreak / DAN / Modo desenvolvedor / Role-play
  /\bDAN\b/i,
  /\bdo\s+anything\s+now\b/i,
  /modo\s+(desenvolvedor|developer|god|admin|root|ilimitado)/i,
  /developer\s+mode/i,
  /jailbreak/i,
  /(voc[êe]|vc)\s+(agora\s+)?([eé]|eh|ser[áa]|atue\s+como|finja\s+ser)\s+/i,
  /you\s+are\s+(now\s+)?(a|an)?\s*(unrestricted|jailbroken|developer|admin)/i,
  /act\s+as\s+(an?\s+unrestricted|someone\s+else)/i,
  /pretend\s+(you\s+are|to\s+be)\s+/i,

  // 3. Extracao de prompt e vazamento de regras
  /(mostre|exiba|revele|imprima|copie|repita|diga|qual\s+[eé]|leia)\s+.*(prompt|instru[çc][õo]es\s+do\s+sistema|system\s+prompt|regras\s+internas)/i,
  /(show|display|reveal|print|repeat|output|what\s+is)\s+.*(system\s+prompt|original\s+prompt|hidden\s+instructions)/i,
  /repita\s+(o\s+texto|tudo|as\s+palavras)\s+(acima|anterior)/i,
  /repeat\s+(the\s+text|everything|the\s+words)\s+(above|prior)/i,

  // 4. Delimitadores falsos de sistema e markup
  /<\/?\s*(system|user_data|instruction|context|admin|developer|prompt|assistant)\s*>/i,
  /\[\s*(SYSTEM|INSTRUCTION|ADMIN|DEVELOPER|ASSISTANT|PROMPT)\s*\]/i,
  /^(System|Assistant|Developer):\s*/im,

  // 5. Tentativas diretas de manipular precos / autoridade falsa
  /(sou|eu\s+sou)\s+(o\s+)?(dono|gerente|propriet[áa]rio|desenvolvedor|criador|chefe)/i,
  /coloque\s+(o\s+)?pre[çc]o\s+(como\s+|em\s+)?(zero|0|gr[áa]tis)/i,
  /mude\s+(o\s+)?(pre[çc]o|valor)\s+para/i,
  /(fa[çc]a|cobre)\s+(de\s+gra[çc]a|0\s+reais|tudo\s+gr[áa]tis)/i,
  /aplique\s+um\s+desconto\s+de\s+100%/i,

  // 6. Scripts e injecoes tecnicas
  /<script\b/i,
  /javascript:/i,
  /eval\s*\(/i,
  /base64\s+decode/i,
  /rot13/i
];

/**
 * Verifica se a entrada contem padroes de injecao ou jailbreak.
 * @param {string} text
 * @returns {boolean}
 */
export function detectPromptInjection(text) {
  if (!text || typeof text !== 'string') return false;
  const clean = normalizeInput(text);

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(clean)) {
      return true;
    }
  }

  // Verifica possiveis sequencias base64 suspeitas longas (> 40 chars com padding ou charset)
  const base64Match = clean.match(/\b([A-Za-z0-9+/]{40,}={0,2})\b/);
  if (base64Match) {
    try {
      if (typeof atob === 'function') {
        const decoded = atob(base64Match[1]);
        if (INJECTION_PATTERNS.some(p => p.test(decoded))) {
          return true;
        }
      }
    } catch (_) {
      // Ignora falhas de atob
    }
  }

  return false;
}

/**
 * Valida a entrada do usuario segundo os guardrails pre-LLM.
 * @param {string} rawText Texto bruto recebido do usuario
 * @param {RateLimiter} rateLimiter Instancia do rate limiter
 * @param {object} config Configuracoes de limites
 * @returns {{ valid: boolean, reason?: string, sanitizedText: string, userMessage?: string }}
 */
export function validateUserInput(rawText, rateLimiter = null, config = null) {
  const sanitizedText = normalizeInput(rawText);
  const maxLength = config?.limits?.max_input_length ?? 300;

  // 1. Checagem de texto vazio
  if (!sanitizedText) {
    return {
      valid: false,
      reason: 'empty',
      sanitizedText: '',
      userMessage: 'Por favor, digite sua mensagem ou escolha uma opção do cardápio.'
    };
  }

  // 2. Checagem de taxa (Rate Limiting)
  if (rateLimiter) {
    const rateCheck = rateLimiter.isAllowed();
    if (!rateCheck.allowed) {
      return {
        valid: false,
        reason: 'rate_limit',
        sanitizedText,
        userMessage: `Você está enviando mensagens muito rápido. Por favor, aguarde ${rateCheck.waitSeconds} segundo(s) antes de enviar novamente.`
      };
    }
  }

  // 3. Checagem de tamanho maximo
  if (sanitizedText.length > maxLength) {
    return {
      valid: false,
      reason: 'length_exceeded',
      sanitizedText: sanitizedText.slice(0, maxLength),
      userMessage: `Sua mensagem é muito longa. Por favor, seja mais breve (limite de ${maxLength} caracteres).`
    };
  }

  // 4. Deteccao de Prompt Injection e Jailbreak
  if (detectPromptInjection(sanitizedText)) {
    return {
      valid: false,
      reason: 'injection_detected',
      sanitizedText,
      userMessage: 'Desculpe, só posso ajudar com pedidos e dúvidas sobre o cardápio do nosso restaurante! Como posso montar sua marmita hoje?'
    };
  }

  return {
    valid: true,
    sanitizedText
  };
}
