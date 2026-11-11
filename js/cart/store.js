/**
 * Modulo de gerenciamento de estado do carrinho (Single Source of Truth).
 * Toda a validacao de regras de negocio ocorre de forma deterministica aqui.
 */

import {
  calculateSubtotal,
  calculateDeliveryFee,
  calculateOrderTotal,
  formatCurrency,
  normalizeString
} from './pricing.js';

export class CartStore {
  /**
   * @param {object} menuData Dados carregados do menu.json
   * @param {object} configData Dados carregados do config.json
   * @param {string} [currentDay] Dia da semana opcional ('segunda', 'terca', etc.)
   */
  constructor(menuData, configData, currentDay = null) {
    this.menuData = menuData || { itens: [], cardapio_por_dia: {} };
    this.configData = configData || {};
    this.currentDay = currentDay || this.detectToday();

    this.items = []; // Array<{ id, nome, preco_unitario, quantidade, personalizacoes, observacoes, line_key }>
    this.delivery = {
      bairro: null,
      endereco: null,
      taxa: this.configData?.delivery?.default_fee ?? 700,
      isFree: false,
      bairroDetectado: null
    };
    this.status = 'montando'; // 'montando' | 'aguardando_endereco' | 'aguardando_confirmacao' | 'confirmado' | 'cancelado'
    this.listeners = new Set();

    // Carrega itens disponiveis para o dia selecionado
    this.updateDailyAvailability();
  }

  detectToday() {
    const days = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const todayIndex = new Date().getDay();
    return days[todayIndex];
  }

  setDay(dayName) {
    const norm = normalizeString(dayName);
    const validDays = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    if (validDays.includes(norm)) {
      this.currentDay = norm;
      this.updateDailyAvailability();
      this.notify();
    }
  }

  updateDailyAvailability() {
    const dayMenuIds = this.menuData.cardapio_por_dia?.[this.currentDay] || [];
    this.availableItems = this.menuData.itens.map(item => {
      const isAvailableDay = dayMenuIds.length > 0 ? dayMenuIds.includes(item.id) : item.disponivel_hoje;
      return {
        ...item,
        disponivel_hoje: isAvailableDay
      };
    });
  }

  /**
   * Busca item no cardapio pelo ID ou nome aproximado.
   * @param {string} search ID ou termo de busca
   * @returns {object|null}
   */
  findMenuItem(search) {
    if (!search) return null;
    const term = normalizeString(search);
    // Busca exata por ID
    let found = this.availableItems.find(i => i.id === search || normalizeString(i.id) === term);
    if (found) return found;

    // Busca exata por nome
    found = this.availableItems.find(i => normalizeString(i.nome) === term);
    if (found) return found;

    // Busca por inclusao no nome
    const partials = this.availableItems.filter(i => normalizeString(i.nome).includes(term));
    if (partials.length === 1) {
      return partials[0];
    }

    return null;
  }

  /**
   * Identifica possiveis itens ambiguos ao buscar termo generico (ex.: "bife").
   * @param {string} search
   * @returns {Array<object>}
   */
  findAmbiguousItems(search) {
    if (!search) return [];
    const term = normalizeString(search);
    return this.availableItems.filter(i => normalizeString(i.nome).includes(term));
  }

  /**
   * Retorna os itens disponiveis hoje no cardapio.
   */
  getAvailableItemsToday() {
    return this.availableItems.filter(item => item.disponivel_hoje);
  }

  /**
   * Sanitiza observacoes livres: remove caracteres de controle, corta em 140 chars.
   * @param {string} text
   * @returns {string}
   */
  sanitizeObs(text) {
    if (!text || typeof text !== 'string') return '';
    return text
      .replace(/[\x00-\x1F\x7F-\x9F]/g, '')
      .replace(/[<>]/g, '')
      .trim()
      .slice(0, this.configData?.limits?.max_obs_length ?? 140);
  }

  /**
   * Gera chave unica para a linha do carrinho baseada nas caracteristicas do item.
   */
  createLineKey(id, personalizacoes = [], observacoes = '') {
    const normPers = [...(personalizacoes || [])].map(p => normalizeString(p)).sort().join('|');
    const normObs = normalizeString(observacoes);
    return `${id}__${normPers}__${normObs}`;
  }

  /**
   * Adiciona um item ao carrinho com validacao estrita.
   * @param {object} params
   * @param {string} params.itemId ID do item
   * @param {number} params.quantidade Quantidade desejada
   * @param {string[]} [params.personalizacoes] Lista de personalizacoes
   * @param {string} [params.observacoes] Observacao opcional em texto livre
   * @returns {{ success: boolean, message: string, rejectedCustomizations?: string[] }}
   */
  addItem({ itemId, quantidade = 1, personalizacoes = [], observacoes = '' }) {
    const item = this.findMenuItem(itemId);
    if (!item) {
      return { success: false, message: `O item "${itemId}" não foi encontrado no cardápio.` };
    }

    if (!item.disponivel_hoje) {
      const alternativas = this.getAvailableItemsToday()
        .filter(i => i.categoria === item.categoria)
        .map(i => i.nome)
        .slice(0, 2);
      const sug = alternativas.length ? ` Que tal experimentar: ${alternativas.join(' ou ')}?` : '';
      return {
        success: false,
        message: `Desculpe, o item "${item.nome}" não está disponível hoje.${sug}`
      };
    }

    const qty = Math.floor(Number(quantidade));
    if (isNaN(qty) || qty <= 0) {
      return { success: false, message: 'A quantidade deve ser um número positivo maior que zero.' };
    }

    const maxPerItem = this.configData?.limits?.max_qty_per_item ?? 10;
    if (qty > maxPerItem) {
      return { success: false, message: `A quantidade máxima permitida por item é ${maxPerItem}.` };
    }

    // Valida estoque do dia
    const currentInCart = this.items
      .filter(i => i.id === item.id)
      .reduce((sum, i) => sum + i.quantidade, 0);

    if (item.estoque_do_dia !== undefined && (currentInCart + qty) > item.estoque_do_dia) {
      const restam = Math.max(0, item.estoque_do_dia - currentInCart);
      return {
        success: false,
        message: restam > 0
          ? `Temos apenas ${restam} unidade(s) de "${item.nome}" disponíveis hoje.`
          : `O item "${item.nome}" já está esgotado hoje.`
      };
    }

    // Valida total geral de itens no pedido
    const totalOrderItems = this.items.reduce((sum, i) => sum + i.quantidade, 0);
    const maxOrderItems = this.configData?.limits?.max_items_per_order ?? 20;
    if (totalOrderItems + qty > maxOrderItems) {
      return {
        success: false,
        message: `Limite de ${maxOrderItems} itens por pedido excedido.`
      };
    }

    // Valida personalizacoes permitidas
    const allowed = item.personalizacoes_permitidas || [];
    const validCustomizations = [];
    const rejectedCustomizations = [];

    if (Array.isArray(personalizacoes)) {
      for (const p of personalizacoes) {
        const pNorm = normalizeString(p);
        const match = allowed.find(a => normalizeString(a) === pNorm || pNorm.includes(normalizeString(a)));
        if (match) {
          if (!validCustomizations.includes(match)) {
            validCustomizations.push(match);
          }
        } else {
          rejectedCustomizations.push(p);
        }
      }
    }

    const safeObs = this.sanitizeObs(observacoes);
    const lineKey = this.createLineKey(item.id, validCustomizations, safeObs);

    const existingIndex = this.items.findIndex(i => i.line_key === lineKey);
    if (existingIndex >= 0) {
      this.items[existingIndex].quantidade += qty;
    } else {
      this.items.push({
        id: item.id,
        nome: item.nome,
        categoria: item.categoria,
        preco_unitario: item.preco_unitario,
        quantidade: qty,
        personalizacoes: validCustomizations,
        observacoes: safeObs,
        line_key: lineKey
      });
    }

    this.recalculateDelivery();
    this.notify();

    let msg = `Adicionado: ${qty}x ${item.nome}`;
    if (validCustomizations.length > 0) {
      msg += ` (${validCustomizations.join(', ')})`;
    }
    if (safeObs) {
      msg += ` [Obs: ${safeObs}]`;
    }
    if (rejectedCustomizations.length > 0) {
      msg += `. Nota: Não foi possível aplicar "${rejectedCustomizations.join(', ')}", pois não faz parte das personalizações deste prato.`;
    }

    return {
      success: true,
      message: msg,
      rejectedCustomizations
    };
  }

  /**
   * Remove itens do carrinho.
   * @param {string} itemId ID do item
   * @param {number} [quantidade] Quantidade a remover (se nula/omitida, remove tudo da linha)
   * @param {string} [lineKey] Chave da linha especifica, se conhecida
   * @returns {{ success: boolean, message: string }}
   */
  removeItem(itemId, quantidade = null, lineKey = null) {
    const item = this.findMenuItem(itemId);
    const targetId = item ? item.id : itemId;

    const matches = this.items.filter(i => (lineKey ? i.line_key === lineKey : i.id === targetId));
    if (matches.length === 0) {
      return { success: false, message: `Você não tem esse item no carrinho.` };
    }

    if (quantidade === null || quantidade === undefined) {
      // Remove todas as ocorrencias
      this.items = this.items.filter(i => (lineKey ? i.line_key !== lineKey : i.id !== targetId));
      this.recalculateDelivery();
      this.notify();
      return { success: true, message: `Item removido do seu pedido.` };
    }

    const qtyToRemove = Math.floor(Number(quantidade));
    if (qtyToRemove <= 0) {
      return { success: false, message: `Quantidade de remoção inválida.` };
    }

    // Reduz do primeiro match
    const target = matches[0];
    if (qtyToRemove >= target.quantidade) {
      this.items = this.items.filter(i => i !== target);
    } else {
      target.quantidade -= qtyToRemove;
    }

    this.recalculateDelivery();
    this.notify();
    return { success: true, message: `Removido(s) ${qtyToRemove} unidade(s).` };
  }

  /**
   * Altera a quantidade de uma linha do carrinho.
   */
  updateQuantity(itemId, newQty, lineKey = null) {
    const targetQty = Math.floor(Number(newQty));
    if (targetQty <= 0) {
      return this.removeItem(itemId, null, lineKey);
    }
    const target = lineKey
      ? this.items.find(i => i.line_key === lineKey)
      : this.items.find(i => i.id === itemId);

    if (!target) {
      return { success: false, message: 'Item não encontrado no carrinho.' };
    }

    const item = this.findMenuItem(target.id);
    if (item && item.estoque_do_dia !== undefined && targetQty > item.estoque_do_dia) {
      return {
        success: false,
        message: `Estoque insuficiente. Máximo disponível hoje: ${item.estoque_do_dia}.`
      };
    }

    target.quantidade = targetQty;
    this.recalculateDelivery();
    this.notify();
    return { success: true, message: `Quantidade atualizada para ${targetQty}.` };
  }

  /**
   * Limpa todo o carrinho.
   */
  clearCart() {
    this.items = [];
    this.delivery = {
      bairro: null,
      endereco: null,
      taxa: this.configData?.delivery?.default_fee ?? 700,
      isFree: false,
      bairroDetectado: null
    };
    this.status = 'montando';
    this.notify();
    return { success: true, message: 'Carrinho limpo com sucesso.' };
  }

  /**
   * Define endereco e bairro para entrega.
   * @param {string} bairro Bairro ou regiao
   * @param {string} endereco Logradouro e numero
   */
  setDelivery(bairro, endereco) {
    const cleanBairro = typeof bairro === 'string' ? bairro.trim() : this.delivery.bairro;
    const cleanEndereco = typeof endereco === 'string' ? endereco.trim() : this.delivery.endereco;

    this.delivery.bairro = cleanBairro;
    this.delivery.endereco = cleanEndereco;

    this.recalculateDelivery();
    this.notify();

    return {
      success: true,
      delivery: { ...this.delivery },
      message: `Endereço de entrega registrado: ${cleanEndereco || 'Não informado'} (${cleanBairro || 'Bairro pendente'}). Taxa: ${this.delivery.isFree ? 'Grátis' : formatCurrency(this.delivery.taxa)}`
    };
  }

  /**
   * Recalcula a taxa de entrega de acordo com o subtotal e bairro atual.
   */
  recalculateDelivery() {
    const subtotal = this.getSubtotal();
    const result = calculateDeliveryFee(subtotal, this.delivery.bairro, this.configData);
    this.delivery.taxa = result.fee;
    this.delivery.isFree = result.isFree;
    this.delivery.bairroDetectado = result.neighborhoodName;
  }

  getSubtotal() {
    return calculateSubtotal(this.items);
  }

  getDeliveryFee() {
    return this.delivery.taxa;
  }

  getTotal() {
    return calculateOrderTotal(this.getSubtotal(), this.getDeliveryFee());
  }

  /**
   * Confirma o pedido.
   * @returns {{ success: boolean, message: string, whatsappUrl?: string, orderText?: string }}
   */
  confirmOrder() {
    if (this.items.length === 0) {
      return { success: false, message: 'Seu carrinho está vazio. Escolha pelo menos um prato!' };
    }

    if (!this.delivery.endereco || !this.delivery.bairro) {
      this.status = 'aguardando_endereco';
      this.notify();
      return {
        success: false,
        requiresDelivery: true,
        message: 'Por favor, informe o seu bairro e endereço completo antes de finalizar o pedido.'
      };
    }

    this.status = 'confirmado';
    this.notify();

    const orderText = this.buildOrderSummaryText();
    const whatsappUrl = this.buildWhatsAppUrl(orderText);

    return {
      success: true,
      message: 'Pedido confirmado com sucesso!',
      whatsappUrl,
      orderText
    };
  }

  /**
   * Cancela o pedido.
   */
  cancelOrder() {
    this.status = 'cancelado';
    this.notify();
    return { success: true, message: 'Pedido cancelado.' };
  }

  /**
   * Gera o resumo deterministico do pedido em texto puro.
   */
  buildOrderSummaryText() {
    const subtotal = this.getSubtotal();
    const taxa = this.getDeliveryFee();
    const total = this.getTotal();
    const restName = this.configData?.restaurant_name || 'Marmitaria';

    let lines = [];
    lines.push(`🍱 *NOVO PEDIDO - ${restName.toUpperCase()}*`);
    lines.push(`📅 Data: ${new Date().toLocaleDateString('pt-BR')}`);
    lines.push('----------------------------------------');
    lines.push('*ITENS DO PEDIDO:*');

    for (const item of this.items) {
      const itemSub = item.preco_unitario * item.quantidade;
      let line = `• ${item.quantidade}x ${item.nome} (${formatCurrency(item.preco_unitario)}) = ${formatCurrency(itemSub)}`;
      if (item.personalizacoes?.length > 0) {
        line += `\n   └ Preferências: ${item.personalizacoes.join(', ')}`;
      }
      if (item.observacoes) {
        line += `\n   └ Obs: ${item.observacoes}`;
      }
      lines.push(line);
    }

    lines.push('----------------------------------------');
    lines.push(`*Subtotal:* ${formatCurrency(subtotal)}`);
    lines.push(`*Taxa de Entrega:* ${this.delivery.isFree ? 'GRÁTIS' : formatCurrency(taxa)}`);
    lines.push(`*TOTAL FINAL:* ${formatCurrency(total)}`);
    lines.push('----------------------------------------');
    lines.push('*DADOS DE ENTREGA:*');
    lines.push(`📍 Endereço: ${this.delivery.endereco || 'A combinar'}`);
    lines.push(`🏘 Bairro: ${this.delivery.bairro || 'A combinar'}`);
    lines.push('----------------------------------------');
    lines.push('ℹ️ Pagamento: Na entrega (Cartão/Dinheiro) ou via PIX ao receber.');

    return lines.join('\n');
  }

  /**
   * Gera o link do WhatsApp com mensagem codificada.
   */
  buildWhatsAppUrl(orderText) {
    const phone = this.configData?.whatsapp_number?.replace(/\D/g, '') || '5511999999999';
    const text = encodeURIComponent(orderText);
    return `https://wa.me/${phone}?text=${text}`;
  }

  /**
   * Retorna resumo estruturado completo para a UI.
   */
  getState() {
    const subtotal = this.getSubtotal();
    const taxa = this.getDeliveryFee();
    const total = this.getTotal();

    return {
      items: [...this.items],
      itemCount: this.items.reduce((sum, i) => sum + i.quantidade, 0),
      subtotal,
      subtotalFormatted: formatCurrency(subtotal),
      deliveryFee: taxa,
      deliveryFeeFormatted: this.delivery.isFree ? 'Grátis' : formatCurrency(taxa),
      total,
      totalFormatted: formatCurrency(total),
      isFreeDelivery: this.delivery.isFree,
      delivery: { ...this.delivery },
      status: this.status,
      currentDay: this.currentDay
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify() {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('Erro no listener do carrinho:', err);
      }
    }
  }
}
