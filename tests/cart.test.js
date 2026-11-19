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

cartSuite.test('Subtracao automatica do estoque do cardapio ao adicionar item e retencao na confirmacao', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // bife-acebolado tem estoque inicial 5
  const itemInicial = cart.findMenuItem('bife-acebolado');
  assertEqual(itemInicial.estoque_do_dia, 5);

  // Adiciona 2 unidades: estoque passa imediatamente de 5 para 3
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 2 });
  const itemAposAdicionar = cart.findMenuItem('bife-acebolado');
  assertEqual(itemAposAdicionar.estoque_do_dia, 3, 'Estoque deve ser reduzido de 5 para 3 imediatamente ao adicionar');

  // Ao confirmar, o estoque se mantem em 3 (sem subtracao duplicada)
  cart.setDelivery('Centro', 'Rua das Flores, 123');
  const res = cart.confirmOrder();
  assert(res.success);

  const itemDepois = cart.findMenuItem('bife-acebolado');
  assertEqual(itemDepois.estoque_do_dia, 3, 'Estoque deve permanecer 3 apos confirmacao');
});

cartSuite.test('Cancelamento de pedido devolve estoque automaticamente de forma idempotente', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // bife-acebolado tem estoque inicial 5
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 3 });
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 2, 'Estoque deve cair para 2');

  // Cancelamento devolve os 3 itens ao estoque
  const resCancel = cart.cancelOrder();
  assert(resCancel.success);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 5, 'Estoque deve retornar para 5');
  assertEqual(cart.items.length, 0, 'Carrinho deve ser esvaziado');
  assertEqual(cart.status, 'cancelado');

  // Segundo cancelamento deve ser idempotente (sem devolucao duplicada)
  const resCancel2 = cart.cancelOrder();
  assert(resCancel2.success);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 5, 'Estoque deve continuar 5 sem duplicidade');
});

cartSuite.test('Remover item e esvaziar carrinho devolve estoque reservado', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // bife-acebolado: 5
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 4 });
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 1);

  // Remove 2 unidades
  cart.removeItem('bife-acebolado', 2);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 3, 'Devolve 2 unidades ao estoque');

  // Limpa carrinho
  cart.clearCart();
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 5, 'Estoque retorna totalmente para 5');
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

cartSuite.test('Atualizar personalizacao mantem estoque e mescla linhas identicas', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1, personalizacoes: ['sem cebola'] });
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1, personalizacoes: ['ao ponto'] });

  const firstLine = cart.items[0];
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 3);

  // Muda a primeira linha para a mesma configuracao da segunda: devem fundir.
  const res = cart.updateItemCustomization(firstLine.line_key, ['ao ponto'], '');
  assert(res.success);
  assertEqual(cart.items.length, 1, 'Configuracoes identicas devem virar uma linha');
  assertEqual(cart.items[0].quantidade, 2);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 3, 'Estoque nao muda ao editar');
});

cartSuite.test('Edicao de personalizacao rejeita opcoes invalidas sem perder o estoque', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1, personalizacoes: ['sem cebola'] });
  const lineKey = cart.items[0].line_key;
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 4);

  const res = cart.updateItemCustomization(lineKey, ['bem passado', 'troque por lagosta'], '');
  assert(res.success);
  assert(res.rejectedCustomizations.includes('troque por lagosta'));
  assertEqual(cart.items[0].personalizacoes.length, 1);
  assertEqual(cart.items[0].personalizacoes[0], 'bem passado');
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 4);
});

cartSuite.test('Varias configuracoes exigem escolha explicita da linha', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1, personalizacoes: ['sem cebola'] });
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1, personalizacoes: ['ao ponto'] });

  const upd = cart.updateQuantity('bife-acebolado', 2);
  assert(upd.requiresLineSelection, 'Alteracao sem lineKey deve pedir selecao');
  assertEqual(cart.items.length, 2, 'Nada deve ser alterado antes da escolha');

  const rem = cart.removeItem('bife-acebolado', 1);
  assert(rem.requiresLineSelection, 'Remocao sem lineKey deve pedir selecao');

  const target = cart.items.find(i => i.personalizacoes.includes('ao ponto'));
  const remLine = cart.removeItem('bife-acebolado', null, target.line_key);
  assert(remLine.success);
  assertEqual(cart.items.length, 1);
  assertEqual(cart.items[0].personalizacoes[0], 'sem cebola');
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 4);

  const updLine = cart.updateQuantity('bife-acebolado', 3, cart.items[0].line_key);
  assert(updLine.success);
  assertEqual(cart.items[0].quantidade, 3);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 2);
});

cartSuite.test('Limite por item considera a soma de todas as configuracoes', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda'); // max_qty_per_item = 5
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 3 });
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 2, personalizacoes: ['sem cebola'] });
  assertEqual(cart.items.length, 2);

  const extra = cart.addItem({ itemId: 'bife-acebolado', quantidade: 1, personalizacoes: ['ao ponto'] });
  assert(!extra.success, 'Nao deve passar do limite somando configuracoes');

  const firstLine = cart.items.find(i => i.personalizacoes.length === 0);
  const upd = cart.updateQuantity('bife-acebolado', 4, firstLine.line_key);
  assert(!upd.success, 'Alteracao tambem deve respeitar o limite somado');
  assertEqual(firstLine.quantidade, 3);
});

cartSuite.test('Confirmacao duplicada nao cria historico duplicado', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1 });
  cart.setDelivery('Centro', 'Rua das Flores, 123');

  const first = cart.confirmOrder();
  assert(first.success);
  assertEqual(cart.orderHistory.length, 1);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 4);

  const second = cart.confirmOrder();
  assert(!second.success);
  assert(second.alreadyConfirmed);
  assertEqual(cart.orderHistory.length, 1, 'Nao deve registrar o mesmo pedido duas vezes');
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 4);
});

cartSuite.test('Cancelar pedido confirmado devolve estoque uma unica vez e atualiza historico', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 2 });
  cart.setDelivery('Centro', 'Rua das Flores, 123');
  const confirmed = cart.confirmOrder();
  assert(confirmed.success);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 3);

  const cancel = cart.cancelOrder();
  assert(cancel.success);
  assertEqual(cart.status, 'cancelado');
  assertEqual(cart.items.length, 0);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 5, 'Devolve as 2 unidades reservadas');
  assertEqual(cart.orderHistory.length, 1, 'Atualiza o pedido existente, sem duplicar');
  assertEqual(cart.orderHistory[0].status, 'cancelado');
  assertEqual(cart.orderHistory[0].stockReturned, true);

  const cancelAgain = cart.cancelOrder();
  assert(cancelAgain.success);
  assert(cancelAgain.alreadyCancelled);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 5, 'Nao devolve duas vezes');
});

cartSuite.test('Novo pedido apos confirmacao preserva o historico anterior', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 1 });
  cart.setDelivery('Centro', 'Rua das Flores, 123');
  cart.confirmOrder();
  assertEqual(cart.status, 'confirmado');
  assertEqual(cart.orderHistory.length, 1);

  const newAdd = cart.addItem({ itemId: 'guarana-lata', quantidade: 1 });
  assert(newAdd.success);
  assertEqual(cart.status, 'montando');
  assertEqual(cart.items.length, 1);
  assertEqual(cart.orderHistory.length, 1, 'Pedido anterior permanece no historico');
  assertEqual(cart.findMenuItem('guarana-lata').estoque_do_dia, 19);
});

cartSuite.test('Reset de sessao restaura estoque, historico e estado inicial', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 2 });
  cart.setDelivery('Centro', 'Rua das Flores, 123');
  cart.confirmOrder();
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 3);

  cart.resetSession();
  assertEqual(cart.items.length, 0);
  assertEqual(cart.orderHistory.length, 0);
  assertEqual(cart.status, 'montando');
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 5);
});

cartSuite.test('Disponibilidade reage imediatamente ao esgotar e ao devolver estoque', () => {
  const cart = new CartStore(mockMenu, mockConfig, 'segunda');
  cart.addItem({ itemId: 'bife-acebolado', quantidade: 5 });
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 0);
  assertEqual(cart.findMenuItem('bife-acebolado').disponivel_hoje, false);

  const todayItems = cart.getMenuItemsForToday();
  const bife = todayItems.find(i => i.id === 'bife-acebolado');
  assert(bife && bife.disponivel_hoje === false, 'Cardapio deve refletir esgotamento');

  const lineKey = cart.items[0].line_key;
  cart.updateQuantity('bife-acebolado', 4, lineKey);
  assertEqual(cart.findMenuItem('bife-acebolado').estoque_do_dia, 1);
  assertEqual(cart.findMenuItem('bife-acebolado').disponivel_hoje, true);
});
