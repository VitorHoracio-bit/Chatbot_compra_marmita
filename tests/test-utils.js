/**
 * Mini framework de testes unitarios compativel com Node.js (ESM) e Navegador.
 */

export class TestRunner {
  constructor(suiteName = 'Test Suite') {
    this.suiteName = suiteName;
    this.tests = [];
    this.results = [];
  }

  test(name, fn) {
    this.tests.push({ name, fn });
  }

  async run() {
    this.results = [];
    let passed = 0;
    let failed = 0;

    for (const { name, fn } of this.tests) {
      try {
        await fn();
        this.results.push({ name, passed: true });
        passed++;
      } catch (err) {
        this.results.push({ name, passed: false, error: err.message || String(err) });
        failed++;
      }
    }

    return {
      suite: this.suiteName,
      total: this.tests.length,
      passed,
      failed,
      results: this.results
    };
  }
}

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message ? message + ' - ' : ''}Esperado: ${JSON.stringify(expected)}, Recebido: ${JSON.stringify(actual)}`);
  }
}

export function assertDeepEqual(actual, expected, message = '') {
  const actualStr = JSON.stringify(actual);
  const expectedStr = JSON.stringify(expected);
  if (actualStr !== expectedStr) {
    throw new Error(`${message ? message + ' - ' : ''}Esperado: ${expectedStr}, Recebido: ${actualStr}`);
  }
}
