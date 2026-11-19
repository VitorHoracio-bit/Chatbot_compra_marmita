# 🍱 Marmitaria Sabor de Casa — Chatbot Web de Vendas 100% Local com Monitoramento em Tempo Real

Chatbot web 100% *client-side* para atendimento e vendas de marmitas, desenvolvido em HTML5, CSS3 moderno e JavaScript puro (ES Modules). O sistema opera de forma **totalmente independente de LLMs, APIs externas ou necessidade de credenciais/chaves**, utilizando um motor determinístico local e um **Painel de Monitoramento em Tempo Real** reativo.

- **URL do Repositório:** [https://github.com/VitorHoracio-bit/Chatbot_compra_marmita](https://github.com/VitorHoracio-bit/Chatbot_compra_marmita)
- **URL do GitHub Pages:** [https://vitorhoracio-bit.github.io/Chatbot_compra_marmita/](https://vitorhoracio-bit.github.io/Chatbot_compra_marmita/)
- **Painel de Testes no Navegador:** [https://vitorhoracio-bit.github.io/Chatbot_compra_marmita/tests/index.html](https://vitorhoracio-bit.github.io/Chatbot_compra_marmita/tests/index.html)

---

## 🚀 Destaques da Arquitetura e Decisões Técnicas

1. **100% Client-Side e Zero Build:** Roda diretamente no navegador sem Node.js em produção, sem backend próprio e sem serverless functions.
2. **Sem LLMs e Sem Chaves de API:** Eliminação permanente de dependências e chamadas externas a provedores de IA. O atendimento opera por um motor determinístico local de processamento de linguagem natural (`js/agent/dialogue.js`).
3. **Cálculo Monetário Determinístico:** Todos os cálculos ocorrem em código JavaScript determinístico (`js/cart/pricing.js`), operando estritamente em **centavos inteiros** para evitar anomalias de ponto flutuante e formatados via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.
4. **Fonte Única da Verdade (Single Source of Truth):** O estado do pedido reside exclusivamente no `CartStore` (`js/cart/store.js`), validando cada ação (item existe? está disponível hoje? estoque suficiente? personalizações permitidas?).
5. **Painel de Monitoramento em Tempo Real:** Acessível via Configurações (⚙️), permitindo acompanhar o fluxo de mensagens, métricas operacionais (KPIs), tempo de processamento em milissegundos e log técnico de eventos com recursos de pausa, retomada e limpeza.
6. **Defesa em Camadas (Guardrails):**
   - **Normalização e Sanitização:** Normalização Unicode NFKC, remoção de caracteres de controle e invisíveis (zero-width), substituição de homóglifos, limite de caracteres (300) e rate limiting.
   - **Proteção Anti-Injection:** Bloqueio de tentativas de desvio de conduta e recusa educada para temas fora do escopo da marmitaria.
7. **Suíte de Testes Automatizada:** 94 testes automatizados cobrindo precificação, regras de negócio do carrinho, personalizações, guardrails, suíte Red Team e orquestração do agente com monitoramento.

---

## 📊 Monitoramento em Tempo Real

Acessível pelo botão de Configurações (⚙️) na aba **"📊 Monitoramento em Tempo Real"**:

- **Indicadores de Funcionamento (KPIs):**
  - **Estado do Chatbot:** Ativo, Inativo ou com Erro.
  - **Mensagens Recebidas, Processadas e Respostas Emitidas.**
  - **Contador de Erros** registrados.
  - **Tempo Médio e Último Tempo de Processamento** em milissegundos (`performance.now()`).
- **Visualização da Conversação:** Stream ao vivo com identificação visual clara de cliente e bot com carimbo de data/hora (timestamps).
- **Log Técnico de Eventos:** Registro de eventos internos categorizados (Entrada, Saída, Processamento, Carrinho, Sistema e Erros).
- **Controles Interativos:** Botões para **Pausar/Retomar** a atualização visual em tempo real e **Limpar** os registros da sessão.

---

## 🍽️ Como Funciona o Atendimento

### 1. Consultar Cardápio
- O usuário pode clicar no botão **📋 Ver Cardápio** (ou no botão **Cardápio** do cabeçalho) ou digitar *"o que tem hoje?"*.
- O painel lateral mostra apenas os itens do dia selecionado, com botões visíveis **− / +**, indicação de estoque e abertura automática da personalização quando o prato exige escolhas.
- Bebidas e sobremesas sem personalização são adicionadas diretamente; itens personalizáveis abrem o modal de ingredientes, ponto e observações.

### 2. Adicionar Itens e Personalizações
- Aceita comandos em linguagem natural como:
  - *"Quero 2 de bife e 1 de frango, com 1 guaraná"*
  - *"Adicione 1 bife acebolado sem cebola"*
- **Personalização por Unidade:** Se o cliente pedir dois bifes com preferências distintas (*"2 bifes: 1 bem passado sem cebola e 1 ao ponto normal"*), o sistema cria linhas independentes no carrinho.
- **Validação de Personalizações:** Apenas personalizações listadas em `personalizacoes_permitidas` de cada prato são aceitas.

### 3. Endereço e Cálculo de Frete
- O cliente pode informar o endereço via texto no chat (*"Entregar na Rua Augusta 500 no Centro"*) ou abrir o modal de entrega.
- A taxa é calculada por bairro conforme `data/config.json`, com frete grátis automático ao atingir o limiar configurado.

### 4. Reserva e Confirmação de Estoque
- O estoque diário (`estoque_do_dia`) é reservado no momento em que o item entra no carrinho, evitando venda acima do disponível.
- A confirmação consome a reserva já feita, sem descontar duas vezes; cancelar ou remover devolve as unidades ao cardápio uma única vez.
- Gera link formatado para envio direto ao WhatsApp do restaurante (`wa.me`).

---

## 🧪 Como Executar os Testes

No terminal:
```bash
npm test
```
Ou abra o painel no navegador em `tests/index.html`.
