/**
 * Fabrica e gerenciador unificado de Provedores de LLM.
 * Permite alternancia instantanea entre Modo A (Gemini), Modo B (WebLLM) e Modo C (Offline).
 */

import { GeminiProvider } from './gemini.js';
import { OfflineProvider } from './offline.js';
import { WebLLMProvider } from './webllm.js';

export class LLMProviderManager {
  /**
   * @param {object} cartStore
   * @param {object} initialConfig
   */
  constructor(cartStore, initialConfig = {}) {
    this.cartStore = cartStore;
    this.initialConfig = initialConfig;
    this.requireApiKey = initialConfig.require_api_key ?? false;
    this.mode = initialConfig.default_llm_mode || 'offline'; // 'offline' | 'gemini' | 'webllm'
    this.model = 'gemini-1.5-flash';
    this.apiKey = this.loadStoredApiKey();

    this.offlineProvider = new OfflineProvider(cartStore);
    this.geminiProvider = new GeminiProvider({ apiKey: this.apiKey, model: this.model });
    this.webllmProvider = new WebLLMProvider(cartStore);
  }

  loadStoredApiKey() {
    try {
      if (typeof sessionStorage !== 'undefined') {
        return sessionStorage.getItem('marmitaria_gemini_key') || '';
      }
    } catch (_) {}
    return '';
  }

  saveApiKey(key, persistInSession = true) {
    this.apiKey = (key || '').trim();
    this.geminiProvider.apiKey = this.apiKey;

    try {
      if (typeof sessionStorage !== 'undefined') {
        if (persistInSession && this.apiKey) {
          sessionStorage.setItem('marmitaria_gemini_key', this.apiKey);
        } else {
          sessionStorage.removeItem('marmitaria_gemini_key');
        }
      }
    } catch (_) {}
  }

  clearStoredData() {
    this.apiKey = '';
    this.geminiProvider.apiKey = '';
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.clear();
      }
    } catch (_) {}
  }

  setMode(mode) {
    const validModes = ['offline', 'gemini', 'webllm'];
    if (validModes.includes(mode)) {
      this.mode = mode;
    }
  }

  setModel(model) {
    this.model = model;
    this.geminiProvider.model = model;
  }

  getMode() {
    return this.mode;
  }

  hasValidKey() {
    return Boolean(this.apiKey && this.apiKey.length >= 10);
  }

  /**
   * Executa a chamada no provedor ativo com fallback automatico para Modo C se houver erro critico.
   * @param {string} systemPrompt
   * @param {string} userMessage
   * @param {Array} history
   * @returns {Promise<{ result: object, providerUsed: string, fallbackApplied: boolean, warning?: string }>}
   */
  async generateResponse(systemPrompt, userMessage, history = []) {
    // Se exigir API Key (padrão) e não houver chave válida, recusa a chamada imediatamente
    if (this.requireApiKey && !this.hasValidKey()) {
      throw new Error('Chave de API do Gemini não configurada. Por favor, adicione sua chave de API nas Configurações (⚙️) para utilizar o chatbot.');
    }

    // Se estiver no Modo Gemini
    if (this.mode === 'gemini') {
      if (!this.hasValidKey()) {
        if (this.requireApiKey) {
          throw new Error('Chave de API do Gemini não configurada. Por favor, adicione sua chave de API nas Configurações (⚙️) para utilizar o chatbot.');
        }
        const result = await this.offlineProvider.generateResponse(systemPrompt, userMessage);
        return {
          result,
          providerUsed: 'offline',
          fallbackApplied: true,
          warning: 'Chave do Gemini não configurada. Atendimento conduzido pelo motor offline.'
        };
      }

      try {
        const result = await this.geminiProvider.generateResponse(systemPrompt, userMessage, history);
        return {
          result,
          providerUsed: 'gemini',
          fallbackApplied: false
        };
      } catch (err) {
        if (this.requireApiKey) {
          // Quando requer API key, lança o erro diretamente para a UI informar o usuário em vez de silenciar com offline
          throw err;
        }
        console.warn('Falha no Gemini, alternando para motor offline (Modo C):', err.message);
        const result = await this.offlineProvider.generateResponse(systemPrompt, userMessage);
        return {
          result,
          providerUsed: 'offline',
          fallbackApplied: true,
          warning: `Ocorreu uma instabilidade na API (${err.message}). Pedido processado pelo assistente offline.`
        };
      }
    }

    if (this.mode === 'webllm') {
      try {
        const result = await this.webllmProvider.generateResponse(systemPrompt, userMessage);
        return {
          result,
          providerUsed: 'webllm',
          fallbackApplied: false
        };
      } catch (err) {
        const result = await this.offlineProvider.generateResponse(systemPrompt, userMessage);
        return {
          result,
          providerUsed: 'offline',
          fallbackApplied: true,
          warning: 'WebLLM indisponível. Alternado automaticamente para o modo offline.'
        };
      }
    }

    // Modo Offline padrao (Modo C)
    const result = await this.offlineProvider.generateResponse(systemPrompt, userMessage);
    return {
      result,
      providerUsed: 'offline',
      fallbackApplied: false
    };
  }
}
