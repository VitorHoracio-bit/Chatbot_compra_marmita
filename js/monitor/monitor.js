/**
 * Sistema de Monitoramento em Tempo Real do Chatbot.
 * Gerencia métricas de desempenho, log de eventos técnicos e histórico de conversação
 * em memória com emissão de eventos reativos para a UI de monitoramento.
 */

export class MonitorService {
  constructor() {
    this.listeners = new Set();
    this.isPaused = false;

    // Métricas operacionais
    this.metrics = {
      status: 'ativo', // 'ativo' | 'inativo' | 'erro'
      messagesReceived: 0,
      messagesProcessed: 0,
      responsesEmitted: 0,
      errorsCount: 0,
      lastProcessingTimeMs: 0,
      averageProcessingTimeMs: 0,
      totalProcessingTimeMs: 0
    };

    // Histórico de conversação estruturado
    this.conversations = [];

    // Log de eventos técnicos
    this.events = [];
    this.maxEvents = 200;

    // Registra evento de inicialização
    this.logEvent('info', 'Sistema', 'Monitoramento em tempo real inicializado com sucesso.');
  }

  /**
   * Inscreve um callback para receber atualizações do monitoramento.
   * @param {Function} callback
   * @returns {Function} Função para desinscrever
   */
  subscribe(callback) {
    this.listeners.add(callback);
    // Notifica estado atual imediatamente
    try {
      callback(this.getState());
    } catch (err) {
      console.error('Erro ao notificar subscriber do monitor:', err);
    }
    return () => this.listeners.delete(callback);
  }

  notify() {
    if (this.isPaused) return;
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('Erro no listener do monitor:', err);
      }
    }
  }

  getState() {
    return {
      metrics: { ...this.metrics },
      conversations: [...this.conversations],
      events: [...this.events],
      isPaused: this.isPaused
    };
  }

  setPaused(paused) {
    this.isPaused = Boolean(paused);
    if (!this.isPaused) {
      this.notify();
    }
  }

  clearLogs() {
    this.events = [];
    this.conversations = [];
    this.logEvent('info', 'Sistema', 'Registros e histórico de monitoramento foram limpos pelo usuário.');
    this.notify();
  }

  /**
   * Registra uma mensagem recebida do usuário.
   */
  recordUserMessage(text) {
    this.metrics.messagesReceived++;
    this.metrics.status = 'ativo';

    const timestamp = new Date().toISOString();
    const entry = {
      id: 'msg-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      sender: 'user',
      senderLabel: 'Cliente',
      text: text || '',
      timestamp
    };

    this.conversations.push(entry);
    this.logEvent('user', 'Entrada', `Mensagem recebida do usuário: "${text}"`, { length: text.length });
    this.notify();
    return entry;
  }

  /**
   * Registra o processamento concluído de uma mensagem e o tempo decorrido.
   */
  recordProcessing(durationMs, intent, extra = {}) {
    this.metrics.messagesProcessed++;
    this.metrics.lastProcessingTimeMs = Math.round(durationMs * 10) / 10;
    this.metrics.totalProcessingTimeMs += durationMs;
    this.metrics.averageProcessingTimeMs = Math.round(
      (this.metrics.totalProcessingTimeMs / this.metrics.messagesProcessed) * 10
    ) / 10;

    this.logEvent('process', 'Processamento', `Intenção identificada: "${intent}" em ${this.metrics.lastProcessingTimeMs}ms`, {
      intent,
      durationMs: this.metrics.lastProcessingTimeMs,
      ...extra
    });
    this.notify();
  }

  /**
   * Registra uma resposta emitida pelo chatbot.
   */
  recordBotResponse(text, intent = 'resposta') {
    this.metrics.responsesEmitted++;
    this.metrics.status = 'ativo';

    const timestamp = new Date().toISOString();
    const entry = {
      id: 'bot-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      sender: 'bot',
      senderLabel: 'Chatbot',
      text: text || '',
      intent,
      timestamp
    };

    this.conversations.push(entry);
    this.logEvent('bot', 'Saída', `Resposta enviada ao cliente [${intent}]`, { length: text.length });
    this.notify();
    return entry;
  }

  /**
   * Registra um erro ou exceção ocorrida no chatbot.
   */
  recordError(source, error) {
    this.metrics.errorsCount++;
    this.metrics.status = 'erro';

    const message = error instanceof Error ? error.message : String(error);
    this.logEvent('error', source || 'Erro', message, {
      stack: error instanceof Error ? error.stack : undefined
    });
    this.notify();
  }

  /**
   * Adiciona um evento técnico ao log interno.
   */
  logEvent(type, category, description, details = null) {
    const event = {
      id: 'evt-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toISOString(),
      type, // 'info' | 'user' | 'bot' | 'process' | 'error' | 'cart'
      category,
      description,
      details
    };

    this.events.unshift(event);
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
  }
}

// Instância singleton para uso em todo o ciclo da aplicação
export const monitorService = new MonitorService();
