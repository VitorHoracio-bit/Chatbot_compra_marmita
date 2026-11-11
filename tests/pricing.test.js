import { TestRunner, assert, assertEqual } from './test-utils.js';
import {
  formatCurrency,
  calculateSubtotal,
  calculateDeliveryFee,
  calculateOrderTotal,
  remainingForFreeDelivery,
  normalizeString
} from '../js/cart/pricing.js';

export const pricingSuite = new TestRunner('Pricing & Currency Tests');

const mockConfig = {
  delivery: {
    default_fee: 700,
    free_delivery_threshold: 6000,
    neighborhoods: [
      { name: 'Centro', aliases: ['centro', 'se'], fee: 500 },
      { name: 'Pinheiros', aliases: ['pinheiros', 'vila madalena'], fee: 900 }
    ]
  }
};

pricingSuite.test('formatCurrency formata centavos corretamente para BRL', () => {
  // R$ 28,00 (pode conter espaco regular ou non-breaking space \u00a0)
  const formatted = formatCurrency(2800).replace(/\u00a0/g, ' ');
  assert(formatted.includes('R$') && formatted.includes('28,00'), `Esperado R$ 28,00, obtido: ${formatted}`);

  const zero = formatCurrency(0).replace(/\u00a0/g, ' ');
  assert(zero.includes('R$') && zero.includes('0,00'), `Esperado R$ 0,00, obtido: ${zero}`);

  const cents = formatCurrency(650).replace(/\u00a0/g, ' ');
  assert(cents.includes('R$') && cents.includes('6,50'), `Esperado R$ 6,50, obtido: ${cents}`);
});

pricingSuite.test('calculateSubtotal calcula a soma exata em centavos', () => {
  const items = [
    { preco_unitario: 2800, quantidade: 2 }, // 5600
    { preco_unitario: 600, quantidade: 1 }   // 600
  ];
  assertEqual(calculateSubtotal(items), 6200);
});

pricingSuite.test('calculateSubtotal trata arrays vazios ou valores invalidos', () => {
  assertEqual(calculateSubtotal([]), 0);
  assertEqual(calculateSubtotal(null), 0);
  assertEqual(calculateSubtotal([{ preco_unitario: -100, quantidade: 2 }]), 0);
});

pricingSuite.test('calculateDeliveryFee retorna taxa por bairro reconhecido', () => {
  const resultCentro = calculateDeliveryFee(3000, 'Centro', mockConfig);
  assertEqual(resultCentro.fee, 500);
  assertEqual(resultCentro.isFree, false);
  assertEqual(resultCentro.neighborhoodName, 'Centro');

  const resultPinheiros = calculateDeliveryFee(3000, 'vila madalena', mockConfig);
  assertEqual(resultPinheiros.fee, 900);
  assertEqual(resultPinheiros.isFree, false);
});

pricingSuite.test('calculateDeliveryFee usa taxa padrao para bairro desconhecido ou nulo', () => {
  const resultDesconhecido = calculateDeliveryFee(3000, 'Bairro Qualquer', mockConfig);
  assertEqual(resultDesconhecido.fee, 700);
  assertEqual(resultDesconhecido.isFree, false);

  const resultNulo = calculateDeliveryFee(3000, null, mockConfig);
  assertEqual(resultNulo.fee, 700);
});

pricingSuite.test('calculateDeliveryFee zera frete acima do limiar de frete gratis', () => {
  // Limiar e 6000 (R$ 60,00)
  const resultExato = calculateDeliveryFee(6000, 'Pinheiros', mockConfig);
  assertEqual(resultExato.fee, 0);
  assertEqual(resultExato.isFree, true);

  const resultMaior = calculateDeliveryFee(7500, 'Pinheiros', mockConfig);
  assertEqual(resultMaior.fee, 0);
  assertEqual(resultMaior.isFree, true);
});

pricingSuite.test('calculateOrderTotal soma subtotal e frete', () => {
  assertEqual(calculateOrderTotal(5600, 500), 6100);
  assertEqual(calculateOrderTotal(6200, 0), 6200);
  assertEqual(calculateOrderTotal(0, 700), 700);
});

pricingSuite.test('remainingForFreeDelivery calcula centavos restantes com precisao', () => {
  assertEqual(remainingForFreeDelivery(5000, mockConfig), 1000);
  assertEqual(remainingForFreeDelivery(6000, mockConfig), 0);
  assertEqual(remainingForFreeDelivery(7500, mockConfig), 0);
});

pricingSuite.test('normalizeString remove acentos e poe em minusculo', () => {
  assertEqual(normalizeString('  SÃO PAULO  '), 'sao paulo');
  assertEqual(normalizeString('Feijoada Completa'), 'feijoada completa');
});
