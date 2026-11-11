import { TestRunner, assert, assertEqual } from './test-utils.js';
import { CartStore } from '../js/cart/store.js';

export const cartSuite = new TestRunner('Cart Store Tests');

const mockMenu = {
  itens: [
    {
      id: 'bife-acebolado',
      nome: 'Bife de Alcatra Acebolado',
      categoria: 'marmita',
      preco_unitario: 2800,
      disponivel_hoje: true,
      estoque_do_dia: 5,
      personalizacoes_permitidas: ['sem cebola', 'ao ponto', 'bem passado']
    },
    {
      id: 'feijoada-completa',
      nome: 'Feijoada Completa Tradicional',
      categoria: 'marmita',
      preco_unitario: 3200,
      disponivel_hoje: false,
      estoque_do_dia: 10,
      personalizacoes_permitidas: ['sem couve']
    },
    {
      id: 'guarana-lata',
      nome: 'Guaraná Antarctica 350ml',
      categoria: 'bebida',
      preco_unitario: 600,
      disponivel_hoje: true,
      estoque_do_dia: 20,
      personalizacoes_permitidas: ['gelado']
    }
  ],
  cardapio_por_dia: {
    segunda: ['bife-acebolado', 'guarana-lata'],
    quarta: ['feijoada-completa', 'guarana-lata']
  }
};

const mockConfig = {
  restaurant_name: 'Marmitaria Teste',
  whatsapp_number: '5511999999999',
  delivery: {
    default_fee: 700,
    free_delivery_threshold: 6000,
    neighborhoods: [
      { name: 'Centro', aliases: ['centro'], fee: 500 }
    ]
  },
  limits: {
    max_items_per_order: 10,
    max_qty_per_item: 5,
    max_obs_length: 50
  }
};

cartSuite.test('Adicionar item valido com sucesso', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  const res = cart.addItem({ itemId: 'bife-acebolado', quantidade: 2 });
  assert(res.success, 'Deveria adicionar com sucesso');
  assertEqual(cart.items.length, 1);
  assertEqual(cart.items[0].quantidade, 2);
  assertEqual(cart.getSubtotal(), 5600);
});

cartSuite.test('Recusar item inexistente', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  const res = cart.addItem({ itemId: 'pizza-calabresa', quantidade: 1 });
  assert(!res.success, 'Deveria falhar para item inexistente');
  assertEqual(cart.items.length, 0);
});

cartSuite.test('Recusar item indisponivel no dia atual com sugestao', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // Feijoada nao esta na segunda
  const res = cart.addItem({ itemId: 'feijoada-completa', quantidade: 1 });
  assert(!res.success, 'Deveria recusar item fora do dia');
  assert(res.message.includes('não está disponível hoje'), 'Deveria indicar indisponibilidade');
});

cartSuite.test('Recusar quantidade acima do estoque do dia', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // estoque do bife e 5
  const res = cart.addItem({ itemId: 'bife-acebolado', quantidade: 6 });
  assert(!res.success, 'Deveria recusar quantidade acima do estoque');
  assert(res.message.includes('A quantidade máxima permitida') || res.message.includes('estoque') || res.message.includes('disponíveis hoje'));
});

cartSuite.test('Personalizacao por unidade: 2 bifes com configuracoes diferentes criam linhas separadas', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  // 1 bife sem cebola
  const res1 = cart.addItem({
    itemId: 'bife-acebolado',
    quantidade: 1,
    personalizacoes: ['sem cebola']
  });
  assert(res1.success);

  // 1 bife ao ponto (sem alteracao de cebola)
  const res2 = cart.addItem({
    itemId: 'bife-acebolado',
    quantidade: 1,
    personalizacoes: ['ao ponto']
  });
  assert(res2.success);

  assertEqual(cart.items.length, 2, 'Devem ser 2 linhas distintas no pedido');
  assertEqual(cart.items[0].personalizacoes[0], 'sem cebola');
  assertEqual(cart.items[1].personalizacoes[0], 'ao ponto');
  assertEqual(cart.getSubtotal(), 5600);
});

cartSuite.test('Rejeitar personalizacoes fora das permitidas', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  const res = cart.addItem({
    itemId: 'bife-acebolado',
    quantidade: 1,
    personalizacoes: ['sem cebola', 'troque por lagosta']
  });
  assert(res.success, 'Adiciona o item com a personalizacao valida');
  assert(res.rejectedCustomizations.includes('troque por lagosta'), 'Lagosta deve ser rejeitada');
  assertEqual(cart.items[0].personalizacoes.length, 1);
  assertEqual(cart.items[0].personalizacoes[0], 'sem cebola');
});

cartSuite.test('Sanitizacao e corte de observacoes livres', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  const obsLonga = 'A'.repeat(80); // Limite no mockConfig e 50
  cart.addItem({
    itemId: 'bife-acebolado',
    quantidade: 1,
    observacoes: `<script>alert(1)</script>${obsLonga}`
  });
  assert(!cart.items[0].observacoes.includes('<script>'), 'Tags perigosas devem ser removidas');
  assert(cart.items[0].observacoes.length <= 50, 'Deve respeitar o limite de 50 caracteres');
});

cartSuite.test('Remover e alterar quantidade de itens', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 3 });
  assertEqual(cart.items[0].quantidade, 3);

  cart.removeItem('bife-acebolado', 1);
  assertEqual(cart.items[0].quantidade, 2);

  cart.updateQuantity('bife-acebolado', 4);
  assertEqual(cart.items[0].quantidade, 4);

  cart.removeItem('bife-acebolado'); // Remove tudo
  assertEqual(cart.items.length, 0);
});

cartSuite.test('Definicao de endereco e recalculo da taxa de entrega', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1 }); // 2800

  cart.setDelivery('Centro', 'Rua das Flores, 123');
  assertEqual(cart.delivery.taxa, 500);
  assertEqual(cart.getTotal(), 3300);

  // Atingindo frete gratis (>= 6000)
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 2 }); // 2800 * 3 = 8400
  assertEqual(cart.delivery.isFree, true);
  assertEqual(cart.delivery.taxa, 0);
  assertEqual(cart.getTotal(), 8400);
});

cartSuite.test('Confirmacao de pedido bloqueia carrinho vazio ou sem endereco e gera wa.me quando valido', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');

  // Vazio
  const resVazio = cart.confirmOrder();
  assert(!resVazio.success, 'Nao deve confirmar carrinho vazio');

  // Com item mas sem endereco
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1 });
  const resSemEnd = cart.confirmOrder();
  assert(!resSemEnd.success, 'Nao deve confirmar sem endereco');
  assert(resSemEnd.requiresDelivery, 'Deve indicar que requer entrega');

  // Completo
  cart.setDelivery('Centro', 'Av. Paulista, 1000');
  const resConfirmado = cart.confirmOrder();
  assert(resConfirmado.success, 'Deve confirmar pedido com sucesso');
  assert(resConfirmado.whatsappUrl.startsWith('https://wa.me/5511999999999?text='), 'Deve gerar URL correta do WhatsApp');
  assert(resConfirmado.orderText.includes('Bife de Alcatra Acebolado'), 'Texto deve conter os itens');
});

cartSuite.test('Subtracao automatica do estoque do cardapio ao confirmar pedido com sucesso', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // bife-acebolado tem estoque 5
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 2 });
  cart.setDelivery('Centro', 'Rua das Flores, 123');

  const itemAntes = cart.findMenuItem('bife-acebolado');
  assertEqual(itemAntes.estoque_do_dia, 5);

  const res = cart.confirmOrder();
  assert(res.success);

  const itemDepois = cart.findMenuItem('bife-acebolado');
  assertEqual(itemDepois.estoque_do_dia, 3, 'Estoque deve ser reduzido de 5 para 3');
});

cartSuite.test('Esgotamento de estoque ao confirmar e rejeicao de novas adicoes', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // bife-acebolado tem estoque 5
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 5 });
  cart.setDelivery('Centro', 'Rua das Flores, 123');

  const resConfirm = cart.confirmOrder();
  assert(resConfirm.success);

  const itemApos = cart.findMenuItem('bife-acebolado');
  assertEqual(itemApos.estoque_do_dia, 0);
  assertEqual(itemApos.disponivel_hoje, false);

  // Tentativa de adicionar prato esgotado
  const resNovo = cart.addItem({ itemId: 'bife-acebolado', quantidade: 1 });
  assert(!resNovo.success, 'Nao deve permitir adicionar item com estoque esgotado');
  assert(resNovo.message.includes('esgotado') || resNovo.message.includes('não está disponível'));
});
