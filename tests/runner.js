import { pricingSuite } from './pricing.test.js';
import { cartSuite } from './cart.test.js';
import { guardrailsSuite } from './guardrails.test.js';
import { redteamSuite } from './redteam.test.js';
import { agentSuite } from './agent.test.js';

async function runAll() {
  console.log('=============================================');
  console.log('   EXECUTANDO SUÍTE COMPLETA DE TESTES');
  console.log('=============================================\n');

  const suites = [pricingSuite, cartSuite, guardrailsSuite, redteamSuite, agentSuite];
  let totalTests = 0;
  let totalPassed = 0;
  let totalFailed = 0;

  for (const suite of suites) {
    console.log(`[Suite] ${suite.suiteName}`);
    const res = await suite.run();
    totalTests += res.total;
    totalPassed += res.passed;
    totalFailed += res.failed;

    for (const r of res.results) {
      if (r.passed) {
        console.log(`  ✓ ${r.name}`);
      } else {
        console.error(`  ✗ ${r.name}`);
        console.error(`    Erro: ${r.error}`);
      }
    }
    console.log(`> Subtotal: ${res.passed}/${res.total} passaram.\n`);
  }

  console.log('=============================================');
  console.log(`RESUMO GERAL: ${totalPassed}/${totalTests} testes passaram com sucesso!`);
  if (totalFailed > 0) {
    console.error(`FALHA: ${totalFailed} testes falharam.`);
    process.exit(1);
  } else {
    console.log('STATUS: 100% de sucesso. Todos os critérios de segurança atendidos.');
  }
  console.log('=============================================');
}

runAll();
