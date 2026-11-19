/**
 * Modulo de gerenciamento de estado do carrinho (Single Source of Truth).
 * Toda a validacao de regras de negocio ocorre de forma deterministica aqui.
 *
 * Controle consistente de estoque:
 *  - reserva imediata ao adicionar;
 *  - devolucao automatica e atomica ao remover/limpar/cancelar;
 *  - confirmacao consome a reserva (sem segunda subtracao);
 *  - cancelamento de pedido confirmado devolve a reserva uma unica vez.
 */

import {
  calculateSubtotal,
  calculateDeliveryFee,
  calculateOrderTotal,
  formatCurrency,
  normalizeString
} from './pricing.js';
import {
  validateCustomizations,
  validateObservation
} from '../utils/customizationHelper.js';

export class CartStore {
  /**
   * @param {object} menuData Dados carregados do menu.json
   * @param {object} configData Dados carregados do config.json
   * @param {string} [currentDay] Dia da semana opcional ('segunda', 'terca', etc.)
   */
  constructor(menuData, configData, currentDay = null) {
    const safeMenu = menuData || { itens: [], cardapio_por_dia: {} };

    // Clona menuData para isolamento de estado e controle de estoque por sessao.
    this.initialMenuData = JSON.parse(JSON.stringify(safeMenu));
    this.menuData = JSON.parse(JSON.stringify(safeMenu));
    this.configData = configData || {};
    this.currentDay = currentDay || this.detectToday();

    this.initialStock = new Map();
    this.initialAvailability = new Map();
    for (const item of this.menuData.itens || []) {
      if (item.estoque_do_dia !== undefined) {
        this.initialStock.set(item.id, Math.max(0, Number(item.estoque_do_dia) || 0));
      }
      this.initialAvailability.set(item.id, item.disponivel_hoje !== false);
    }

    this.items = []; // Array<{ id, nome, preco_unitario, quantidade, personalizacoes, observacoes, line_key }>
    this.delivery = this._createEmptyDelivery();
    this.status = 'montando'; // 'montando' | 'aguardando_endereco' | 'aguardando_confirmacao' | 'confirmado' | 'cancelado'
    this.orderHistory = [];
    this.orderSequence = 0;
    this.listeners = new Set();

    // Carrega itens disponiveis para o dia selecionado
    this.updateDailyAvailability();
  }

  detectToday() {
    const days = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
    const todayIndex = new Date().getDay();
    return days[todayIndex];
  }

  _createEmptyDelivery() {
    return {
      bairro: null,
      endereco: null,
      rua: null,
      numero: null,
      complemento: null,
      referencia: null,
      taxa: this.configData?.delivery?.default_fee ?? 700,
      isFree: false,
      bairroDetectado: null
    };
  }

  _resetDelivery() {
    this.delivery = this._createEmptyDelivery();
  }

  _nextOrderId() {
    this.orderSequence += 1;
    return `PED-${Date.now()}-${this.orderSequence}`;
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
    this.availableItems = (this.menuData.itens || []).map(item => {
      const isAvailableDay = dayMenuIds.length > 0
        ? dayMenuIds.includes(item.id)
        : (this.initialAvailability.get(item.id) !== false);
      const hasStock = item.estoque_do_dia === undefined || item.estoque_do_dia > 0;
      return {
        ...item,
        disponivel_hoje: isAvailableDay && hasStock
      };
    });
  }

  /**
   * Recalcula os flags de disponibilidade de um item (dia + estoque) e mantem
   * a copia bruta do menu sincronizada com a copia usada pela interface.
   * @private
   */
  _refreshAvailability(availableItem) {
    if (!availableItem) return;

    const dayMenuIds = this.menuData.cardapio_por_dia?.[this.currentDay] || [];
    const isAvailableDay = dayMenuIds.length > 0
      ? dayMenuIds.includes(availableItem.id)
      : (this.initialAvailability.get(availableItem.id) !== false);
    const hasStock = availableItem.estoque_do_dia === undefined || availableItem.estoque_do_dia > 0;

    availableItem.disponivel_hoje = isAvailableDay && hasStock;

    const rawMenuItem = (this.menuData.itens || []).find(i => i.id === availableItem.id);
    if (rawMenuItem) {
      rawMenuItem.estoque_do_dia = availableItem.estoque_do_dia;
      rawMenuItem.disponivel_hoje = availableItem.disponivel_hoje;
    }
  }

  /**
   * Reserva estoque de forma atomica. Nunca permite negativo e nunca devolve
   * mais unidades do que o estoque inicial configurado.
   * @private
   */
  _reserveStock(itemId, qty) {
    const amount = Math.floor(Number(qty));
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const availableItem = this.availableItems.find(i => i.id === itemId);
    if (!availableItem) return 0;
    if (availableItem.estoque_do_dia === undefined) return amount;

    const current = Math.max(0, Number(availableItem.estoque_do_dia) || 0);
    const reserved = Math.min(current, amount);
    availableItem.estoque_do_dia = current - reserved;
    this._refreshAvailability(availableItem);
    return reserved;
  }

  /**
   * Restaura estoque de forma atomica, limitada ao estoque inicial da sessao.
   * Isso impede devolucoes duplicadas mesmo diante de chamadas repetidas.
   * @private
   */
  _restoreStock(itemId, qty) {
    const amount = Math.floor(Number(qty));
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const availableItem = this.availableItems.find(i => i.id === itemId);
    if (!availableItem || availableItem.estoque_do_dia === undefined) return 0;

    const current = Math.max(0, Number(availableItem.estoque_do_dia) || 0);
    const initial = this.initialStock.has(itemId)
      ? this.initialStock.get(itemId)
      : current + amount;
    const restored = Math.max(0, Math.min(amount, initial - current));

    availableItem.estoque_do_dia = current + restored;
    this._refreshAvailability(availableItem);
    return restored;
  }

  /**
   * Busca item no cardapio pelo ID.
   * @param {string} id
   * @returns {object|null}
   */
  getItemById(id) {
    if (!id) return null;
    return this.availableItems.find(i => i.id === id) || null;
  }

  /**
   * Busca item no cardapio pelo ID ou nome aproximado.
   * @param {string} search ID ou termo de busca
   * @returns {object|null}
   */
  findMenuItem(search) {
    if (!search) return null;
    const term = normalizeString(search);
    let found = this.availableItems.find(i => i.id === search || normalizeString(i.id) === term);
    if (found) return found;

    found = this.availableItems.find(i => normalizeString(i.nome) === term);
    if (found) return found;

    const partials = this.availableItems.filter(i => normalizeString(i.nome).includes(term));
    if (partials.length === 1) {
      return partials[0];
    }

    return null;
  }

  /**
   * Identifica possiveis itens ambiguos ao buscar termo generico (ex.: "bife").
   */
  findAmbiguousItems(search) {
    if (!search) return [];
    const term = normalizeString(search);
    return this.availableItems.filter(i => normalizeString(i.nome).includes(term));
  }

  /**
   * Itens que fazem parte do cardapio do dia (inclusive esgotados).
   * Usado pela interface para exibir o produto como indisponivel em vez de
   * simplesmente omiti-lo.
   */
  getMenuItemsForToday() {
    const dayMenuIds = this.menuData.cardapio_por_dia?.[this.currentDay] || [];
    if (dayMenuIds.length === 0) return [...this.availableItems];
    return this.availableItems.filter(item => dayMenuIds.includes(item.id));
  }

  /**
   * Retorna os itens efetivamente disponiveis (dia + estoque).
   */
  getAvailableItemsToday() {
    return this.availableItems.filter(item => item.disponivel_hoje);
  }

  /**
   * Sanitiza observacoes livres usando a regra central.
   */
  sanitizeObs(text) {
    return validateObservation(
      text,
      this.configData?.limits?.max_obs_length ?? 140
    ).sanitized;
  }

  /**
   * Gera chave unica para a linha do carrinho baseada nas caracteristicas do item.
   */
  createLineKey(id, personalizacoes = [], observacoes = '') {
    const normPers = [...(personalizacoes || [])]
      .map(p => normalizeString(p))
      .filter(Boolean)
      .sort()
      .join('|');
    const normObs = normalizeString(observacoes);
    return `${id}__${normPers}__${normObs}`;
  }

  /**
   * Valida personalizacoes contra a lista de opcoes permitidas do produto.
   * Mantido como metodo da classe por compatibilidade, mas delega para a
   * fonte central de regras (customizationHelper). Nao depende de `this`
   * dentro de callbacks: as chamadas internas usam a funcao importada.
   * @private
   */
  _validateCustomizations(item, requested) {
    return validateCustomizations(item, requested);
  }

  /**
   * Descricao legivel de uma linha personalizada.
   */
  describeLine(line) {
    if (!line) return '';
    const parts = [...(line.personalizacoes || [])];
    if (line.observacoes) parts.push(`Obs: ${line.observacoes}`);
    return parts.length > 0 ? parts.join(', ') : 'Sem personalizações';
  }

  /**
   * Resposta padronizada quando existem varias configuracoes do mesmo produto
   * e a operacao precisa saber qual linha alterar.
   * @private
   */
  _buildLineSelection(itemId, lines, operation = 'alterar') {
    return {
      success: false,
      requiresLineSelection: true,
      operation,
      itemId,
      options: lines.map(line => ({
        lineKey: line.line_key,
        quantidade: line.quantidade,
        personalizacoes: [...(line.personalizacoes || [])],
        observacoes: line.observacoes || '',
        label: this.describeLine(line)
      })),
      message: 'Você tem mais de uma configuração deste item no carrinho. Escolha qual deseja alterar.'
    };
  }

  /**
   * Atualiza as personalizacoes de uma linha existente no carrinho.
   * O estoque NAO muda (a quantidade e o produto continuam os mesmos).
   * @param {string} lineKey Chave da linha a atualizar
   * @param {string[]} newPersonalizacoes Novas personalizacoes
   * @param {string} [newObservacoes] Novas observacoes
   */
  updateItemCustomization(lineKey, newPersonalizacoes = [], newObservacoes = null) {
    const target = this.items.find(i => i.line_key === lineKey);
    if (!target) {
      return { success: false, message: 'Item não encontrado no carrinho.' };
    }

    const item = this.findMenuItem(target.id);
    if (!item) {
      return { success: false, message: 'Item não encontrado no cardápio.' };
    }

    const { validCustomizations, rejectedCustomizations } = validateCustomizations(item, newPersonalizacoes);
    const observation = newObservacoes !== null
      ? validateObservation(newObservacoes, this.configData?.limits?.max_obs_length ?? 140)
      : { sanitized: target.observacoes, truncated: false, message: '' };

    const newLineKey = this.createLineKey(target.id, validCustomizations, observation.sanitized);
    const existingOther = this.items.find(i => i.line_key === newLineKey && i !== target);

    if (existingOther) {
      // Configuracoes identicas viram uma unica linha; o estoque ja estava
      // reservado para as duas linhas e permanece inalterado.
      existingOther.quantidade += target.quantidade;
      this.items = this.items.filter(i => i !== target);
    } else {
      target.personalizacoes = validCustomizations;
      target.observacoes = observation.sanitized;
      target.line_key = newLineKey;
    }

    this.recalculateDelivery();
    this.notify();

    const notes = [];
    if (rejectedCustomizations.length > 0) {
      notes.push(`Não disponível para este prato: "${rejectedCustomizations.join(', ')}".`);
    }
    if (observation.message) notes.push(observation.message);

    return {
      success: true,
      message: `Personalização atualizada com sucesso.${notes.length ? ' ' + notes.join(' ') : ''}`,
      rejectedCustomizations
    };
  }

  /**
   * Adiciona um item ao carrinho com reserva automatica de estoque.
   * @param {object} params
   * @param {string} params.itemId ID do item
   * @param {number} params.quantidade Quantidade desejada
   * @param {string[]} [params.personalizacoes] Lista de personalizacoes
   * @param {string} [params.observacoes] Observacao opcional em texto livre
   */
  addItem({ itemId, quantidade = 1, personalizacoes = [], observacoes = '' }) {
    if (this.status === 'confirmado' || this.status === 'cancelado') {
      // Inicia um novo pedido sem apagar o historico anterior.
      this.items = [];
      this.status = 'montando';
      this._resetDelivery();
    }

    const item = this.findMenuItem(itemId);
    if (!item) {
      return { success: false, message: `O item "${itemId}" não foi encontrado no cardápio.` };
    }

    if (!item.disponivel_hoje || (item.estoque_do_dia !== undefined && item.estoque_do_dia <= 0)) {
      const alternativas = this.getAvailableItemsToday()
        .filter(i => i.categoria === item.categoria && i.id !== item.id)
        .map(i => i.nome)
        .slice(0, 2);
      const sug = alternativas.length ? ` Que tal experimentar: ${alternativas.join(' ou ')}?` : '';
      const isEsgotado = item.estoque_do_dia !== undefined && item.estoque_do_dia <= 0;
      return {
        success: false,
        message: isEsgotado
          ? `Desculpe, o item "${item.nome}" já está esgotado hoje.${sug}`
          : `Desculpe, o item "${item.nome}" não está disponível hoje.${sug}`
      };
    }

    const parsedQty = Number(quantidade);
    const qty = Math.floor(parsedQty);
    if (!Number.isFinite(parsedQty) || isNaN(qty) || qty <= 0) {
      return { success: false, message: 'A quantidade deve ser um número positivo maior que zero.' };
    }

    const maxPerItem = this.configData?.limits?.max_qty_per_item ?? 10;
    const currentItemQty = this.items
      .filter(i => i.id === item.id)
      .reduce((sum, i) => sum + i.quantidade, 0);

    if (currentItemQty + qty > maxPerItem) {
      return {
        success: false,
        message: `A quantidade máxima permitida por item é ${maxPerItem}.`
      };
    }

    if (item.estoque_do_dia !== undefined && qty > item.estoque_do_dia) {
      return {
        success: false,
        message: item.estoque_do_dia > 0
          ? `Temos apenas ${item.estoque_do_dia} unidade(s) de "${item.nome}" disponíveis hoje.`
          : `O item "${item.nome}" já está esgotado hoje.`
      };
    }

    const totalOrderItems = this.items.reduce((sum, i) => sum + i.quantidade, 0);
    const maxOrderItems = this.configData?.limits?.max_items_per_order ?? 20;
    if (totalOrderItems + qty > maxOrderItems) {
      return {
        success: false,
        message: `Limite de ${maxOrderItems} itens por pedido excedido.`
      };
    }

    const { validCustomizations, rejectedCustomizations } = validateCustomizations(item, personalizacoes);
    const observation = validateObservation(
      observacoes,
      this.configData?.limits?.max_obs_length ?? 140
    );

    if (!observation.valid) {
      return { success: false, message: observation.message };
    }

    const lineKey = this.createLineKey(item.id, validCustomizations, observation.sanitized);

    // Reserva antes de alterar as linhas; a validacao acima garante que a
    // operacao nao falha depois de mexer no estoque.
    const reserved = this._reserveStock(item.id, qty);
    if (reserved < qty) {
      // Nao deve ocorrer apos a checagem, mas evita estado inconsistente.
      this._restoreStock(item.id, reserved);
      return {
        success: false,
        message: `Estoque insuficiente para "${item.nome}". Tente uma quantidade menor.`
      };
    }

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
        observacoes: observation.sanitized,
        line_key: lineKey
      });
    }

    this.recalculateDelivery();
    this.notify();

    let msg = `Adicionado: ${qty}x ${item.nome}`;
    if (validCustomizations.length > 0) msg += ` (${validCustomizations.join(', ')})`;
    if (observation.sanitized) msg += ` [Obs: ${observation.sanitized}]`;
    if (rejectedCustomizations.length > 0) {
      msg += `. Nota: Não foi possível aplicar "${rejectedCustomizations.join(', ')}", pois não faz parte das personalizações deste prato.`;
    }
    if (observation.message) msg += ` ${observation.message}`;

    return {
      success: true,
      message: msg,
      rejectedCustomizations
    };
  }

  /**
   * Remove itens do carrinho e restaura o estoque correspondente.
   *
   * Com `lineKey`, atua apenas naquela configuracao. Sem `lineKey` e com
   * varias configuracoes do mesmo produto, retorna `requiresLineSelection`
   * em vez de remover uma linha arbitraria.
   *
   * @param {string} itemId ID do item
   * @param {number|null} [quantidade] Quantidade a remover (null remove a linha/tudo)
   * @param {string|null} [lineKey] Chave da linha especifica
   */
  removeItem(itemId, quantidade = null, lineKey = null) {
    const item = this.findMenuItem(itemId);
    const targetId = item ? item.id : itemId;

    const sameProduct = this.items.filter(i => i.id === targetId);
    const matches = lineKey
      ? sameProduct.filter(i => i.line_key === lineKey)
      : sameProduct;

    if (matches.length === 0) {
      return { success: false, message: 'Você não tem esse item no carrinho.' };
    }

    if (!lineKey && quantidade !== null && quantidade !== undefined && sameProduct.length > 1) {
      return this._buildLineSelection(targetId, sameProduct, 'remover');
    }

    if (quantidade === null || quantidade === undefined) {
      const totalToReturn = matches.reduce((sum, i) => sum + i.quantidade, 0);
      this._restoreStock(targetId, totalToReturn);
      this.items = this.items.filter(i => !matches.includes(i));

      this.recalculateDelivery();
      this.notify();
      return {
        success: true,
        message: `Item removido do seu pedido (${totalToReturn} unidade(s) devolvida(s) ao estoque).`
      };
    }

    const qtyToRemove = Math.floor(Number(quantidade));
    if (!Number.isFinite(qtyToRemove) || qtyToRemove <= 0) {
      return { success: false, message: 'Quantidade de remoção inválida.' };
    }

    const target = matches[0];
    const actualRemoved = Math.min(target.quantidade, qtyToRemove);
    this._restoreStock(targetId, actualRemoved);

    if (qtyToRemove >= target.quantidade) {
      this.items = this.items.filter(i => i !== target);
    } else {
      target.quantidade -= qtyToRemove;
    }

    this.recalculateDelivery();
    this.notify();
    return {
      success: true,
      message: `Removido(s) ${actualRemoved} unidade(s) de ${target.nome}.`
    };
  }

  /**
   * Altera a quantidade de uma linha do carrinho, ajustando o estoque pelo delta.
   */
  updateQuantity(itemId, newQty, lineKey = null) {
    const parsedQty = Number(newQty);
    if (!Number.isFinite(parsedQty)) {
      return { success: false, message: 'Quantidade inválida.' };
    }

    const targetQty = Math.floor(parsedQty);
    if (targetQty < 0) {
      return { success: false, message: 'Quantidade inválida.' };
    }

    const sameProduct = this.items.filter(i => i.id === itemId);
    if (sameProduct.length === 0) {
      return { success: false, message: 'Item não encontrado no carrinho.' };
    }

    if (!lineKey && sameProduct.length > 1) {
      return this._buildLineSelection(itemId, sameProduct, targetQty === 0 ? 'remover' : 'alterar');
    }

    if (targetQty === 0) {
      return this.removeItem(itemId, null, lineKey);
    }

    const target = lineKey
      ? sameProduct.find(i => i.line_key === lineKey)
      : sameProduct[0];

    if (!target) {
      return { success: false, message: 'Item não encontrado no carrinho.' };
    }

    const maxPerItem = this.configData?.limits?.max_qty_per_item ?? 10;
    const otherLinesQty = sameProduct
      .filter(i => i !== target)
      .reduce((sum, i) => sum + i.quantidade, 0);

    if (otherLinesQty + targetQty > maxPerItem) {
      return {
        success: false,
        message: `A quantidade máxima permitida por item é ${maxPerItem}.`
      };
    }

    const delta = targetQty - target.quantidade;
    if (delta === 0) {
      return { success: true, message: 'Quantidade inalterada.' };
    }

    const item = this.findMenuItem(target.id);
    if (!item) {
      return { success: false, message: 'Item não encontrado no cardápio.' };
    }

    if (delta > 0) {
      if (item.estoque_do_dia !== undefined && delta > item.estoque_do_dia) {
        return {
          success: false,
          message: item.estoque_do_dia > 0
            ? `Estoque insuficiente. Restam apenas ${item.estoque_do_dia} unidade(s) disponíveis hoje.`
            : `O item "${item.nome}" já está esgotado hoje.`
        };
      }

      const reserved = this._reserveStock(target.id, delta);
      if (reserved < delta) {
        this._restoreStock(target.id, reserved);
        return { success: false, message: `Estoque insuficiente para "${item.nome}".` };
      }
    } else {
      this._restoreStock(target.id, Math.abs(delta));
    }

    target.quantidade = targetQty;
    this.recalculateDelivery();
    this.notify();
    return { success: true, message: `Quantidade atualizada para ${targetQty}.` };
  }

  /**
   * Limpa o carrinho em montagem e devolve as reservas ao estoque.
   * Nao cancela um pedido ja confirmado (use cancelOrder para isso).
   */
  clearCart() {
    if (this.items.length === 0) {
      const wasConfirmed = this.status === 'confirmado';
      if (!wasConfirmed) {
        this.status = 'montando';
        this._resetDelivery();
      }
      this.notify();
      return {
        success: true,
        message: wasConfirmed
          ? 'O carrinho já está vazio. Seu último pedido permanece confirmado.'
          : 'O carrinho já está vazio.'
      };
    }

    let restored = 0;
    for (const item of this.items) {
      restored += this._restoreStock(item.id, item.quantidade);
    }

    this.items = [];
    this.delivery = this._createEmptyDelivery();
    this.status = 'montando';
    this.notify();

    return {
      success: true,
      message: `Carrinho limpo com sucesso. ${restored} unidade(s) devolvida(s) ao estoque.`
    };
  }

  /**
   * Define endereco e bairro para entrega (Itajubá - MG).
   * @param {string} bairro Bairro ou regiao de Itajuba
   * @param {string} endereco Logradouro e numero
   * @param {object} [details] Campos estruturados opcionais
   */
  setDelivery(bairro, endereco, details = {}) {
    const cleanBairro = typeof bairro === 'string'
      ? bairro.replace(/[<>]/g, '').trim()
      : this.delivery.bairro;
    const cleanEndereco = typeof endereco === 'string'
      ? endereco.replace(/[<>]/g, '').trim()
      : this.delivery.endereco;

    if (cleanBairro) this.delivery.bairro = cleanBairro;
    if (cleanEndereco) this.delivery.endereco = cleanEndereco;

    if (details.rua) this.delivery.rua = String(details.rua).replace(/[<>]/g, '').trim();
    if (details.numero) this.delivery.numero = String(details.numero).replace(/[<>]/g, '').trim();
    if (details.complemento !== undefined) {
      this.delivery.complemento = String(details.complemento || '').replace(/[<>]/g, '').trim();
    }
    if (details.referencia !== undefined) {
      this.delivery.referencia = String(details.referencia || '').replace(/[<>]/g, '').trim();
    }

    this.recalculateDelivery();
    this.notify();

    const enderecoTexto = this.delivery.endereco || 'Rua e número pendentes';
    const bairroTexto = this.delivery.bairro || 'Bairro pendente';
    return {
      success: true,
      delivery: { ...this.delivery },
      message: `Endereço de entrega registrado: ${enderecoTexto} (${bairroTexto}). Taxa: ${this.delivery.isFree ? 'Grátis' : formatCurrency(this.delivery.taxa)}`
    };
  }

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

  getLastOrder() {
    return this.orderHistory.length > 0
      ? this.orderHistory[this.orderHistory.length - 1]
      : null;
  }

  getLastConfirmedOrder() {
    for (let i = this.orderHistory.length - 1; i >= 0; i--) {
      const order = this.orderHistory[i];
      if (order.status === 'confirmado' && order.stockReturned !== true) return order;
    }
    return null;
  }

  /**
   * Confirma o pedido. O estoque ja foi reservado deterministicamente ao
   * adicionar e NAO e subtraido novamente aqui. O pedido confirmado sai do
   * carrinho em montagem, mas permanece integralmente no historico.
   */
  confirmOrder() {
    if (this.status === 'cancelado') {
      return {
        success: false,
        message: 'Seu pedido foi cancelado. Escolha os pratos novamente para iniciar um novo pedido.'
      };
    }

    if (this.status === 'confirmado') {
      const lastOrder = this.getLastConfirmedOrder() || this.getLastOrder();
      return {
        success: false,
        alreadyConfirmed: true,
        message: 'Seu pedido já foi confirmado e não pode ser finalizado novamente. Para iniciar outro pedido, adicione novos itens ao cardápio.',
        order: lastOrder,
        orderText: lastOrder?.orderText,
        whatsappUrl: lastOrder?.whatsappUrl
      };
    }

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

    // O resumo precisa ser gerado antes de esvaziar o carrinho.
    const orderText = this.buildOrderSummaryText();
    const whatsappUrl = this.buildWhatsAppUrl(orderText);

    const orderSnapshot = {
      id: this._nextOrderId(),
      items: JSON.parse(JSON.stringify(this.items)),
      subtotal: this.getSubtotal(),
      deliveryFee: this.getDeliveryFee(),
      total: this.getTotal(),
      delivery: { ...this.delivery },
      status: 'confirmado',
      date: new Date().toISOString(),
      orderText,
      whatsappUrl,
      stockReturned: false
    };

    this.orderHistory.push(orderSnapshot);
    this.items = [];
    this.status = 'confirmado';
    this._resetDelivery();
    this.notify();

    return {
      success: true,
      message: 'Pedido confirmado com sucesso!',
      whatsappUrl,
      orderText,
      order: orderSnapshot
    };
  }

  /**
   * Cancela o pedido de forma atomica e idempotente.
   *
   * - Pedido confirmado: devolve os itens daquele pedido e atualiza o status
   *   do proprio registro no historico (sem criar um segundo registro).
   * - Carrinho em montagem: devolve as reservas atuais e registra o rascunho
   *   cancelado no historico.
   * - Chamadas repetidas nao alteram o estoque novamente.
   */
  cancelOrder() {
    if (this.status === 'cancelado') {
      return {
        success: true,
        alreadyCancelled: true,
        message: 'O pedido já se encontra cancelado. Nenhuma alteração adicional no estoque foi feita.'
      };
    }

    const lastConfirmed = this.getLastConfirmedOrder();
    const cancellingConfirmedOrder = Boolean(lastConfirmed)
      && (this.status === 'confirmado' || this.items.length === 0);

    if (cancellingConfirmedOrder) {
      let restored = 0;
      for (const item of lastConfirmed.items || []) {
        restored += this._restoreStock(item.id, item.quantidade);
      }

      lastConfirmed.status = 'cancelado';
      lastConfirmed.stockReturned = true;
      lastConfirmed.cancelledAt = new Date().toISOString();

      this.items = [];
      this.status = 'cancelado';
      this._resetDelivery();
      this.notify();

      return {
        success: true,
        order: lastConfirmed,
        restoredUnits: restored,
        message: `Pedido ${lastConfirmed.id} cancelado com sucesso. ${restored} unidade(s) devolvida(s) ao estoque.`
      };
    }

    const cancelledItems = JSON.parse(JSON.stringify(this.items));
    const subtotal = this.getSubtotal();
    const deliveryFee = this.getDeliveryFee();
    const total = this.getTotal();
    const delivery = { ...this.delivery };
    let restored = 0;

    for (const item of this.items) {
      restored += this._restoreStock(item.id, item.quantidade);
    }

    let orderSnapshot = null;
    if (cancelledItems.length > 0) {
      orderSnapshot = {
        id: this._nextOrderId(),
        items: cancelledItems,
        subtotal,
        deliveryFee,
        total,
        delivery,
        status: 'cancelado',
        date: new Date().toISOString(),
        cancelledAt: new Date().toISOString(),
        stockReturned: true
      };
      this.orderHistory.push(orderSnapshot);
    }

    this.items = [];
    this.status = 'cancelado';
    this._resetDelivery();
    this.notify();

    return {
      success: true,
      order: orderSnapshot,
      restoredUnits: restored,
      message: `Pedido cancelado. ${restored} unidade(s) devolvida(s) ao estoque disponível com sucesso.`
    };
  }

  /**
   * Limpa todos os dados da sessao, incluindo historico, e recarrega o
   * estoque inicial do cardapio. Usado apenas pelo botao explicito de
   * "Limpar Dados da Sessão".
   */
  resetSession() {
    this.menuData = JSON.parse(JSON.stringify(this.initialMenuData));
    this.items = [];
    this.orderHistory = [];
    this.orderSequence = 0;
    this.status = 'montando';
    this._resetDelivery();
    this.updateDailyAvailability();
    this.notify();
    return { success: true, message: 'Dados da sessão limpos com sucesso.' };
  }

  /**
   * Gera o resumo deterministico do pedido em texto puro.
   */
  buildOrderSummaryText() {
    const subtotal = this.getSubtotal();
    const taxa = this.getDeliveryFee();
    const total = this.getTotal();
    const restName = this.configData?.restaurant_name || 'Marmitaria Sabor de Casa - Itajubá';

    const lines = [];
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
    lines.push('*DADOS DE ENTREGA (ITAJUBÁ - MG):*');
    lines.push(`📍 Endereço: ${this.delivery.endereco || 'A combinar'}`);
    lines.push(`🏘 Bairro: ${this.delivery.bairro || 'A combinar'} - Itajubá/MG`);
    if (this.delivery.referencia) {
      lines.push(`🚩 Ponto de Referência: ${this.delivery.referencia}`);
    }
    lines.push('----------------------------------------');
    lines.push('ℹ️ Pagamento: Na entrega (Cartão/Dinheiro) ou via PIX ao receber.');

    return lines.join('\n');
  }

  /**
   * Gera o link do WhatsApp com mensagem codificada.
   */
  buildWhatsAppUrl(orderText) {
    const phone = this.configData?.whatsapp_number?.replace(/\D/g, '') || '5535999999999';
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
    const lastOrder = this.getLastOrder();

    return {
      items: this.items.map(item => ({
        ...item,
        personalizacoes: [...(item.personalizacoes || [])]
      })),
      itemCount: this.items.reduce((sum, i) => sum + i.quantidade, 0),
      subtotal,
      subtotalFormatted: formatCurrency(subtotal),
      deliveryFee: taxa,
      deliveryFeeFormatted: this.delivery.isFree ? 'Grátis' : formatCurrency(taxa),
      total,
      totalFormatted: formatCurrency(total),
      isFreeDelivery: this.delivery.isFree,
      delivery: { ...this.delivery },
      deliveryComplete: Boolean(this.delivery.endereco && this.delivery.bairro),
      status: this.status,
      currentDay: this.currentDay,
      canCheckout: this.items.length > 0 && this.status !== 'confirmado' && this.status !== 'cancelado',
      orderHistory: [...this.orderHistory],
      lastOrder
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
