/**
 * Provedor Modo A: Google Gemini API (BYOK - Bring Your Own Key).
 * Opera 100% no navegador via chamadas REST diretas com CORS liberado.
 */

import { ORDER_AGENT_SCHEMA } from '../agent/schema.js';

export class GeminiProvider {
  /**
   * @param {object} options
   * @param {string} options.apiKey Chave de API informada pelo usuario
   * @param {string} [options.model] Modelo selecionado (padrao: gemini-2.0-flash)
   * @param {number} [options.timeoutMs] Timeout maximo em milissegundos
   */
  constructor({ apiKey, model = 'gemini-2.0-flash', timeoutMs = 15000 }) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Envia prompt ao endpoint oficial da API Gemini com saida estruturada JSON.
   * @param {string} systemInstruction Prompt do sistema com isolamento e cardapio
   * @param {string} userContent Conteudo delimitado da mensagem
   * @param {Array<{role: string, text: string}>} [history] Historico recente
   * @returns {Promise<object>} Objeto JSON validado
   */
  async generateResponse(systemInstruction, userContent, history = []) {
    if (!this.apiKey) {
      throw new Error('Chave de API do Gemini não configurada. Por favor, adicione sua chave nas Configurações.');
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      throw new Error('Sem conexão com a internet. Verifique sua rede ou ative o Modo Offline.');
    }

    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

    // Monta o payload
    const contents = [];

    // Adiciona historico recente resumido
    if (Array.isArray(history) && history.length > 0) {
      for (const msg of history.slice(-4)) {
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.text }]
        });
      }
    }

    // Adiciona a mensagem atual
    contents.push({
      role: 'user',
      parts: [{ text: userContent }]
    });

    const payload = {
      contents,
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      generationConfig: {
        temperature: 0.1, // Temperatura baixa para respostas deterministicas e conformidade ao schema
        responseMimeType: 'application/json',
        responseSchema: ORDER_AGENT_SCHEMA
      }
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        if (res.status === 400) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(`Erro na requisição à API Gemini: ${errData.error?.message || 'Parâmetros inválidos.'}`);
        }
        if (res.status === 401 || res.status === 403) {
          throw new Error('Chave de API do Gemini inválida ou não autorizada. Verifique se a chave em Configurações está correta.');
        }
        if (res.status === 429) {
          throw new Error('Limite de taxa/cota excedido na API Gemini. Recomendamos alternar temporariamente para o Modo Offline.');
        }
        throw new Error(`Erro HTTP ${res.status} ao contatar a API Gemini.`);
      }

      const jsonResponse = await res.json();
      const candidateText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!candidateText) {
        throw new Error('A API Gemini não retornou nenhum conteúdo válido.');
      }

      return JSON.parse(candidateText);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        throw new Error('Tempo limite de resposta esgotado (timeout de 15s). Tente novamente ou use o Modo Offline.');
      }
      throw err;
    }
  }
}
