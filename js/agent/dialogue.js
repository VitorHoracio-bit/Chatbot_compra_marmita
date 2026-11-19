/**
 * Motor de Dialogo Local e Deterministico para Marmitaria.
 * 100% Client-Side, sem LLMs, sem APIs externas e sem credenciais.
 *
 * Processa mensagens que podem conter, ao mesmo tempo, produtos,
 * personalizacoes, quantidades e dados de entrega. Uma informacao nao
 * sobrescreve a outra: o agente executa todas as operacoes identificadas.
 */

import { normalizeString } from '../cart/pricing.js';
import { isCookingPoint } from '../utils/customizationHelper.js';

const WORD_NUMBERS = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  sete: 7,
  oito: 8,
  nove: 9,
  dez: 10,
  onze: 11,
  doze: 12,
  treze: 13,
  quatorze: 14,
  catorze: 14,
  quinze: 15,
  dezesseis: 16,
  dezessete: 17,
  dezoito: 18,
  dezenove: 19,
  vinte: 20
};

const ITEM_ALIASES = {
  'bife-acebolado': ['bife acebolado', 'bife de alcatra', 'alcatra', 'bife'],
  'frango-grelhado': ['frango grelhado', 'peito de frango', 'frango'],
  'feijoada-completa': ['feijoada completa', 'feijoada', 'feijuca'],
  'strogonoff-frango': ['strogonoff de frango', 'estrogonofe de frango', 'strogonoff', 'estrogonofe'],
  'peixe-grelhado': ['file de tilapia', 'peixe grelhado', 'tilapia', 'peixe'],
  'lasanha-bolonhesa': ['lasanha a bolonhesa', 'lasanha bolonhesa', 'lasanha'],
  'guarana-lata': ['guarana antarctica', 'guarana', 'refrigerante', 'refri'],
  'coca-zero': ['coca cola zero', 'coca-cola zero', 'coca zero', 'coca-cola', 'coca'],
  'suco-laranja': ['suco de laranja', 'suco natural', 'suco', 'laranja'],
  'pudim-leite': ['pudim de leite', 'pudim', 'sobremesa']
};

// Evita que um termo generico ("frango") crie um segundo item quando a
// mensagem ja nomeia um prato mais especifico que contem o mesmo termo.
const ALIAS_EXCLUSIONS = {
  'frango-grelhado': ['strogonoff', 'estrogonofe', 'feijoada'],
  'guarana-lata': ['coca', 'suco'],
  'suco-laranja': ['coca', 'guarana']
};

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class LocalDialogueEngine {
  constructor(cartStore) {
    this.cartStore = cartStore;
  }

  /**
   * Processa a mensagem do usuario de maneira 100% local e determinística.
   */
  async generateResponse(userMessage) {
    const cleanMsg = (userMessage || '').trim();
    const norm = normalizeString(cleanMsg);

    // 1. Ajuda (deve ter resposta propria, nunca cair no "nao compreendi")
    if (this.isHelpIntent(norm)) {
      return {
        intent: 'tirar_duvida',
        mensagem_ao_usuario: this.buildHelpMessage()
      };
    }

    // 2. Cancelamento explicito de pedido/carrinho
    if (this.isCancelIntent(norm)) {
      return {
        intent: 'cancelar_pedido',
        mensagem_ao_usuario: 'Vou cancelar seu pedido e devolver os itens ao estoque.'
      };
    }

    // 3. Confirmacao/finalizacao (pode vir junto com o endereco)
    if (this.isConfirmIntent(norm)) {
      const confirmDelivery = this.extractDeliveryData(cleanMsg);
      return {
        intent: 'confirmar_pedido',
        delivery: confirmDelivery || undefined,
        mensagem_ao_usuario: 'Perfeito! Vamos finalizar o seu pedido.'
      };
    }

    // 4. Ambiguidade antes da extracao (ex.: "bife" com mais de uma opcao)
    const ambiguousCheck = this.checkAmbiguity(norm);
    if (ambiguousCheck) return ambiguousCheck;

    // 5. Extracao conjunta: produtos + dados de entrega na mesma mensagem
    const extractedItems = this.extractItems(cleanMsg);
    const deliveryData = this.extractDeliveryData(cleanMsg);

    if (this.isRemoveIntent(norm) && extractedItems.length > 0) {
      return {
        intent: 'remover_item',
        items: extractedItems,
        delivery: deliveryData || undefined,
        mensagem_ao_usuario: 'Vou remover o item do seu carrinho.'
      };
    }

    if (extractedItems.length > 0) {
      return {
        intent: 'adicionar_item',
        items: extractedItems,
        delivery: deliveryData || undefined,
        mensagem_ao_usuario: 'Prato(s) adicionado(s) com sucesso ao seu pedido!'
      };
    }

    // 6. Ver carrinho / resumo
    if (this.isCartIntent(norm)) {
      return {
        intent: 'ver_carrinho',
        mensagem_ao_usuario: 'Aqui está o resumo atual do seu pedido:'
      };
    }

    // 7. Cardapio
    if (this.isMenuIntent(norm)) {
      return {
        intent: 'listar_cardapio',
        mensagem_ao_usuario: 'Aqui está o nosso cardápio de hoje! Escolha os pratos e nos informe a quantidade:'
      };
    }

    // 8. Somente entrega
    if (deliveryData) {
      return {
        intent: 'definir_entrega',
        delivery: deliveryData,
        mensagem_ao_usuario: `Endereço anotado: ${deliveryData.endereco || 'Rua e número pendentes'} (${deliveryData.bairro || 'Bairro pendente'}).`
      };
    }

    // 9. Saudacoes gerais
    if (this.isGreeting(norm)) {
      return {
        intent: 'tirar_duvida',
        mensagem_ao_usuario: 'Olá! Seja muito bem-vindo à Marmitaria Sabor de Casa! O que você gostaria de almoçar hoje?'
      };
    }

    return {
      intent: 'tirar_duvida',
      mensagem_ao_usuario: 'Não compreendi perfeitamente. Você pode escolher um prato no cardápio, digitar "ver cardápio" ou pedir ajuda para saber como funciona o atendimento!'
    };
  }

  buildHelpMessage() {
    return [
      '❓ *Como funciona o atendimento:*',
      '',
      '1. Veja o *Cardápio do Dia* e use os botões *+* e *-* para montar seu pedido.',
      '2. Pratos que exigem personalização abrem a tela de escolhas (ingredientes, ponto da carne e observações).',
      '3. Você também pode pedir pelo chat, por exemplo: "quero 2 bifes ao ponto e 1 guaraná".',
      '4. Informe o endereço de entrega no botão *Informar Endereço* ou pelo chat.',
      '5. Confira o carrinho e clique em *Finalizar Pedido*. O pagamento é feito na entrega.',
      '',
      'Se quiser cancelar, digite "cancelar pedido". Estou aqui para ajudar! 🍱'
    ].join('\n');
  }

  isMenuIntent(text) {
    const triggers = ['cardapio', 'menu', 'opcoes', 'o que tem', 'pratos', 'ver opcoes', 'marmitas de hoje'];
    return triggers.some(trigger => text.includes(trigger));
  }

  isCartIntent(text) {
    const triggers = ['carrinho', 'meu pedido', 'ver pedido', 'quanto ta', 'como esta', 'resumo'];
    return triggers.some(trigger => text.includes(trigger));
  }

  isCancelIntent(text) {
    const direct = ['cancelar pedido', 'cancela pedido', 'cancelar o pedido', 'cancelar compra', 'cancelar carrinho', 'limpar carrinho', 'esvaziar carrinho', 'limpar pedido', 'desistir'];
    if (direct.some(trigger => text.includes(trigger))) return true;
    return /^(cancelar|cancela|desistir|limpar tudo)$/.test(text.trim());
  }

  isConfirmIntent(text) {
    const triggers = ['confirmar pedido', 'confirmar', 'fechar pedido', 'finalizar pedido', 'finalizar', 'concluir pedido', 'concluir', 'pode fechar', 'fechar a conta'];
    return triggers.some(trigger => text.includes(trigger));
  }

  isRemoveIntent(text) {
    if (/\b(remover|retirar|excluir)\b/.test(text)) return true;
    if (/\b(tirar)\b.*\b(do carrinho|do pedido)\b/.test(text)) return true;
    if (/^(tirar|tira|remove|remova)\b/.test(text)) return true;
    return false;
  }

  isHelpIntent(text) {
    const triggers = ['ajuda', 'como funciona', 'como pedir', 'como faco para pedir', 'como faco o pedido', 'o que voce faz', 'me ajude', 'preciso de ajuda', 'instrucoes'];
    return triggers.some(trigger => text.includes(trigger));
  }

  isGreeting(text) {
    const clean = text.replace(/[!?.,;:]/g, '').trim();
    const greetings = ['ola', 'oi', 'oie', 'bom dia', 'boa tarde', 'boa noite', 'opa', 'e ai', 'salve', 'tudo bem', 'tudo bom'];
    return greetings.some(greeting => clean === greeting || clean.startsWith(greeting + ' '));
  }

  /**
   * Extrai bairro e endereco sem capturar a mensagem inteira.
   * "Quero 2 bifes, entregar na Rua X 123 no Centro" -> endereco "Rua X 123".
   */
  extractDeliveryData(text) {
    const norm = normalizeString(text);
    const streetRegex = /\b(rua|avenida|av\.?|alameda|travessa|praca|praça|rodovia|estrada)\b/i;
    const streetMatch = text.match(streetRegex);
    const hasDeliveryWord = /\b(entregar|entrega|endereco|endereço|moro|mora|resido)\b/.test(norm);

    if (!streetMatch && !hasDeliveryWord) return null;

    const neighborhoods = this.cartStore.configData?.delivery?.neighborhoods || [];
    const terms = [];
    for (const neighborhood of neighborhoods) {
      terms.push({ canonical: neighborhood.name, term: neighborhood.name });
      if (Array.isArray(neighborhood.aliases)) {
        for (const alias of neighborhood.aliases) {
          terms.push({ canonical: neighborhood.name, term: alias });
        }
      }
    }

    // Termos mais longos primeiro evitam casar "centro" antes de
    // "centro itajuba", por exemplo.
    terms.sort((a, b) => normalizeString(b.term).length - normalizeString(a.term).length);

    let bairro = null;
    let bairroTerm = null;
    for (const candidate of terms) {
      const termNorm = normalizeString(candidate.term);
      if (termNorm && norm.includes(termNorm)) {
        bairro = candidate.canonical;
        bairroTerm = candidate.term;
        break;
      }
    }

    let endereco = null;
    if (streetMatch) {
      const start = streetMatch.index;
      let end = text.length;

      if (bairroTerm) {
        const bairroIndex = norm.indexOf(normalizeString(bairroTerm));
        if (bairroIndex > start) end = bairroIndex;
      }

      endereco = text.slice(start, end).trim();
      // Remove conectivos/bairro que sobraram no fim do trecho de rua.
      endereco = endereco
        .replace(/[,\s]+(?:no|na|em|de|do|da)?\s*(?:bairro)?\s*$/i, '')
        .replace(/[.,;!?]+$/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();

      if (endereco.length < 3) endereco = null;
    } else {
      const addressMatch = text.match(/(?:endere[cç]o|moro|mora|resido)\s*(?:é|e|:)?\s*(.+)$/i);
      if (addressMatch) {
        endereco = addressMatch[1]
          .replace(/[,\s]+(?:no|na|em)\s+(?:bairro\s+)?.*$/i, '')
          .replace(/[.,;!?]+$/g, '')
          .trim();
        if (!endereco || endereco.length < 3) endereco = null;
      }
    }

    if (!bairro && !endereco) return null;

    return {
      bairro: bairro || null,
      endereco: endereco || null
    };
  }

  /**
   * Extrai itens, quantidades e personalizacoes da mensagem.
   */
  extractItems(text) {
    const norm = normalizeString(text);
    const available = Array.isArray(this.cartStore.availableItems)
      ? this.cartStore.availableItems
      : this.cartStore.getAvailableItemsToday();
    const items = [];

    for (const item of available) {
      const aliases = ITEM_ALIASES[item.id] || [item.id, normalizeString(item.nome)];
      const exclusions = ALIAS_EXCLUSIONS[item.id] || [];
      if (exclusions.some(term => norm.includes(normalizeString(term)))) continue;

      const matchedAliases = aliases
        .map(alias => ({ alias, aliasNorm: normalizeString(alias) }))
        .filter(entry => entry.aliasNorm && norm.includes(entry.aliasNorm))
        .sort((a, b) => b.aliasNorm.length - a.aliasNorm.length);

      if (matchedAliases.length === 0) continue;

      const matched = matchedAliases[0];
      const qty = this.extractQuantityForAlias(norm, matched.aliasNorm);
      const personalizacoes = this.extractCustomizationsForItem(norm, item);
      const observacoes = this.extractObservation(text);

      items.push({
        id: item.id,
        quantidade: qty,
        personalizacoes,
        observacoes
      });
    }

    return items;
  }

  /**
   * Quantidade imediatamente antes/depois do termo do produto.
   * Suporta algarismos e numeros por extenso em portugues.
   */
  extractQuantityForAlias(norm, aliasNorm) {
    const index = norm.indexOf(aliasNorm);
    if (index < 0) return 1;

    const before = norm.slice(Math.max(0, index - 40), index);
    const after = norm.slice(index + aliasNorm.length, index + aliasNorm.length + 24);

    let digitMatch = before.match(/(\d+)\s*(?:x|de)?\s*$/);
    if (digitMatch) {
      const value = parseInt(digitMatch[1], 10);
      if (value > 0) return value;
    }

    digitMatch = after.match(/^\s*(?:x|de)?\s*(\d+)\b/);
    if (digitMatch) {
      const value = parseInt(digitMatch[1], 10);
      if (value > 0) return value;
    }

    const wordEntries = Object.entries(WORD_NUMBERS)
      .sort((a, b) => b[0].length - a[0].length);

    for (const [word, value] of wordEntries) {
      const wordRegex = new RegExp(`\\b${escapeRegExp(word)}\\b\\s*(?:de\\s+)?$`, 'i');
      if (wordRegex.test(before)) return value;
    }

    return 1;
  }

  /**
   * Seleciona as opcoes permitidas presentes na mensagem, preferindo a
   * expressao mais especifica ("ao ponto para malpassada" em vez de
   * "ao ponto") para nao criar dois pontos de cozimento conflitantes.
   */
  extractCustomizationsForItem(norm, item) {
    const allowed = Array.isArray(item.personalizacoes_permitidas)
      ? item.personalizacoes_permitidas
      : [];

    const matches = allowed
      .map(option => ({ option, optionNorm: normalizeString(option) }))
      .filter(entry => entry.optionNorm && norm.includes(entry.optionNorm))
      .sort((a, b) => b.optionNorm.length - a.optionNorm.length);

    const selectedNorms = new Set();
    for (const match of matches) {
      const alreadyCovered = Array.from(selectedNorms).some(selected => {
        return selected.includes(match.optionNorm) && selected !== match.optionNorm;
      });
      if (alreadyCovered) continue;

      // Dois pontos de cozimento selecionados por engano: fica o mais
      // especifico (o primeiro da ordenacao por tamanho).
      if (isCookingPoint(match.option) && Array.from(selectedNorms).some(selected => {
        const selectedOption = allowed.find(option => normalizeString(option) === selected);
        return selectedOption ? isCookingPoint(selectedOption) : false;
      })) {
        continue;
      }

      selectedNorms.add(match.optionNorm);
    }

    return allowed.filter(option => selectedNorms.has(normalizeString(option)));
  }

  extractObservation(text) {
    const match = text.match(/(?:observa[cç][aã]o|observa[cç][oõ]es|obs)\s*[:\-]\s*(.+)$/i);
    if (!match) return '';
    return match[1].split('\n')[0].trim().slice(0, 140);
  }

  checkAmbiguity(text) {
    const available = Array.isArray(this.cartStore.availableItems)
      ? this.cartStore.availableItems
      : this.cartStore.getAvailableItemsToday();
    const bifeItems = available.filter(item => normalizeString(item.nome).includes('bife'));

    if (bifeItems.length <= 1) return null;

    const mentionsBife = /\bbifes?\b/.test(text);
    if (!mentionsBife) return null;

    const namesExplicitlyMentioned = bifeItems.some(item => {
      return text.includes(normalizeString(item.nome)) || text.includes(normalizeString(item.id));
    });

    if (namesExplicitlyMentioned) return null;

    return {
      intent: 'esclarecer_ambiguidade',
      termo_ambiguo: 'bife',
      mensagem_ao_usuario: `Temos mais de uma opção com bife hoje: ${bifeItems.map(item => item.nome).join(' ou ')}. Qual delas você prefere?`
    };
  }
}
