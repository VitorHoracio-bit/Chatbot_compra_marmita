/**
 * Agente Orquestrador de Vendas do Chatbot.
 * 100% Determinístico e Local, sem dependências de LLMs ou chamadas a APIs externas.
 * Coordena os guardrails de entrada, o motor de diálogo local, o monitoramento em tempo real
 * e a execução determinística de regras de negócio na CartStore.
 */

import { RateLimiter, validateUserInput } from '../guardrails/input.js';
import { validateAndSanitizeOutput } from '../guardrails/output.js';
import { LocalDialogueEngine } from './dialogue.js';
import { formatCurrency, normalizeString } from '../cart/pricing.js';
import { monitorService } from '../monitor/monitor.js';

export class MarmitaAgent {
  /**
   * @param {object} cartStore Instância de CartStore
   * @param {object} configData Configurações gerais
   */
  constructor(cartStore, configData = {}) {
    this.cartStore = cartStore;
    this.configData = configData;
    this.dialogueEngine = new LocalDialogueEngine(cartStore);

    const rateLimit = configData?.limits?.rate_limit_per_minute ?? 20;
    this.rateLimiter = new RateLimiter(rateLimit);
    this.history = [];
    // Aguarda a escolha do usuario quando o mesmo produto tem varias linhas.
    this.pendingLineSelection = null;
  }

  clearHistory() {
    this.history = [];
    this.pendingLineSelection = null;
    this.rateLimiter.reset();
    monitorService.logEvent('info', 'Conversa', 'Histórico interno do agente foi limpo.');
  }

  /**
   * Ponto de entrada principal para interação do cliente.
   * @param {string} userRawMessage Mensagem bruta digitada pelo usuário
   * @returns {Promise<{
   *   text: string,
   *   intent: string,
   *   actions: Array<object>,
   *   warning?: string,
   *   requiresDelivery?: boolean,
   *   whatsappUrl?: string
   * }>}
   */
  async handleUserMessage(userRawMessage) {
    const startTime = performance.now();

    // Registra entrada no monitoramento
    monitorService.recordUserMessage(userRawMessage);

    // 1. Guardrail de Entrada
    const inputValidation = validateUserInput(userRawMessage, this.rateLimiter, this.configData);
    if (!inputValidation.valid) {
      const refusalText = inputValidation.userMessage || 'Mensagem não permitida.';
      const durationMs = performance.now() - startTime;

      monitorService.recordProcessing(durationMs, 'bloqueado_guardrail', {
        reason: inputValidation.reason || 'Guardrail de entrada acionado'
      });
      monitorService.recordBotResponse(refusalText, 'bloqueado_guardrail');

      return {
        text: refusalText,
        intent: 'bloqueado_guardrail',
        actions: []
      };
    }

    const sanitizedInput = inputValidation.sanitizedText;

    // Resposta a uma pergunta anterior de selecao de linha no carrinho.
    const pendingResult = this.tryResolvePendingSelection(sanitizedInput);
    if (pendingResult) {
      const durationMs = performance.now() - startTime;
      monitorService.recordProcessing(durationMs, pendingResult.intent, {
        actions: pendingResult.actions
      });
      monitorService.recordBotResponse(pendingResult.text, pendingResult.intent);

      this.history.push({ role: 'user', text: sanitizedInput });
      this.history.push({ role: 'assistant', text: pendingResult.text });
      if (this.history.length > 12) this.history = this.history.slice(-12);

      return pendingResult;
    }

    try {
      // 2. Processamento Local e Determinístico via LocalDialogueEngine
      const rawDialogueResult = await this.dialogueEngine.generateResponse(sanitizedInput);

      // 3. Validação e Sanitização da Saída
      const sanitizedOutput = validateAndSanitizeOutput(rawDialogueResult, this.cartStore);
      const structuredAction = sanitizedOutput.output;

      // 4. Execução Determinística da Ação na CartStore
      const executionResult = this.executeIntent(structuredAction, sanitizedOutput.sanitizedMessage);
      const durationMs = performance.now() - startTime;

      // 5. Registra processamento e resposta no monitoramento
      monitorService.recordProcessing(durationMs, structuredAction.intent, {
        actions: executionResult.actions
      });
      monitorService.recordBotResponse(executionResult.text, structuredAction.intent);

      // 6. Atualiza histórico local
      this.history.push({ role: 'user', text: sanitizedInput });
      this.history.push({ role: 'assistant', text: executionResult.text });
      if (this.history.length > 12) {
        this.history = this.history.slice(-12);
      }

      return {
        text: executionResult.text,
        intent: structuredAction.intent,
        actions: executionResult.actions || [],
        requiresDelivery: executionResult.requiresDelivery,
        whatsappUrl: executionResult.whatsappUrl
      };
    } catch (err) {
      console.error('Erro no processamento do agente:', err);
      monitorService.recordError('Agente', err);

      const errorText = `Ops! Ocorreu um problema ao processar sua solicitação: ${err.message}.`;
      monitorService.recordBotResponse(errorText, 'erro');

      return {
        text: errorText,
        intent: 'erro',
        actions: []
      };
    }
  }

  /**
   * Interpreta a resposta do cliente a uma solicitacao de selecao de linha.
   * Aceita o numero da opcao ou um trecho da descricao da configuracao.
   * @private
   */
  tryResolvePendingSelection(userText) {
    const pending = this.pendingLineSelection;
    if (!pending) return null;

    const norm = normalizeString(userText).trim();
    let selected = null;

    if (/^\d+$/.test(norm)) {
      selected = pending.options[parseInt(norm, 10) - 1] || null;
    } else {
      const matches = pending.options.filter(option => {
        const label = normalizeString(option.label);
        if (!label) return false;
        return norm === label
          || norm.includes(label)
          || (norm.length >= 3 && label.includes(norm));
      });
      if (matches.length === 1) selected = matches[0];
    }

    // Resposta nao relacionada: abandona a selecao e segue o fluxo normal.
    if (!selected) {
      this.pendingLineSelection = null;
      return null;
    }

    this.pendingLineSelection = null;
    let res;
    if (pending.operation === 'remover') {
      res = this.cartStore.removeItem(pending.itemId, pending.quantity, selected.lineKey);
    } else {
      res = this.cartStore.updateQuantity(pending.itemId, pending.quantity, selected.lineKey);
    }

    monitorService.logEvent('cart', 'Carrinho', res.message, {
      item: pending.itemId,
      lineKey: selected.lineKey
    });

    const state = this.cartStore.getState();
    return {
      text: `${res.message}\n\n🛒 *Subtotal atual:* ${state.subtotalFormatted} (${state.itemCount} itens)`,
      intent: 'selecao_linha',
      actions: ['line_selected']
    };
  }

  /**
   * Aplica dados de entrega que vieram junto de outra intencao (ex.: adicionar
   * produto e informar endereco na mesma mensagem).
   * @private
   * @returns {string} Linha adicional para a resposta ou string vazia.
   */
  applyDeliveryFromAction(action) {
    const delivery = action?.delivery;
    if (!delivery || (!delivery.bairro && !delivery.endereco)) return '';

    const res = this.cartStore.setDelivery(delivery.bairro, delivery.endereco);
    monitorService.logEvent(
      'cart',
      'Entrega',
      `Endereço registrado: ${res.delivery.endereco || 'pendente'} (${res.delivery.bairro || 'pendente'})`
    );
    return `📍 ${res.message}`;
  }

  /**
   * Monta a mensagem numerada e guarda o estado pendente de selecao.
   * @private
   */
  requestLineSelection(selection, operation, quantity = null) {
    this.pendingLineSelection = {
      itemId: selection.itemId,
      options: selection.options,
      operation,
      quantity
    };

    const lines = selection.options.map((option, index) => {
      const details = option.label === 'Sem personalizações'
        ? 'sem personalizações'
        : option.label;
      return `${index + 1}) ${option.quantidade}x — ${details}`;
    });

    return [
      'Você tem mais de uma configuração deste item no carrinho:',
      ...lines,
      '',
      'Responda com o número da opção que deseja alterar (ou use os controles do carrinho).'
    ].join('\n');
  }

  /**
   * Executa a regra de negócio correspondente à intenção de forma 100% determinística.
   * Todos os valores, itens e resumos são construídos por código determinístico em JS.
   */
  executeIntent(action, fallbackUserMessage) {
    const intent = action.intent;
    const state = this.cartStore.getState();

    switch (intent) {
      case 'listar_cardapio': {
        const available = this.cartStore.getAvailableItemsToday();
        let msg = `📅 *CARDÁPIO DE HOJE (${this.cartStore.currentDay.toUpperCase()}):*\n\n`;

        const categorias = { marmita: '🍱 Marmitas do Dia', bebida: '🥤 Bebidas', sobremesa: '🍮 Sobremesas' };
        for (const [catKey, catTitle] of Object.entries(categorias)) {
          const itemsCat = available.filter(i => i.categoria === catKey);
          if (itemsCat.length > 0) {
            msg += `*${catTitle}*\n`;
            for (const item of itemsCat) {
              const estoque = item.estoque_do_dia !== undefined ? ` (Restam ${item.estoque_do_dia})` : '';
              msg += `• *${item.nome}* — ${formatCurrency(item.preco_unitario)}${estoque}\n  ${item.descricao}\n`;
            }
            msg += '\n';
          }
        }
        msg += 'Para pedir, é só me dizer o que deseja e a quantidade! (Ex.: "quero 1 bife bem passado e 1 guaraná")';
        return { text: msg, actions: ['menu_listed'] };
      }

      case 'adicionar_item': {
        if (!Array.isArray(action.items) || action.items.length === 0) {
          return { text: 'Qual prato e quantidade você gostaria de adicionar ao seu pedido?', actions: [] };
        }

        const messages = [];
        const actions = [];

        for (const item of action.items) {
          const addRes = this.cartStore.addItem({
            itemId: item.id,
            quantidade: item.quantidade || 1,
            personalizacoes: item.personalizacoes || [],
            observacoes: item.observacoes || ''
          });

          messages.push(addRes.message);
          actions.push({ item: item.id, success: addRes.success });
          monitorService.logEvent('cart', 'Carrinho', addRes.message, { item: item.id, success: addRes.success });
        }

        const updatedState = this.cartStore.getState();
        messages.push(`\n🛒 *Subtotal atual:* ${updatedState.subtotalFormatted} (${updatedState.itemCount} itens)`);

        // Mensagem combinada: produtos + endereco de entrega na mesma frase.
        const deliveryApplied = this.applyDeliveryFromAction(action);
        if (deliveryApplied) messages.push(deliveryApplied);

        messages.push('Deseja algo mais ou quer informar o endereço para entrega?');

        return { text: messages.join('\n'), actions };
      }

      case 'remover_item': {
        if (!Array.isArray(action.items) || action.items.length === 0) {
          return { text: 'Qual prato você deseja retirar do seu pedido?', actions: [] };
        }

        const messages = [];
        for (const item of action.items) {
          const remRes = this.cartStore.removeItem(item.id, item.quantidade);
          if (remRes.requiresLineSelection) {
            messages.push(this.requestLineSelection(remRes, 'remover', item.quantidade));
            continue;
          }
          messages.push(remRes.message);
          monitorService.logEvent('cart', 'Carrinho', remRes.message, { item: item.id });
        }

        const updatedState = this.cartStore.getState();
        messages.push(`\n🛒 *Subtotal atual:* ${updatedState.subtotalFormatted} (${updatedState.itemCount} itens)`);

        return { text: messages.join('\n'), actions: ['item_removed'] };
      }

      case 'alterar_item': {
        if (!Array.isArray(action.items) || action.items.length === 0) {
          return { text: 'Qual item e para qual quantidade você gostaria de alterar?', actions: [] };
        }

        const messages = [];
        for (const item of action.items) {
          const updRes = this.cartStore.updateQuantity(item.id, item.quantidade);
          if (updRes.requiresLineSelection) {
            messages.push(this.requestLineSelection(updRes, 'alterar', item.quantidade));
            continue;
          }
          messages.push(updRes.message);
          monitorService.logEvent('cart', 'Carrinho', updRes.message, { item: item.id, quantidade: item.quantidade });
        }

        const updatedState = this.cartStore.getState();
        messages.push(`\n🛒 *Subtotal atual:* ${updatedState.subtotalFormatted}`);
        return { text: messages.join('\n'), actions: ['item_updated'] };
      }

      case 'ver_carrinho': {
        if (state.items.length === 0) {
          return {
            text: 'Seu carrinho está vazio no momento. Que tal escolher uma das nossas marmitas de hoje? Digite "ver cardápio" para ver as opções!',
            actions: ['cart_empty']
          };
        }

        let msg = '🛒 *SEU PEDIDO ATUAL:*\n\n';
        for (const item of state.items) {
          msg += `• ${item.quantidade}x ${item.nome} (${formatCurrency(item.preco_unitario * item.quantidade)})\n`;
          if (item.personalizacoes?.length > 0) {
            msg += `   └ Preferências: ${item.personalizacoes.join(', ')}\n`;
          }
          if (item.observacoes) {
            msg += `   └ Obs: ${item.observacoes}\n`;
          }
        }
        msg += `\n*Subtotal:* ${state.subtotalFormatted}\n`;
        msg += `*Taxa de Entrega:* ${state.deliveryFeeFormatted}\n`;
        msg += `*Total:* ${state.totalFormatted}\n`;

        if (state.delivery.endereco) {
          msg += `📍 *Entrega:* ${state.delivery.endereco} (${state.delivery.bairro})\n`;
        } else {
          msg += '📍 *Entrega:* Endereço ainda não informado.\n';
        }

        msg += '\nPara prosseguir, informe seu endereço de entrega ou digite "confirmar pedido"!';
        return { text: msg, actions: ['cart_viewed'] };
      }

      case 'definir_entrega': {
        const bairro = action.delivery?.bairro;
        const endereco = action.delivery?.endereco;

        const res = this.cartStore.setDelivery(bairro, endereco);
        const updated = this.cartStore.getState();

        monitorService.logEvent('cart', 'Entrega', `Endereço registrado: ${res.delivery.endereco || 'pendente'} (${res.delivery.bairro || 'pendente'})`);

        let msg = `📍 ${res.message}\n`;
        msg += `🛒 *Total com entrega:* ${updated.totalFormatted}\n\n`;
        msg += 'Tudo certo para você? Digite "confirmar" para finalizar seu pedido!';

        return { text: msg, actions: ['delivery_set'] };
      }

      case 'confirmar_pedido': {
        // Permite "Entregar na Rua X, 123 no Centro. Confirmar pedido!".
        this.applyDeliveryFromAction(action);

        const confRes = this.cartStore.confirmOrder();
        if (!confRes.success) {
          monitorService.logEvent('cart', 'Confirmação', `Tentativa de confirmação falhou: ${confRes.message}`);

          if (confRes.alreadyConfirmed) {
            let alreadyMsg = `ℹ️ ${confRes.message}`;
            if (confRes.orderText) {
              alreadyMsg += `\n\n${confRes.orderText}`;
            }
            return {
              text: alreadyMsg,
              whatsappUrl: confRes.whatsappUrl,
              actions: ['order_already_confirmed']
            };
          }

          return {
            text: `⚠️ ${confRes.message}`,
            requiresDelivery: confRes.requiresDelivery,
            actions: ['confirm_failed']
          };
        }

        monitorService.logEvent('cart', 'Confirmação', 'Pedido confirmado com sucesso e estoque atualizado.');

        let msg = `🎉 *PEDIDO CONFIRMADO COM SUCESSO!*\n\n`;
        msg += confRes.orderText;
        msg += `\n\n📲 *Clique abaixo para enviar seu pedido direto pelo WhatsApp:*`;

        return {
          text: msg,
          whatsappUrl: confRes.whatsappUrl,
          actions: ['order_confirmed']
        };
      }

      case 'cancelar_pedido': {
        const cancelRes = this.cartStore.cancelOrder();
        monitorService.logEvent(
          'cart',
          'Cancelamento',
          cancelRes.message
        );
        return {
          text: cancelRes.message,
          actions: [cancelRes.alreadyCancelled ? 'order_already_cancelled' : 'order_cancelled']
        };
      }

      case 'esclarecer_ambiguidade': {
        return {
          text: fallbackUserMessage || 'Temos mais de uma opção correspondente. Poderia especificar qual você prefere?',
          actions: ['ambiguity_clarification']
        };
      }

      case 'fora_de_escopo': {
        return {
          text: 'Desculpe, meu atendimento é exclusivo para pedidos e dúvidas sobre o cardápio da Marmitaria Sabor de Casa! Posso te mostrar o cardápio de hoje?',
          actions: ['out_of_scope_handled']
        };
      }

      case 'tirar_duvida':
      default: {
        return {
          text: fallbackUserMessage || 'Como posso te ajudar com o seu almoço de hoje? Digite "ver cardápio" para ver as opções!',
          actions: ['general_help']
        };
      }
    }
  }
}
