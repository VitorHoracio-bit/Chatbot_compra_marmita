/**
 * Modulo de calculo e precificacao deterministica.
 * Todos os calculos monetarios sao realizados em centavos (inteiros) para evitar
 * problemas de arredondamento de ponto flutuante.
 */

const currencyFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL'
});

/**
 * Formata um valor em centavos para a representacao em Reais (R$ 0,00).
 * @param {number} cents Valor inteiro em centavos.
 * @returns {string} String formatada em moeda brasileira.
 */
export function formatCurrency(cents) {
  if (typeof cents !== 'number' || isNaN(cents)) {
    return 'R$ 0,00';
  }
  return currencyFormatter.format(cents / 100);
}

/**
 * Normaliza strings para comparacao sem acentos e em minusculo.
 * @param {string} str
 * @returns {string}
 */
export function normalizeString(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Calcula o subtotal do carrinho.
 * @param {Array<{preco_unitario: number, quantidade: number}>} items
 * @returns {number} Subtotal em centavos (inteiro).
 */
export function calculateSubtotal(items) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((acc, item) => {
    const unitPrice = Math.max(0, Math.round(Number(item.preco_unitario) || 0));
    const qty = Math.max(0, Math.floor(Number(item.quantidade) || 0));
    return acc + unitPrice * qty;
  }, 0);
}

/**
 * Calcula a taxa de entrega baseada no subtotal e bairro/regiao.
 * @param {number} subtotalCents Subtotal atual em centavos.
 * @param {string} neighborhood Nome ou termo do bairro informado.
 * @param {object} config Objeto de configuracao contendo regras de frete.
 * @returns {{ fee: number, isFree: boolean, neighborhoodName: string }}
 */
export function calculateDeliveryFee(subtotalCents, neighborhood, config) {
  const deliveryConfig = config?.delivery || {
    default_fee: 700,
    free_delivery_threshold: 6000,
    neighborhoods: []
  };

  const freeThreshold = deliveryConfig.free_delivery_threshold ?? 6000;
  const isFree = subtotalCents >= freeThreshold && freeThreshold > 0;

  if (isFree) {
    return {
      fee: 0,
      isFree: true,
      neighborhoodName: neighborhood ? neighborhood.trim() : 'Padrão'
    };
  }

  if (!neighborhood || typeof neighborhood !== 'string') {
    return {
      fee: deliveryConfig.default_fee ?? 700,
      isFree: false,
      neighborhoodName: 'Padrão'
    };
  }

  const normalizedInput = normalizeString(neighborhood);
  const neighborhoods = deliveryConfig.neighborhoods || [];

  for (const item of neighborhoods) {
    const itemNorm = normalizeString(item.name);
    if (normalizedInput === itemNorm || normalizedInput.includes(itemNorm)) {
      return {
        fee: item.fee,
        isFree: false,
        neighborhoodName: item.name
      };
    }
    if (Array.isArray(item.aliases)) {
      for (const alias of item.aliases) {
        const aliasNorm = normalizeString(alias);
        if (normalizedInput === aliasNorm || normalizedInput.includes(aliasNorm)) {
          return {
            fee: item.fee,
            isFree: false,
            neighborhoodName: item.name
          };
        }
      }
    }
  }

  return {
    fee: deliveryConfig.default_fee ?? 700,
    isFree: false,
    neighborhoodName: neighborhood.trim()
  };
}

/**
 * Calcula o total final da compra.
 * @param {number} subtotalCents Subtotal em centavos.
 * @param {number} deliveryFeeCents Taxa de entrega em centavos.
 * @returns {number} Total em centavos.
 */
export function calculateOrderTotal(subtotalCents, deliveryFeeCents) {
  const safeSubtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
  const safeDelivery = Math.max(0, Math.round(Number(deliveryFeeCents) || 0));
  return safeSubtotal + safeDelivery;
}

/**
 * Retorna quantos centavos faltam para obter frete gratis.
 * @param {number} subtotalCents
 * @param {object} config
 * @returns {number} Centavos faltantes (0 se ja alcancou).
 */
export function remainingForFreeDelivery(subtotalCents, config) {
  const threshold = config?.delivery?.free_delivery_threshold ?? 6000;
  if (!threshold) return 0;
  const remaining = threshold - subtotalCents;
  return remaining > 0 ? remaining : 0;
}
