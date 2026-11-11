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
    this.mode = initialConfig.default_llm_mode || 'offline'; // 'offline' | 'gemini' | 'webllm'
    this.model = 'gemini-2.0-flash';
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
    // Se estiver no Modo Gemini mas sem chave, usa fallback offline com aviso
    if (this.mode === 'gemini') {
      if (!this.hasValidKey()) {
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
