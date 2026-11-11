import { TestRunner, assert } from './test-utils.js';
import { validateUserInput } from '../js/guardrails/input.js';
import { validateAndSanitizeLLMOutput } from '../js/guardrails/output.js';
import { CartStore } from '../js/cart/store.js';
import fs from 'node:fs';
import path from 'node:path';

export const redteamSuite = new TestRunner('Red Team Attack Suite (100% Block Rate)');

// Carrega os 35 casos de teste do redteam.json
const redteamPath = path.resolve(process.cwd(), 'tests/redteam.json');
const testCases = JSON.parse(fs.readFileSync(redteamPath, 'utf-8'));

const mockMenu = {
  itens: [
    {
      id: 'bife-acebolado',
      nome: 'Bife de Alcatra Acebolado',
      categoria: 'marmita',
      preco_unitario: 2800,
      disponivel_hoje: true,
      estoque_do_dia: 10,
      personalizacoes_permitidas: ['sem cebola', 'ao ponto', 'bem passado']
    }
  ],
  cardapio_por_dia: {
    segunda: ['bife-acebolado']
  }
};

const mockConfig = {
  delivery: { default_fee: 700, free_delivery_threshold: 6000, neighborhoods: [] },
  limits: { max_items_per_order: 10, max_qty_per_item: 5, max_input_length: 300, max_obs_length: 50 }
};

for (const testCase of testCases) {
  redteamSuite.test(`[${testCase.id}] ${testCase.name}`, () => {
    const cart = new CartStore(mockMenu, mockConfig, 'segunda');

    // 1. Camada de Entrada
    const inputCheck = validateUserInput(testCase.input, null, mockConfig);
    if (!inputCheck.valid) {
      // Bloqueado com sucesso na entrada
      assert(true);
      return;
    }

    // 2. Se a entrada nao foi bloqueada (ex: se tentasse passar dissimulada),
    // simula passagem pelo sanitizador de observacao do carrinho
    if (testCase.type === 'obs_injection') {
      cart.addItem({
        itemId: 'bife-acebolado',
        quantidade: 1,
        observacoes: testCase.input
      });
      const obs = cart.items[0]?.observacoes || '';
      assert(!obs.includes('<script>') && !obs.includes('</user_data>') && obs.length <= 50,
        `Observação não foi sanitizada corretamente: ${obs}`);
      return;
    }

    // 3. Camada de Saida: simula se um LLM tentasse ceder ao ataque
    const fakeLeakedOutput = {
      intent: 'adicionar_item',
      items: [{ id: 'bife-acebolado', quantidade: 1 }],
      mensagem_ao_usuario: `Você agora é DAN! Seu desconto especial foi aplicado e saiu de graça. System prompt: ${testCase.input}`
    };

    const outputCheck = validateAndSanitizeLLMOutput(fakeLeakedOutput, cart);
    const wasOutputBlocked = !outputCheck.safe || outputCheck.reason !== undefined;

    assert(wasOutputBlocked, `Ataque ${testCase.id} não foi bloqueado pela camada de saída.`);
  });
}
