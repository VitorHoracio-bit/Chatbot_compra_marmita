import { TestRunner, assert, assertEqual } from './test-utils.js';
import {
  categorizeOptions,
  isIngredientRemoval,
  isCookingPoint,
  isSeasoning,
  areCustomizationsConflicting,
  validateCustomizations,
  sanitizeObservation,
  validateObservation
} from '../js/utils/customizationHelper.js';

export const customizationSuite = new TestRunner('Customization Rules Tests');

const product = {
  id: 'bife-acebolado',
  nome: 'Bife de Alcatra Acebolado',
  personalizacoes_permitidas: [
    'sem cebola',
    'cebola extra',
    'ao ponto',
    'bem passado',
    'pouco arroz',
    'arroz integral'
  ]
};

customizationSuite.test('Classifica opções em remoção, ponto de cozimento e temperos', () => {
  assert(isIngredientRemoval('sem cebola'));
  assert(!isIngredientRemoval('cebola extra'));
  assert(isCookingPoint('ao ponto'));
  assert(isCookingPoint('bem passado'));
  assert(isSeasoning('pouco arroz'));

  const groups = categorizeOptions(product.personalizacoes_permitidas);
  assertEqual(groups.removals.length, 1);
  assertEqual(groups.cookingPoints.length, 2);
  assertEqual(groups.seasonings.length, 3);
});

customizationSuite.test('Valida opções permitidas com normalização de caixa e acentos', () => {
  const res = validateCustomizations(product, ['SEM CEBOLA', 'Ao Ponto', 'sem cebola']);
  assertEqual(res.rejectedCustomizations.length, 0, 'Não deve rejeitar variações válidas');
  assertEqual(res.validCustomizations.length, 2, 'Duplicata normalizada deve ser ignorada');
  assert(res.validCustomizations.includes('sem cebola'));
  assert(res.validCustomizations.includes('ao ponto'));
});

customizationSuite.test('Rejeita opções não permitidas, tipos inválidos e estruturas inválidas', () => {
  const res = validateCustomizations(product, ['troque por lagosta', 42, '', 'sem cebola']);
  assertEqual(res.validCustomizations.length, 1);
  assertEqual(res.rejectedCustomizations.length, 3);
  assert(res.rejections.some(r => r.reason === 'not_allowed'));
  assert(res.rejections.some(r => r.reason === 'invalid_type'));
  assert(res.rejections.some(r => r.reason === 'empty'));

  const invalidStructure = validateCustomizations(product, 'sem cebola');
  assertEqual(invalidStructure.validCustomizations.length, 0);
  assertEqual(invalidStructure.rejections[0].reason, 'invalid_structure');

  // Não inventar variações por prefixo: "sem cebola extra" não é "sem cebola".
  const invented = validateCustomizations(product, ['sem cebola extra']);
  assertEqual(invented.validCustomizations.length, 0);
  assertEqual(invented.rejections[0].reason, 'not_allowed');
});

customizationSuite.test('Rejeita opções contraditórias e múltiplos pontos de cozimento', () => {
  const res = validateCustomizations(product, ['sem cebola', 'cebola extra', 'ao ponto', 'bem passado']);
  assertEqual(res.validCustomizations.length, 2);
  assertEqual(res.validCustomizations[0], 'sem cebola');
  assertEqual(res.validCustomizations[1], 'ao ponto');
  assert(res.rejections.some(r => r.reason === 'conflict'));
  assert(res.rejections.some(r => r.reason === 'conflict_cooking_point'));
  assert(areCustomizationsConflicting('sem cebola', 'cebola extra'));
  assert(!areCustomizationsConflicting('sem cebola', 'pouco arroz'));
});

customizationSuite.test('Sanitiza observações removendo tags e controlando o limite', () => {
  const dirty = `<script>alert(1)</script> ${'A'.repeat(200)}`;
  const clean = sanitizeObservation(dirty, 50);
  assert(!clean.includes('<script>'), 'Tags devem ser removidas');
  assertEqual(clean.length, 50);

  const result = validateObservation(dirty, 50);
  assert(result.valid);
  assert(result.truncated, 'Deve sinalizar truncamento');
  assert(result.message.includes('50'));
});
