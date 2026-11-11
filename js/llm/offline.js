/**
 * Provedor Modo C: Motor Offline Determinístico Baseado em Regras e NLP Leve.
 * Garante que a aplicação funcione 100% mesmo sem internet, sem chave de API e sem custos.
 */

import { normalizeString } from '../cart/pricing.js';

export class OfflineProvider {
  constructor(cartStore) {
    this.cartStore = cartStore;
  }

  /**
   * Processa a mensagem do usuario deterministica e localmente.
   * @param {string} systemPrompt Prompt de sistema (para compatibilidade de interface)
   * @param {string} userMessage Texto da mensagem do usuario
   * @returns {Promise<object>} Objeto compativel com ORDER_AGENT_SCHEMA
   */
  async generateResponse(systemPrompt, userMessage) {
    // Remove delimitadores de isolamento caso recebidos do orquestrador
    const cleanMsg = (userMessage || '')
      .replace(/<\/?user_data>/gi, '')
      .trim();
    const norm = normalizeString(cleanMsg);

    // 1. Intencao de Listar Cardapio
    if (this.isMenuIntent(norm)) {
      return {
        intent: 'listar_cardapio',
        mensagem_ao_usuario: 'Aqui está o nosso cardápio de hoje! Escolha os pratos e nos informe a quantidade:'
      };
    }

    // 2. Intencao de Ver Carrinho / Resumo
    if (this.isCartIntent(norm)) {
      return {
        intent: 'ver_carrinho',
        mensagem_ao_usuario: 'Aqui está o resumo atual do seu pedido:'
      };
    }

    // 3. Intencao de Cancelar / Limpar Carrinho
    if (this.isCancelIntent(norm)) {
      return {
        intent: 'cancelar_pedido',
        mensagem_ao_usuario: 'Seu pedido foi cancelado e o carrinho esvaziado. Se desejar recomeçar, é só pedir o cardápio!'
      };
    }

    // 4. Intencao de Confirmar / Finalizar Pedido
    if (this.isConfirmIntent(norm)) {
      return {
        intent: 'confirmar_pedido',
        mensagem_ao_usuario: 'Perfeito! Vamos finalizar o seu pedido.'
      };
    }

    // 5. Intencao de Entrega / Endereco
    const deliveryData = this.extractDeliveryData(cleanMsg);
    if (deliveryData) {
      return {
        intent: 'definir_entrega',
        delivery: deliveryData,
        mensagem_ao_usuario: `Endereço anotado: ${deliveryData.endereco || ''} (${deliveryData.bairro || 'Bairro pendente'}).`
      };
    }

    // 6. Intencao de Remocao
    if (this.isRemoveIntent(norm)) {
      const removedItems = this.extractItems(norm);
      if (removedItems.length > 0) {
        return {
          intent: 'remover_item',
          items: removedItems,
          mensagem_ao_usuario: `Item removido do seu carrinho com sucesso.`
        };
      }
    }

    // 7. Intencao de Adicionar Itens
    const extractedItems = this.extractItems(cleanMsg);
    if (extractedItems.length > 0) {
      return {
        intent: 'adicionar_item',
        items: extractedItems,
        mensagem_ao_usuario: 'Prato(s) adicionado(s) com sucesso ao seu pedido!'
      };
    }

    // 8. Checagem de ambiguidade
    const ambiguousCheck = this.checkAmbiguity(norm);
    if (ambiguousCheck) {
      return ambiguousCheck;
    }

    // 9. Duvidas gerais ou fora de escopo
    if (this.isGreeting(norm)) {
      return {
        intent: 'tirar_duvida',
        mensagem_ao_usuario: 'Olá! Seja muito bem-vindo à Marmitaria Sabor de Casa! O que você gostaria de almoçar hoje?'
      };
    }

    return {
      intent: 'tirar_duvida',
      mensagem_ao_usuario: 'Não compreendi perfeitamente. Você pode escolher um item do cardápio, digitar "ver cardápio" ou informar o que gostaria de pedir!'
    };
  }

  isMenuIntent(text) {
    const triggers = ['cardapio', 'menu', 'opcoes', 'o que tem', 'pratos', 'ver opcoes', 'marmitas de hoje'];
    return triggers.some(t => text.includes(t));
  }

  isCartIntent(text) {
    const triggers = ['carrinho', 'meu pedido', 'ver pedido', 'quanto ta', 'como esta', 'resumo'];
    return triggers.some(t => text.includes(t));
  }

  isCancelIntent(text) {
    const triggers = ['cancelar', 'limpar carrinho', 'esvaziar', 'desistir', 'limpar pedido'];
    return triggers.some(t => text.includes(t));
  }

  isConfirmIntent(text) {
    const triggers = ['confirmar', 'fechar pedido', 'finalizar', 'concluir', 'pode fechar', 'sim, confirmar', 'quero pedir'];
    return triggers.some(t => text.includes(t));
  }

  isRemoveIntent(text) {
    const triggers = ['remover', 'tirar', 'retirar', 'cancela o', 'excluir'];
    return triggers.some(t => text.includes(t));
  }

  isGreeting(text) {
    const greetings = ['ola', 'oi', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'e ai'];
    return greetings.some(g => text === g || text.startsWith(g + ' '));
  }

  extractDeliveryData(text) {
    const norm = normalizeString(text);
    const hasAddressWord = ['rua', 'av', 'avenida', 'alameda', 'travessa', 'praca', 'entrega', 'entregar em'].some(w => norm.includes(w));
    if (!hasAddressWord) return null;

    let bairro = null;
    let endereco = text.trim();

    // Tenta encontrar bairro conhecido no texto
    const neighborhoods = this.cartStore.configData?.delivery?.neighborhoods || [];
    for (const nb of neighborhoods) {
      if (norm.includes(normalizeString(nb.name))) {
        bairro = nb.name;
        break;
      }
      if (Array.isArray(nb.aliases)) {
        for (const al of nb.aliases) {
          if (norm.includes(normalizeString(al))) {
            bairro = nb.name;
            break;
          }
        }
      }
    }

    return {
      bairro: bairro || 'Centro',
      endereco: endereco
    };
  }

  extractItems(text) {
    const norm = normalizeString(text);
    const available = this.cartStore.getAvailableItemsToday();
    const items = [];

    // Mapeamento de sinonimos comuns de pratos
    const itemAliases = {
      'bife-acebolado': ['bife', 'alcatra', 'acebolado', 'bife acebolado'],
      'frango-grelhado': ['frango', 'frango grelhado', 'peito de frango'],
      'feijoada-completa': ['feijoada', 'feijuca'],
      'strogonoff-frango': ['strogonoff', 'estrogonofe'],
      'peixe-grelhado': ['peixe', 'tilapia'],
      'lasanha-bolonhesa': ['lasanha', 'bolonhesa'],
      'guarana-lata': ['guarana', 'refrigerante', 'refri'],
      'coca-zero': ['coca', 'coca zero', 'coca-cola'],
      'suco-laranja': ['suco', 'suco de laranja', 'laranja'],
      'pudim-leite': ['pudim', 'sobremesa']
    };

    // Palavras numericas em PT-BR
    const wordNumbers = {
      'um': 1, 'uma': 1, 'dois': 2, 'duas': 2, 'tres': 3,
      'quatro': 4, 'cinco': 5, 'seis': 6, 'dez': 10
    };

    for (const item of available) {
      const aliases = itemAliases[item.id] || [item.id, normalizeString(item.nome)];
      let matchedAlias = null;

      for (const alias of aliases) {
        if (norm.includes(normalizeString(alias))) {
          matchedAlias = alias;
          break;
        }
      }

      if (matchedAlias) {
        // Tenta extrair a quantidade associada ao item
        let qty = 1;

        // Procura digito numerico antes ou proximo ao alias (ex: "2 bife" ou "bife 2")
        const regexDigit = new RegExp(`(\\d+)\\s*(?:x|de)?\\s*${matchedAlias}|${matchedAlias}\\s*(\\d+)`, 'i');
        const matchDigit = norm.match(regexDigit);
        if (matchDigit) {
          const foundNum = parseInt(matchDigit[1] || matchDigit[2], 10);
          if (foundNum > 0) qty = foundNum;
        } else {
          // Procura numero por extenso (ex: "dois bifes")
          for (const [word, val] of Object.entries(wordNumbers)) {
            const regexWord = new RegExp(`\\b${word}\\b\\s*(?:de)?\\s*${matchedAlias}`, 'i');
            if (regexWord.test(norm)) {
              qty = val;
              break;
            }
          }
        }

        // Extrai personalizacoes permitidas
        const personalizacoes = [];
        const allowed = item.personalizacoes_permitidas || [];
        for (const p of allowed) {
          if (norm.includes(normalizeString(p))) {
            personalizacoes.push(p);
          }
        }

        items.push({
          id: item.id,
          quantidade: qty,
          personalizacoes,
          observacoes: ''
        });
      }
    }

    return items;
  }

  checkAmbiguity(text) {
    const available = this.cartStore.getAvailableItemsToday();
    const bifeItems = available.filter(i => normalizeString(i.nome).includes('bife'));
    if (text === 'bife' || text === 'quero bife' || text === '1 bife') {
      if (bifeItems.length > 1) {
        return {
          intent: 'esclarecer_ambiguidade',
          termo_ambiguo: 'bife',
          mensagem_ao_usuario: `Temos mais de uma opção com bife hoje: ${bifeItems.map(i => i.nome).join(' ou ')}. Qual delas você prefere?`
        };
      }
    }
    return null;
  }
}
