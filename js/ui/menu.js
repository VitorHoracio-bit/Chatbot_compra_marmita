/**
 * Interface do Cardapio do Dia.
 *
 * Toda a logica de carrinho e estoque permanece no CartStore (fonte unica de
 * verdade). Esta camada apenas:
 *  - renderiza os produtos do dia com controles visiveis de quantidade;
 *  - abre a personalizacao quando o produto exige escolhas;
 *  - permite escolher qual linha alterar quando o mesmo produto possui mais de
 *    uma configuracao no carrinho;
 *  - reage imediatamente ao estado publicado pelo CartStore.
 */

import { formatCurrency } from '../cart/pricing.js';
import {
  categorizeOptions,
  areCustomizationsConflicting,
  sanitizeObservation
} from '../utils/customizationHelper.js';

const CATEGORY_LABELS = {
  marmita: { title: '🍱 Marmitas do Dia', order: 1 },
  bebida: { title: '🥤 Bebidas', order: 2 },
  sobremesa: { title: '🍮 Sobremesas', order: 3 }
};

export class MenuUI {
  /**
   * @param {object} options
   * @param {import('../cart/store.js').CartStore} options.cartStore
   * @param {object} options.configData
   * @param {HTMLElement} options.gridElement
   * @param {HTMLElement} [options.emptyElement]
   * @param {HTMLElement} [options.panelElement]
   * @param {HTMLElement} [options.dayLabelElement]
   * @param {(message: string) => void} [options.onNotice]
   */
  constructor({ cartStore, configData, gridElement, emptyElement, panelElement, dayLabelElement, onNotice }) {
    this.cartStore = cartStore;
    this.configData = configData || {};
    this.gridElement = gridElement;
    this.emptyElement = emptyElement;
    this.panelElement = panelElement;
    this.dayLabelElement = dayLabelElement;
    this.onNotice = onNotice || (() => {});

    this.modal = document.getElementById('modal-customization');
    this.form = document.getElementById('form-customization');
    this.titleElement = document.getElementById('customization-title');
    this.subtitleElement = document.getElementById('customization-subtitle');
    this.optionsElement = document.getElementById('customization-options');
    this.obsInput = document.getElementById('customization-obs');
    this.obsCounter = document.getElementById('customization-obs-counter');
    this.obsLimit = document.getElementById('customization-obs-limit');
    this.warningElement = document.getElementById('customization-warning');
    this.saveButton = document.getElementById('btn-save-customization');

    this.lineModal = document.getElementById('modal-line-select');
    this.lineForm = document.getElementById('form-line-select');
    this.lineTitle = document.getElementById('line-select-title');
    this.lineDescription = document.getElementById('line-select-description');
    this.lineOptionsElement = document.getElementById('line-select-options');
    this.lineConfirmButton = document.getElementById('btn-confirm-line-select');

    this.customizationContext = null;
    this.lineSelectionContext = null;

    this.boundCloseModal = () => this.closeCustomizationModal();
    this.boundLineClose = () => this.closeLineSelection();
  }

  init() {
    if (!this.gridElement) return;

    this.cartStore.subscribe(state => this.render(state));
    this.render(this.cartStore.getState());

    this.setupCustomizationForm();
    this.setupLineSelectionForm();
    this.setupPanelControls();

    // Abre o painel automaticamente apenas em telas amplas.
    if (window.matchMedia('(min-width: 1181px)').matches) {
      this.open();
    }
  }

  /* ==========================================================================
     Painel e renderizacao do cardapio
     ========================================================================== */

  setupPanelControls() {
    const toggleBtn = document.getElementById('btn-toggle-menu');
    const closeBtn = document.getElementById('btn-close-menu');

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => this.toggle());
    }
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.close());
    }
  }

  isOpen() {
    return Boolean(this.panelElement?.classList.contains('is-open'));
  }

  open() {
    this.panelElement?.classList.add('is-open');
    const toggleBtn = document.getElementById('btn-toggle-menu');
    toggleBtn?.setAttribute('aria-expanded', 'true');
    toggleBtn?.setAttribute('aria-label', 'Fechar cardápio do dia');
  }

  close() {
    this.panelElement?.classList.remove('is-open');
    const toggleBtn = document.getElementById('btn-toggle-menu');
    toggleBtn?.setAttribute('aria-expanded', 'false');
    toggleBtn?.setAttribute('aria-label', 'Abrir cardápio do dia');
  }

  toggle() {
    if (this.isOpen()) this.close();
    else this.open();
  }

  render(state) {
    if (!this.gridElement) return;

    const dayNames = {
      domingo: 'Domingo',
      segunda: 'Segunda-feira',
      terca: 'Terça-feira',
      quarta: 'Quarta-feira',
      quinta: 'Quinta-feira',
      sexta: 'Sexta-feira',
      sabado: 'Sábado'
    };

    if (this.dayLabelElement) {
      this.dayLabelElement.textContent = dayNames[this.cartStore.currentDay] || this.cartStore.currentDay;
    }

    const menuItems = this.cartStore.getMenuItemsForToday();
    this.gridElement.textContent = '';

    if (menuItems.length === 0) {
      if (this.emptyElement) this.emptyElement.style.display = 'flex';
      return;
    }
    if (this.emptyElement) this.emptyElement.style.display = 'none';

    const quantities = this.getQuantitiesByItem(state);
    const linesByItem = this.getLinesByItem(state);

    const grouped = new Map();
    for (const item of menuItems) {
      const category = CATEGORY_LABELS[item.categoria] ? item.categoria : 'outros';
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push(item);
    }

    const categories = [...grouped.keys()].sort((a, b) => {
      const orderA = CATEGORY_LABELS[a]?.order ?? 99;
      const orderB = CATEGORY_LABELS[b]?.order ?? 99;
      return orderA - orderB;
    });

    for (const category of categories) {
      const heading = document.createElement('h3');
      heading.className = 'menu-category-title';
      heading.textContent = CATEGORY_LABELS[category]?.title || '🍽 Outros';
      this.gridElement.appendChild(heading);

      const cards = document.createElement('div');
      cards.className = 'menu-cards-grid';

      for (const item of grouped.get(category)) {
        cards.appendChild(
          this.buildProductCard(item, quantities.get(item.id) || 0, linesByItem.get(item.id) || [])
        );
      }

      this.gridElement.appendChild(cards);
    }
  }

  getQuantitiesByItem(state) {
    const quantities = new Map();
    for (const line of state.items) {
      quantities.set(line.id, (quantities.get(line.id) || 0) + line.quantidade);
    }
    return quantities;
  }

  getLinesByItem(state) {
    const lines = new Map();
    for (const line of state.items) {
      if (!lines.has(line.id)) lines.set(line.id, []);
      lines.get(line.id).push(line);
    }
    return lines;
  }

  buildProductCard(item, quantity, lines) {
    const card = document.createElement('article');
    card.className = 'menu-card';
    card.dataset.itemId = item.id;
    if (!item.disponivel_hoje) card.classList.add('is-sold-out');

    const top = document.createElement('div');
    top.className = 'menu-card-top';

    const categoryBadge = document.createElement('span');
    categoryBadge.className = 'menu-category-badge';
    categoryBadge.textContent = this.getCategoryShortLabel(item.categoria);
    top.appendChild(categoryBadge);

    const stockBadge = document.createElement('span');
    stockBadge.className = 'menu-stock-badge';
    if (!item.disponivel_hoje && quantity === 0) {
      stockBadge.textContent = 'Esgotado';
      stockBadge.classList.add('is-empty');
    } else if (item.estoque_do_dia === undefined) {
      stockBadge.textContent = 'Disponível';
    } else if (item.estoque_do_dia <= 0) {
      stockBadge.textContent = 'Esgotado';
      stockBadge.classList.add('is-empty');
    } else {
      stockBadge.textContent = `Restam ${item.estoque_do_dia}`;
    }
    top.appendChild(stockBadge);
    card.appendChild(top);

    const name = document.createElement('h4');
    name.className = 'menu-card-name';
    name.textContent = item.nome;
    card.appendChild(name);

    const description = document.createElement('p');
    description.className = 'menu-card-description';
    description.textContent = item.descricao || '';
    card.appendChild(description);

    const footer = document.createElement('div');
    footer.className = 'menu-card-footer';

    const price = document.createElement('span');
    price.className = 'menu-card-price';
    price.textContent = formatCurrency(item.preco_unitario);
    footer.appendChild(price);

    const actions = document.createElement('div');
    actions.className = 'menu-card-actions';
    const maxPerItem = Number(this.configData?.limits?.max_qty_per_item) || 10;
    const canAddMore = item.disponivel_hoje
      && item.estoque_do_dia !== 0
      && quantity < maxPerItem;

    if (quantity > 0 && lines.length > 0) {
      const stepper = document.createElement('div');
      stepper.className = 'menu-qty-controls';

      const minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'btn-qty menu-qty-btn';
      minus.textContent = '−';
      minus.setAttribute('aria-label', `Diminuir quantidade de ${item.nome}`);
      minus.addEventListener('click', () => this.decrementProduct(item, lines));
      stepper.appendChild(minus);

      const qty = document.createElement('span');
      qty.className = 'qty-val';
      qty.textContent = String(quantity);
      stepper.appendChild(qty);

      const plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'btn-qty menu-qty-btn';
      plus.textContent = '+';
      plus.setAttribute('aria-label', `Aumentar quantidade de ${item.nome}`);
      plus.disabled = !canAddMore;
      plus.addEventListener('click', () => this.incrementProduct(item));
      stepper.appendChild(plus);

      actions.appendChild(stepper);
    } else {
      const addButton = document.createElement('button');
      addButton.type = 'button';
      addButton.className = 'btn-add-product';
      addButton.textContent = '+ Adicionar';
      addButton.disabled = !canAddMore;
      addButton.setAttribute('aria-label', `Adicionar ${item.nome} ao pedido`);
      addButton.addEventListener('click', () => this.incrementProduct(item));
      actions.appendChild(addButton);
    }

    footer.appendChild(actions);
    card.appendChild(footer);

    if (Array.isArray(item.personalizacoes_permitidas) && item.personalizacoes_permitidas.length > 0) {
      const customizable = document.createElement('span');
      customizable.className = 'menu-customizable-hint';
      customizable.textContent = 'Personalizável ao adicionar';
      card.appendChild(customizable);
    }

    return card;
  }

  getCategoryShortLabel(category) {
    if (category === 'marmita') return 'Marmita';
    if (category === 'bebida') return 'Bebida';
    if (category === 'sobremesa') return 'Sobremesa';
    return 'Item';
  }

  /* ==========================================================================
     Acoes de adicionar / remover do cardapio
     ========================================================================== */

  incrementProduct(item) {
    if (!item.disponivel_hoje || item.estoque_do_dia === 0) {
      this.onNotice('Este item está esgotado hoje.');
      return;
    }

    const hasCustomizations = Array.isArray(item.personalizacoes_permitidas)
      && item.personalizacoes_permitidas.length > 0;

    if (hasCustomizations) {
      this.openCustomizationModal(item, { mode: 'add' });
      return;
    }

    const res = this.cartStore.addItem({ itemId: item.id, quantidade: 1 });
    if (!res.success) this.onNotice(res.message);
  }

  decrementProduct(item, lines) {
    const totalInCart = lines.reduce((sum, line) => sum + line.quantidade, 0);
    if (totalInCart <= 0) return;

    if (lines.length === 1) {
      const line = lines[0];
      const res = line.quantidade <= 1
        ? this.cartStore.removeItem(item.id, null, line.line_key)
        : this.cartStore.updateQuantity(item.id, line.quantidade - 1, line.line_key);
      if (!res.success) this.onNotice(res.message);
      return;
    }

    this.openLineSelection({
      title: 'Qual configuração diminuir?',
      description: `Você tem ${lines.length} configurações de ${item.nome}. Escolha qual deve ter a quantidade reduzida.`,
      options: lines,
      confirmLabel: 'Aplicar à selecionada',
      onConfirm: line => {
        const res = line.quantidade <= 1
          ? this.cartStore.removeItem(item.id, null, line.line_key)
          : this.cartStore.updateQuantity(item.id, line.quantidade - 1, line.line_key);
        if (!res.success) this.onNotice(res.message);
      }
    });
  }

  /* ==========================================================================
     Modal de personalizacao (adicionar ou editar)
     ========================================================================== */

  openCustomizationModal(item, { mode = 'add', line = null } = {}) {
    if (!this.modal || !this.form) return;

    const maxObs = Number(this.configData?.limits?.max_obs_length) || 140;
    this.customizationContext = { item, mode, lineKey: line?.line_key || null };

    if (this.titleElement) {
      this.titleElement.textContent = mode === 'edit'
        ? `Editar ${item.nome}`
        : `Personalizar ${item.nome}`;
    }
    if (this.subtitleElement) {
      this.subtitleElement.textContent = mode === 'edit'
        ? 'Altere as escolhas desta linha do pedido.'
        : 'Escolha as opções desejadas para este item.';
    }
    if (this.saveButton) {
      this.saveButton.textContent = mode === 'edit' ? 'Salvar alterações' : 'Adicionar ao pedido';
    }

    this.renderCustomizationOptions(item, line?.personalizacoes || []);

    if (this.obsInput) {
      this.obsInput.value = line?.observacoes || '';
      this.obsInput.maxLength = maxObs;
      this.obsInput.placeholder = `Ex.: tirar a cebola, ponto da carne, etc. (máx. ${maxObs})`;
      if (this.obsLimit) this.obsLimit.textContent = String(maxObs);
      if (this.obsCounter) this.obsCounter.textContent = String(this.obsInput.value.length);
    }

    this.showCustomizationWarning('');
    this.modal.style.display = 'flex';
    this.obsInput?.focus();
  }

  closeCustomizationModal() {
    if (this.modal) this.modal.style.display = 'none';
    this.customizationContext = null;
  }

  renderCustomizationOptions(item, selectedOptions) {
    if (!this.optionsElement) return;
    this.optionsElement.textContent = '';

    const selected = new Set(selectedOptions || []);
    const groups = categorizeOptions(item.personalizacoes_permitidas || []);

    if (groups.removals.length > 0) {
      this.optionsElement.appendChild(
        this.buildOptionGroup('Remover ingredientes', 'removal', groups.removals, selected, 'checkbox')
      );
    }

    if (groups.cookingPoints.length > 0) {
      this.optionsElement.appendChild(
        this.buildOptionGroup('Ponto de cozimento', 'cooking', groups.cookingPoints, selected, 'radio')
      );
    }

    if (groups.seasonings.length > 0) {
      this.optionsElement.appendChild(
        this.buildOptionGroup('Preferências e temperos', 'seasoning', groups.seasonings, selected, 'checkbox')
      );
    }
  }

  buildOptionGroup(title, groupName, options, selected, inputType) {
    const group = document.createElement('fieldset');
    group.className = 'customization-group';

    const legend = document.createElement('legend');
    legend.className = 'customization-group-title';
    legend.textContent = title;
    group.appendChild(legend);

    if (inputType === 'radio') {
      const noPreference = this.buildOptionRow({
        label: 'Sem preferência',
        value: '',
        checked: !options.some(option => selected.has(option)),
        type: 'radio',
        name: `custom-${groupName}`
      });
      group.appendChild(noPreference);
    }

    for (const option of options) {
      const row = this.buildOptionRow({
        label: option,
        value: option,
        checked: selected.has(option),
        type: inputType,
        name: `custom-${groupName}`
      });

      const input = row.querySelector('input');
      if (inputType === 'checkbox') {
        input.addEventListener('change', () => {
          if (!input.checked) return;
          // Evita combinacoes contraditorias (ex.: "sem cebola" + "cebola extra"),
          // inclusive entre grupos diferentes (remoção x temperos).
          this.optionsElement?.querySelectorAll('input[type="checkbox"]').forEach(other => {
            if (other !== input && other.checked && areCustomizationsConflicting(other.value, input.value)) {
              other.checked = false;
            }
          });
        });
      }

      group.appendChild(row);
    }

    return group;
  }

  buildOptionRow({ label, value, checked, type, name }) {
    const row = document.createElement('label');
    row.className = 'customization-option';

    const input = document.createElement('input');
    input.type = type;
    input.name = name;
    input.value = value;
    input.checked = checked;
    row.appendChild(input);

    const text = document.createElement('span');
    text.textContent = label;
    row.appendChild(text);

    return row;
  }

  setupCustomizationForm() {
    if (!this.form) return;

    this.obsInput?.addEventListener('input', () => {
      if (this.obsCounter) this.obsCounter.textContent = String(this.obsInput.value.length);
    });

    this.form.addEventListener('submit', event => {
      event.preventDefault();
      this.submitCustomization();
    });
  }

  submitCustomization() {
    const context = this.customizationContext;
    if (!context) return;

    const selected = [];
    this.optionsElement?.querySelectorAll('input:checked').forEach(input => {
      if (input.value) selected.push(input.value);
    });

    const maxObs = Number(this.configData?.limits?.max_obs_length) || 140;
    const observation = sanitizeObservation(this.obsInput?.value || '', maxObs);

    let res;
    if (context.mode === 'edit') {
      res = this.cartStore.updateItemCustomization(context.lineKey, selected, observation);
    } else {
      res = this.cartStore.addItem({
        itemId: context.item.id,
        quantidade: 1,
        personalizacoes: selected,
        observacoes: observation
      });
    }

    if (!res.success) {
      this.showCustomizationWarning(res.message || 'Não foi possível salvar esta personalização.');
      return;
    }

    if (res.rejectedCustomizations?.length > 0) {
      this.showCustomizationWarning(res.message);
      return;
    }

    this.closeCustomizationModal();
    if (res.message) this.onNotice(res.message);
  }

  showCustomizationWarning(message) {
    if (!this.warningElement) return;
    this.warningElement.textContent = message || '';
    this.warningElement.style.display = message ? 'block' : 'none';
  }

  openEditCustomization(line) {
    const item = this.cartStore.findMenuItem(line.id);
    if (!item) return;
    const allowed = Array.isArray(item.personalizacoes_permitidas)
      ? item.personalizacoes_permitidas
      : [];
    if (allowed.length === 0) {
      this.onNotice('Este item não possui opções de personalização.');
      return;
    }
    this.openCustomizationModal(item, { mode: 'edit', line });
  }

  /* ==========================================================================
     Modal de selecao de linha (mesmo produto, varias configuracoes)
     ========================================================================== */

  openLineSelection({ title, description, options, confirmLabel, onConfirm }) {
    if (!this.lineModal) return;

    this.lineSelectionContext = { onConfirm };
    if (this.lineTitle) this.lineTitle.textContent = title || 'Escolha uma configuração';
    if (this.lineDescription) this.lineDescription.textContent = description || '';
    if (this.lineConfirmButton) this.lineConfirmButton.textContent = confirmLabel || 'Confirmar';

    if (this.lineOptionsElement) {
      this.lineOptionsElement.textContent = '';
      options.forEach((line, index) => {
        const row = document.createElement('label');
        row.className = 'line-select-option';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = 'line-selection';
        input.value = line.line_key;
        input.checked = index === 0;
        row.appendChild(input);

        const content = document.createElement('span');
        content.className = 'line-select-content';

        const heading = document.createElement('strong');
        heading.textContent = `${line.quantidade}x ${line.nome || 'Item'}`;
        content.appendChild(heading);

        const details = document.createElement('span');
        details.className = 'line-select-details';
        const parts = [...(line.personalizacoes || [])];
        if (line.observacoes) parts.push(`Obs: ${line.observacoes}`);
        details.textContent = parts.length > 0 ? parts.join(', ') : 'Sem personalizações';
        content.appendChild(details);

        row.appendChild(content);
        this.lineOptionsElement.appendChild(row);
      });
    }

    this.lineModal.style.display = 'flex';
  }

  setupLineSelectionForm() {
    if (!this.lineForm) return;

    this.lineForm.addEventListener('submit', event => {
      event.preventDefault();
      const selectedInput = this.lineOptionsElement?.querySelector('input[name="line-selection"]:checked');
      if (!selectedInput || !this.lineSelectionContext) return;

      const context = this.lineSelectionContext;
      const lineKey = selectedInput.value;

      // Recupera a linha atualizada do carrinho (quantidade pode ter mudado).
      const state = this.cartStore.getState();
      const line = state.items.find(item => item.line_key === lineKey);
      if (!line) {
        this.closeLineSelection();
        this.onNotice('Esta configuração não está mais no carrinho.');
        return;
      }

      this.closeLineSelection();
      context.onConfirm(line);
    });
  }

  closeLineSelection() {
    if (this.lineModal) this.lineModal.style.display = 'none';
    this.lineSelectionContext = null;
  }
}
