/**
 * Ponto de Entrada Principal (Main Application Bootstrap)
 * Carrega dados estáticos relativos, inicializa módulos, subscreve eventos
 * e gerencia interface (tema, carrinho, modais e mensagens).
 */

import { CartStore } from './cart/store.js';
import { LLMProviderManager } from './llm/provider.js';
import { MarmitaAgent } from './agent/agent.js';
import { ChatUI } from './ui/chat.js';
import { formatCurrency } from './cart/pricing.js';

class App {
  constructor() {
    this.menuData = null;
    this.configData = null;
    this.cartStore = null;
    this.llmManager = null;
    this.agent = null;
    this.chatUI = null;
  }

  async init() {
    try {
      // Carregamento ancorado na localização do módulo (100% relativo e imune a rotas)
      const menuUrl = new URL('../data/menu.json', import.meta.url).href;
      const configUrl = new URL('../data/config.json', import.meta.url).href;
      const [menuRes, configRes] = await Promise.all([
        fetch(menuUrl),
        fetch(configUrl)
      ]);

      if (!menuRes.ok || !configRes.ok) {
        throw new Error('Falha ao carregar arquivos de configuração ou cardápio.');
      }

      this.menuData = await menuRes.json();
      this.configData = await configRes.json();

      // Inicialização do Estado e Agente
      this.cartStore = new CartStore(this.menuData, this.configData);
      this.llmManager = new LLMProviderManager(this.cartStore, this.configData);
      this.agent = new MarmitaAgent(this.cartStore, this.llmManager, this.configData);

      // Setup da UI
      this.setupDOM();
      this.setupTheme();
      this.setupCartListeners();
      this.setupModals();
      this.setupDaySelector();

      // Boas-vindas inicial no chat
      this.showWelcomeMessage();

    } catch (err) {
      console.error('Erro na inicialização da aplicação:', err);
      const container = document.getElementById('chat-messages');
      if (container) {
        const errDiv = document.createElement('div');
        errDiv.className = 'message system-notice';
        errDiv.textContent = `Erro ao carregar cardápio: ${err.message}. Verifique os arquivos na pasta data/`;
        container.appendChild(errDiv);
      }
    }
  }

  setupDOM() {
    const messagesContainer = document.getElementById('chat-messages');
    const inputElement = document.getElementById('chat-input');
    const charCounter = document.getElementById('char-counter');
    const sendBtn = document.getElementById('btn-send');

    this.chatUI = new ChatUI({
      messagesContainer,
      inputElement,
      charCounter,
      onSendMessage: (msg) => this.handleUserMessage(msg)
    });

    sendBtn.addEventListener('click', () => this.chatUI.submitMessage());

    // Botões de Ação Rápida
    document.querySelectorAll('.btn-quick').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        this.handleQuickAction(action);
      });
    });

    // Toggle Carrinho Mobile
    const cartToggleBtn = document.getElementById('btn-toggle-cart');
    const cartCloseBtn = document.getElementById('btn-close-cart');
    const cartSidebar = document.getElementById('cart-sidebar');

    if (cartToggleBtn && cartSidebar) {
      cartToggleBtn.addEventListener('click', () => {
        cartSidebar.classList.toggle('open');
      });
    }

    if (cartCloseBtn && cartSidebar) {
      cartCloseBtn.addEventListener('click', () => {
        cartSidebar.classList.remove('open');
      });
    }

    // Botão Limpar Carrinho
    const clearCartBtn = document.getElementById('btn-clear-cart');
    if (clearCartBtn) {
      clearCartBtn.addEventListener('click', () => {
        if (confirm('Deseja realmente esvaziar seu carrinho?')) {
          this.cartStore.clearCart();
          this.chatUI.appendSystemNotice('Carrinho limpo com sucesso.');
        }
      });
    }

    // Botão Finalizar Pedido no Carrinho
    const checkoutBtn = document.getElementById('btn-checkout');
    if (checkoutBtn) {
      checkoutBtn.addEventListener('click', () => {
        this.openDeliveryModal();
      });
    }
  }

  async handleUserMessage(userText) {
    this.chatUI.appendUserMessage(userText);
    this.chatUI.showTyping();

    try {
      const response = await this.agent.handleUserMessage(userText);
      this.chatUI.hideTyping();

      if (response.warning) {
        this.chatUI.appendSystemNotice(response.warning);
      }

      this.chatUI.appendBotMessage(response.text, {
        whatsappUrl: response.whatsappUrl
      });

      if (response.requiresDelivery) {
        this.openDeliveryModal();
      }
    } catch (err) {
      this.chatUI.hideTyping();
      this.chatUI.appendBotMessage(`Ops! Ocorreu um problema inesperado: ${err.message}.`);
    }
  }

  handleQuickAction(action) {
    switch (action) {
      case 'menu':
        this.handleUserMessage('Ver cardápio de hoje');
        break;
      case 'cart':
        this.handleUserMessage('Ver meu pedido atual');
        break;
      case 'delivery':
        this.openDeliveryModal();
        break;
      case 'checkout':
        this.handleUserMessage('Quero confirmar meu pedido');
        break;
      case 'help':
        this.handleUserMessage('Como funciona o atendimento?');
        break;
      default:
        break;
    }
  }

  showWelcomeMessage() {
    const welcome = `🍱 *Bem-vindo à Marmitaria Sabor de Casa!*\n\nSou seu atendente virtual inteligente. Você pode pedir qualquer prato do dia em linguagem natural, personalizar ingredientes e fechar sua entrega!\n\n💡 *Exemplo:* "Quero 1 bife acebolado sem cebola e 1 guaraná gelado".\n\nClique em *Ver Cardápio* ou digite sua escolha para começar:`;
    this.chatUI.appendBotMessage(welcome);
  }

  /* ==========================================================================
     Carrinho Reativo
     ========================================================================== */
  setupCartListeners() {
    this.cartStore.subscribe((state) => {
      this.renderCartUI(state);
    });

    // Render inicial
    this.renderCartUI(this.cartStore.getState());
  }

  renderCartUI(state) {
    // Atualiza badges de contagem
    const badges = document.querySelectorAll('.cart-badge');
    badges.forEach(b => { b.textContent = String(state.itemCount); });

    // Atualiza valores financeiros (estritamente determinísticos)
    const subtotalEl = document.getElementById('cart-subtotal');
    const deliveryEl = document.getElementById('cart-delivery');
    const totalEl = document.getElementById('cart-total');
    const checkoutBtn = document.getElementById('btn-checkout');

    if (subtotalEl) subtotalEl.textContent = state.subtotalFormatted;
    if (deliveryEl) deliveryEl.textContent = state.deliveryFeeFormatted;
    if (totalEl) totalEl.textContent = state.totalFormatted;
    if (checkoutBtn) checkoutBtn.disabled = state.items.length === 0;

    // Atualiza barra de progresso do frete grátis
    this.renderFreeShippingProgress(state);

    // Renderiza itens
    const itemsList = document.getElementById('cart-items-list');
    const emptyState = document.getElementById('cart-empty-state');
    if (!itemsList) return;

    itemsList.innerHTML = '';

    if (state.items.length === 0) {
      if (emptyState) emptyState.style.display = 'flex';
      return;
    }

    if (emptyState) emptyState.style.display = 'none';

    state.items.forEach(item => {
      const card = document.createElement('div');
      card.className = 'cart-item-card';

      const top = document.createElement('div');
      top.className = 'item-top';

      const name = document.createElement('span');
      name.className = 'item-name';
      name.textContent = item.nome;

      const price = document.createElement('span');
      price.className = 'item-price';
      price.textContent = formatCurrency(item.preco_unitario * item.quantidade);

      top.appendChild(name);
      top.appendChild(price);
      card.appendChild(top);

      // Preferencias / Observacoes
      if (item.personalizacoes?.length > 0 || item.observacoes) {
        const meta = document.createElement('div');
        meta.className = 'item-meta';

        if (item.personalizacoes?.length > 0) {
          const badge = document.createElement('span');
          badge.className = 'item-badge';
          badge.textContent = item.personalizacoes.join(', ');
          meta.appendChild(badge);
        }

        if (item.observacoes) {
          const obsSpan = document.createElement('span');
          obsSpan.textContent = `Obs: ${item.observacoes}`;
          meta.appendChild(obsSpan);
        }

        card.appendChild(meta);
      }

      // Controles de Quantidade
      const controls = document.createElement('div');
      controls.className = 'item-controls';

      const stepper = document.createElement('div');
      stepper.className = 'qty-stepper';

      const btnMinus = document.createElement('button');
      btnMinus.className = 'btn-qty';
      btnMinus.type = 'button';
      btnMinus.textContent = '-';
      btnMinus.addEventListener('click', () => {
        this.cartStore.updateQuantity(item.id, item.quantidade - 1, item.line_key);
      });

      const qtySpan = document.createElement('span');
      qtySpan.className = 'qty-val';
      qtySpan.textContent = String(item.quantidade);

      const btnPlus = document.createElement('button');
      btnPlus.className = 'btn-qty';
      btnPlus.type = 'button';
      btnPlus.textContent = '+';
      btnPlus.addEventListener('click', () => {
        this.cartStore.updateQuantity(item.id, item.quantidade + 1, item.line_key);
      });

      stepper.appendChild(btnMinus);
      stepper.appendChild(qtySpan);
      stepper.appendChild(btnPlus);

      const btnRemove = document.createElement('button');
      btnRemove.className = 'btn-remove-item';
      btnRemove.type = 'button';
      btnRemove.textContent = 'Remover';
      btnRemove.addEventListener('click', () => {
        this.cartStore.removeItem(item.id, null, item.line_key);
      });

      controls.appendChild(stepper);
      controls.appendChild(btnRemove);
      card.appendChild(controls);

      itemsList.appendChild(card);
    });
  }

  renderFreeShippingProgress(state) {
    const card = document.getElementById('free-shipping-card');
    const textEl = document.getElementById('shipping-text');
    const barEl = document.getElementById('shipping-bar');
    if (!card || !textEl || !barEl) return;

    const threshold = this.configData?.delivery?.free_delivery_threshold ?? 6000;
    if (threshold <= 0) {
      card.style.display = 'none';
      return;
    }

    card.style.display = 'flex';
    const subtotal = state.subtotal;

    if (subtotal >= threshold) {
      textEl.textContent = '🎉 Parabéns! Você ganhou Frete Grátis!';
      barEl.style.width = '100%';
    } else {
      const remaining = threshold - subtotal;
      const pct = Math.min(100, Math.round((subtotal / threshold) * 100));
      textEl.textContent = `Faltam ${formatCurrency(remaining)} para Frete Grátis!`;
      barEl.style.width = `${pct}%`;
    }
  }

  /* ==========================================================================
     Tema Claro / Escuro
     ========================================================================== */
  setupTheme() {
    const savedTheme = localStorage.getItem('marmita_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    this.updateThemeIcon(savedTheme);

    const toggleBtn = document.getElementById('btn-theme-toggle');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('marmita_theme', next);
        this.updateThemeIcon(next);
      });
    }
  }

  updateThemeIcon(theme) {
    const icon = document.getElementById('theme-icon');
    if (icon) {
      icon.textContent = theme === 'dark' ? '☀️' : '🌙';
    }
  }

  /* ==========================================================================
     Modais (Configurações e Entrega)
     ========================================================================== */
  setupModals() {
    const modalSettings = document.getElementById('modal-settings');
    const modalDelivery = document.getElementById('modal-delivery');

    // Abre modal de configurações
    const btnOpenSettings = document.getElementById('btn-open-settings');
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener('click', () => {
        this.openSettingsModal();
      });
    }

    // Fechar modais ao clicar no X ou fora
    document.querySelectorAll('.btn-close-modal, .btn-modal-cancel').forEach(btn => {
      btn.addEventListener('click', () => {
        if (modalSettings) modalSettings.style.display = 'none';
        if (modalDelivery) modalDelivery.style.display = 'none';
      });
    });

    window.addEventListener('click', (e) => {
      if (e.target === modalSettings) modalSettings.style.display = 'none';
      if (e.target === modalDelivery) modalDelivery.style.display = 'none';
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (modalSettings) modalSettings.style.display = 'none';
        if (modalDelivery) modalDelivery.style.display = 'none';
      }
    });

    // Formulario de Configuracoes
    const formSettings = document.getElementById('form-settings');
    if (formSettings) {
      formSettings.addEventListener('submit', (e) => {
        e.preventDefault();
        this.saveSettings();
      });
    }

    // Botao Limpar Dados
    const btnClearAll = document.getElementById('btn-clear-all-data');
    if (btnClearAll) {
      btnClearAll.addEventListener('click', () => {
        if (confirm('Deseja limpar todos os dados salvos em memória, histórico e chave de API?')) {
          this.llmManager.clearStoredData();
          this.cartStore.clearCart();
          this.agent.clearHistory();
          document.getElementById('api-key-input').value = '';
          alert('Dados limpos com sucesso.');
          if (modalSettings) modalSettings.style.display = 'none';
        }
      });
    }

    // Formulario de Entrega
    const formDelivery = document.getElementById('form-delivery');
    if (formDelivery) {
      formDelivery.addEventListener('submit', (e) => {
        e.preventDefault();
        const bairro = document.getElementById('delivery-bairro-select').value;
        const endereco = document.getElementById('delivery-address-input').value.trim();

        if (!endereco) {
          alert('Por favor, informe a rua e o número.');
          return;
        }

        this.cartStore.setDelivery(bairro, endereco);
        modalDelivery.style.display = 'none';

        // Dispara mensagem de confirmação no chat
        this.handleUserMessage(`Meu endereço é ${endereco}, no bairro ${bairro}. Confirmar pedido!`);
      });
    }

    // Popular bairros no select de entrega
    this.populateNeighborhoodsSelect();
  }

  populateNeighborhoodsSelect() {
    const select = document.getElementById('delivery-bairro-select');
    if (!select || !this.configData?.delivery?.neighborhoods) return;

    select.innerHTML = '';
    for (const nb of this.configData.delivery.neighborhoods) {
      const opt = document.createElement('option');
      opt.value = nb.name;
      opt.textContent = `${nb.name} (${formatCurrency(nb.fee)})`;
      select.appendChild(opt);
    }
  }

  openSettingsModal() {
    const modal = document.getElementById('modal-settings');
    const modeSelect = document.getElementById('llm-mode-select');
    const keyInput = document.getElementById('api-key-input');
    const modelSelect = document.getElementById('model-select');
    const keyGroup = document.getElementById('api-key-group');

    if (!modal) return;

    modeSelect.value = this.llmManager.getMode();
    keyInput.value = this.llmManager.apiKey || '';
    modelSelect.value = this.llmManager.model;

    const updateKeyVisibility = () => {
      keyGroup.style.display = modeSelect.value === 'gemini' ? 'flex' : 'none';
    };

    modeSelect.onchange = updateKeyVisibility;
    updateKeyVisibility();

    modal.style.display = 'flex';
  }

  saveSettings() {
    const modeSelect = document.getElementById('llm-mode-select');
    const keyInput = document.getElementById('api-key-input');
    const modelSelect = document.getElementById('model-select');
    const modal = document.getElementById('modal-settings');

    const chosenMode = modeSelect.value;
    const key = keyInput.value.trim();
    const model = modelSelect.value;

    this.llmManager.setMode(chosenMode);
    this.llmManager.saveApiKey(key);
    this.llmManager.setModel(model);

    // Atualiza badge de modo no header
    const badge = document.getElementById('header-mode-badge');
    if (badge) {
      if (chosenMode === 'gemini') {
        badge.textContent = `Gemini (${model})`;
      } else if (chosenMode === 'webllm') {
        badge.textContent = 'WebLLM Local';
      } else {
        badge.textContent = 'Modo Offline (C)';
      }
    }

    modal.style.display = 'none';
    this.chatUI.appendSystemNotice(`Configurações salvas: Modo ${chosenMode.toUpperCase()} ativado.`);
  }

  openDeliveryModal() {
    const modal = document.getElementById('modal-delivery');
    if (!modal) return;
    modal.style.display = 'flex';
  }

  /* ==========================================================================
     Simulador de Cardápio por Dia da Semana
     ========================================================================== */
  setupDaySelector() {
    const daySelect = document.getElementById('day-of-week-select');
    if (!daySelect) return;

    daySelect.value = this.cartStore.currentDay;
    daySelect.addEventListener('change', () => {
      const selectedDay = daySelect.value;
      this.cartStore.setDay(selectedDay);
      this.chatUI.appendSystemNotice(`Cardápio alternado para ${selectedDay.toUpperCase()}. Digite "ver cardápio" para conferir os pratos disponíveis hoje!`);
    });
  }
}

// Inicializa a aplicação quando o DOM estiver pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    const app = new App();
    app.init();
  });
} else {
  const app = new App();
  app.init();
}
