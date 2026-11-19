/**
 * Regras centrais de personalizacao de produtos.
 *
 * O menu.json guarda as opcoes permitidas como strings em
 * `personalizacoes_permitidas`. Este modulo e a UNICA fonte de verdade para:
 *  - classificacao das opcoes (remocao, ponto de cozimento, tempero);
 *  - validacao das personalizacoes contra as opcoes do produto;
 *  - conflitos entre opcoes (ex.: "sem gelo" + "com gelo");
 *  - sanitizacao e limite de observacoes livres.
 *
 * CartStore, guardrails de saida e interface consomem estas funcoes para que
 * nao existam criterios contraditorios de aceitacao/rejeicao.
 */

import { normalizeString } from '../cart/pricing.js';

export const DEFAULT_MAX_OBSERVATION_LENGTH = 140;
export const MAX_CUSTOMIZATION_LENGTH = 80;

const COOKING_POINTS = [
  'blue rare',
  'mal passado',
  'ao ponto para malpassada',
  'ao ponto para mal passada',
  'ao ponto',
  'ao ponto para bem-passada',
  'ao ponto para bem passada',
  'bem passado',
  'well done',
  'medium rare',
  'medium',
  'medium well',
  'rare'
];

const CONFLICT_PAIRS = [
  ['com gelo', 'sem gelo'],
  ['com acucar', 'sem acucar'],
  ['com açúcar', 'sem açúcar'],
  ['gelado', 'temperatura ambiente'],
  ['sem cebola', 'cebola extra'],
  ['sem pimenta', 'pimenta a parte'],
  ['sem batata palha', 'batata palha a parte'],
  ['sem alcaparras', 'molho de alcaparras']
];

/**
 * Detecta se uma opcao representa remocao de ingrediente.
 * Convencao do cardapio: inicia com "sem ".
 */
export function isIngredientRemoval(option) {
  return typeof option === 'string' && normalizeString(option).startsWith('sem ');
}

/**
 * Detecta se uma opcao representa ponto de cozimento.
 */
export function isCookingPoint(option) {
  if (typeof option !== 'string') return false;
  const norm = normalizeString(option);
  if (!norm) return false;
  return COOKING_POINTS.some(point => {
    const pointNorm = normalizeString(point);
    return norm === pointNorm || norm.includes(pointNorm);
  });
}

/**
 * Detecta se uma opcao e tempero/condimento/preferencia.
 */
export function isSeasoning(option) {
  return typeof option === 'string' && !isIngredientRemoval(option) && !isCookingPoint(option);
}

/**
 * Categoria logica de uma opcao, usada pela interface de personalizacao.
 * @returns {'removal'|'cookingPoint'|'seasoning'}
 */
export function getCustomizationGroup(option) {
  if (isIngredientRemoval(option)) return 'removal';
  if (isCookingPoint(option)) return 'cookingPoint';
  return 'seasoning';
}

/**
 * Agrupa as opcoes permitidas para renderizacao na interface.
 */
export function categorizeOptions(options = []) {
  const result = {
    removals: [],
    cookingPoints: [],
    seasonings: []
  };

  for (const opt of Array.isArray(options) ? options : []) {
    const group = getCustomizationGroup(opt);
    if (group === 'removal') result.removals.push(opt);
    else if (group === 'cookingPoint') result.cookingPoints.push(opt);
    else result.seasonings.push(opt);
  }

  return result;
}

function stripAccentsAndPunctuation(value) {
  return normalizeString(value).replace(/[.,;:!?]+$/g, '').trim();
}

/**
 * Verifica se duas opcoes validas sao contraditorias entre si.
 * Ex.: "sem cebola" e "cebola extra"; "com gelo" e "sem gelo".
 */
export function areCustomizationsConflicting(first, second) {
  const a = stripAccentsAndPunctuation(first);
  const b = stripAccentsAndPunctuation(second);
  if (!a || !b || a === b) return false;

  for (const [x, y] of CONFLICT_PAIRS) {
    const nx = stripAccentsAndPunctuation(x);
    const ny = stripAccentsAndPunctuation(y);
    if ((a === nx && b === ny) || (a === ny && b === nx)) return true;
  }

  const removeModifiers = value => value
    .replace(/^(sem|com|pouco|pouca|mais|extra)\s+/, '')
    .replace(/\s+(extra|a parte)$/, '')
    .trim();

  const aStem = removeModifiers(a);
  const bStem = removeModifiers(b);
  if (aStem && aStem === bStem) {
    const aHasModifier = /^(sem|com|pouco|pouca|mais|extra)\s+/.test(a) || /\s+(extra|a parte)$/.test(a);
    const bHasModifier = /^(sem|com|pouco|pouca|mais|extra)\s+/.test(b) || /\s+(extra|a parte)$/.test(b);
    if (aHasModifier || bHasModifier) return true;
  }

  return false;
}

/**
 * PROCURA UMA OPCAO PERMITIDA.
 * A igualdade normalizada (sem acentos/caixa) e o unico criterio. Isso evita
 * aceitar variacoes inventadas como "sem cebola extra" quando o cardapio
 * permite apenas "sem cebola".
 */
function findAllowedOption(allowed, requested) {
  const requestedNorm = normalizeString(requested);
  if (!requestedNorm) return null;

  return allowed.find(option => normalizeString(option) === requestedNorm) || null;
}

/**
 * Valida personalizacoes contra as opcoes efetivamente permitidas do produto.
 *
 * Regras:
 *  - somente strings nao vazias e dentro do limite;
 *  - a opcao precisa existir EXATAMENTE (sem acentos/caixa) em
 *    `personalizacoes_permitidas`;
 *  - apenas um ponto de cozimento por linha;
 *  - opcoes contraditorias sao rejeitadas;
 *  - duplicatas normalizadas sao ignoradas.
 *
 * @param {object} item Produto do cardapio
 * @param {string[]} requested Opcoes solicitadas
 * @returns {{
 *   validCustomizations: string[],
 *   rejectedCustomizations: any[],
 *   rejections: Array<{ value: any, reason: string }>
 * }}
 */
export function validateCustomizations(item, requested) {
  const allowed = Array.isArray(item?.personalizacoes_permitidas)
    ? item.personalizacoes_permitidas
    : [];
  const validCustomizations = [];
  const rejectedCustomizations = [];
  const rejections = [];

  const reject = (value, reason) => {
    rejectedCustomizations.push(value);
    rejections.push({ value, reason });
  };

  if (!Array.isArray(requested)) {
    if (requested !== undefined && requested !== null) {
      reject(requested, 'invalid_structure');
    }
    return { validCustomizations, rejectedCustomizations, rejections };
  }

  for (const rawOption of requested) {
    if (typeof rawOption !== 'string') {
      reject(rawOption, 'invalid_type');
      continue;
    }

    const option = rawOption.trim();
    if (!option) {
      reject(rawOption, 'empty');
      continue;
    }

    if (option.length > MAX_CUSTOMIZATION_LENGTH) {
      reject(option, 'too_long');
      continue;
    }

    const match = findAllowedOption(allowed, option);
    if (!match) {
      reject(option, 'not_allowed');
      continue;
    }

    const matchNorm = normalizeString(match);
    if (validCustomizations.some(valid => normalizeString(valid) === matchNorm)) {
      // Duplicata exata: nao e erro, apenas nao cria uma segunda entrada.
      continue;
    }

    if (isCookingPoint(match) && validCustomizations.some(valid => isCookingPoint(valid))) {
      reject(match, 'conflict_cooking_point');
      continue;
    }

    if (validCustomizations.some(valid => areCustomizationsConflicting(valid, match))) {
      reject(match, 'conflict');
      continue;
    }

    validCustomizations.push(match);
  }

  return { validCustomizations, rejectedCustomizations, rejections };
}

/**
 * Sanitiza uma observacao livre removendo caracteres de controle e tags
 * perigosas, aplicando o limite configurado.
 */
export function sanitizeObservation(text, maxLength = DEFAULT_MAX_OBSERVATION_LENGTH) {
  if (typeof text !== 'string') return '';

  const limit = Number.isFinite(Number(maxLength))
    ? Math.max(0, Math.floor(Number(maxLength)))
    : DEFAULT_MAX_OBSERVATION_LENGTH;

  return text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, limit);
}

/**
 * Valida e sanitiza uma observacao, informando se houve truncamento.
 */
export function validateObservation(text, maxLength = DEFAULT_MAX_OBSERVATION_LENGTH) {
  if (text === undefined || text === null || text === '') {
    return { valid: true, sanitized: '', truncated: false, message: '' };
  }

  if (typeof text !== 'string') {
    return {
      valid: false,
      sanitized: '',
      truncated: false,
      message: 'A observação deve ser um texto válido.'
    };
  }

  const limit = Number.isFinite(Number(maxLength))
    ? Math.max(0, Math.floor(Number(maxLength)))
    : DEFAULT_MAX_OBSERVATION_LENGTH;

  const cleaned = text
    .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
    .replace(/[<>]/g, '')
    .trim();

  const sanitized = cleaned.slice(0, limit);
  const truncated = cleaned.length > limit;

  return {
    valid: true,
    sanitized,
    truncated,
    message: truncated
      ? `A observação foi limitada a ${limit} caracteres.`
      : ''
  };
}
