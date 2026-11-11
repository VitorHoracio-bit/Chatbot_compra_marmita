/**
 * Agente Orquestrador de Vendas e Tool Calling.
 * Coordena os guardrails de entrada, integracao de LLM com retry, validacao de saida
 * e execucao deterministica de regras de negocio na CartStore.
 */

import { RateLimiter, validateUserInput } from '../guardrails/input.js';
import { validateAndSanitizeLLMOutput } from '../guardrails/output.js';
import { buildSystemPrompt, wrapUserData } from './prompts.js';
import { formatCurrency } from '../cart/pricing.js';

export class MarmitaAgent {
  /**
   * @param {object} cartStore Instancia de CartStore
   * @param {object} llmManager Instancia de LLMProviderManager
   * @param {object} configData Configuracoes gerais
   */
  constructor(cartStore, llmManager, configData = {}) {
    this.cartStore = cartStore;
    this.llmManager = llmManager;
    this.configData = configData;

    const rateLimit = configData?.limits?.rate_limit_per_minute ?? 10;
    this.rateLimiter = new RateLimiter(rateLimit);
    this.history = [];
  }

  clearHistory() {
    this.history = [];
    this.rateLimiter.reset();
  }

  /**
   * Ponto de entrada principal para interacao do cliente.
   * @param {string} userRawMessage Mensagem bruta digitada pelo usuario
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
    // 1. Guardrail de Entrada (Pre-LLM)
    const inputValidation = validateUserInput(userRawMessage, this.rateLimiter, this.configData);
    if (!inputValidation.valid) {
      return {
        text: inputValidation.userMessage || 'Mensagem não permitida.',
        intent: 'bloqueado_guardrail',
        actions: []
      };
    }

    const sanitizedInput = inputValidation.sanitizedText;

    // 2. Montagem de Contexto e Delimitacao
    const systemPrompt = buildSystemPrompt(this.cartStore);
    const wrappedUser = wrapUserData(sanitizedInput);

    // 3. Execucao no LLM com retry (ate 2 tentativas se JSON vier invalido)
    let llmResult = null;
    let providerInfo = null;
    let attempts = 0;
    const maxAttempts = 2;

    while (attempts < maxAttempts) {
      attempts++;
      try {
        const response = await this.llmManager.generateResponse(
          systemPrompt,
          wrappedUser,
          this.history
        );

        providerInfo = response;
        llmResult = response.result;
        break;
      } catch (err) {
        console.warn(`Tentativa ${attempts} de chamada ao LLM falhou:`, err.message);
        if (attempts >= maxAttempts) {
          // Fallback final para modo offline
          const fallback = await this.llmManager.offlineProvider.generateResponse(systemPrompt, sanitizedInput);
          llmResult = fallback;
          providerInfo = { providerUsed: 'offline', fallbackApplied: true, warning: 'Alternado para modo offline por segurança.' };
        }
      }
    }

    // 4. Guardrail de Saida (Pos-LLM)
    const sanitizedOutput = validateAndSanitizeLLMOutput(llmResult, this.cartStore);
    const structuredAction = sanitizedOutput.output;

    // 5. Execucao Deterministica da Acao na CartStore
    const executionResult = this.executeIntent(structuredAction, sanitizedOutput.sanitizedMessage);

    // 6. Atualiza historico com mensagens sanitizadas
    this.history.push({ role: 'user', text: sanitizedInput });
    this.history.push({ role: 'assistant', text: executionResult.text });
    if (this.history.length > 8) {
      this.history = this.history.slice(-8);
    }

    return {
      text: executionResult.text,
      intent: structuredAction.intent,
      actions: executionResult.actions || [],
      warning: providerInfo?.warning,
      requiresDelivery: executionResult.requiresDelivery,
      whatsappUrl: executionResult.whatsappUrl
    };
  }

  /**
   * Executa a regra de negocio correspondente a intencao de forma 100% deterministica.
   * Todos os valores e resumos sao construidos por codigo em JS.
   */
  executeIntent(action, fallbackUserMessage) {
    const intent = action.intent;
    const state = this.cartStore.getState();

    switch (intent) {
      case 'listar_cardapio': {
        const available = this.cartStore.getAvailableItemsToday();
        let msg = `📅 *CARDÁPIO DE HOJE (${this.cartStore.currentDay.toUpperCase()}):*\n\n`;

        // Agrupa por categoria
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
        }

        const updatedState = this.cartStore.getState();
        messages.push(`\n🛒 *Subtotal atual:* ${updatedState.subtotalFormatted} (${updatedState.itemCount} itens)`);
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
          messages.push(remRes.message);
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
          messages.push(updRes.message);
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

        let msg = `📍 ${res.message}\n`;
        msg += `🛒 *Total com entrega:* ${updated.totalFormatted}\n\n`;
        msg += 'Tudo certo para você? Digite "confirmar" para finalizar seu pedido!';

        return { text: msg, actions: ['delivery_set'] };
      }

      case 'confirmar_pedido': {
        const confRes = this.cartStore.confirmOrder();
        if (!confRes.success) {
          return {
            text: `⚠️ ${confRes.message}`,
            requiresDelivery: confRes.requiresDelivery,
            actions: ['confirm_failed']
          };
        }

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
        this.cartStore.clearCart();
        return {
          text: 'Seu pedido foi cancelado e o carrinho foi limpo. Quando quiser começar de novo, é só me chamar!',
          actions: ['order_cancelled']
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
