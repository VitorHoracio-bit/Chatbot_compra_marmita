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

    // Tenta primeiro o modelo configurado e, se der 404, faz fallback automático para modelos conhecidos ativos
    const modelsToTry = [
      this.model,
      'gemini-flash-latest',
      'gemini-3.5-flash-lite',
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash'
    ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

    let lastError = null;

    for (const currentModel of modelsToTry) {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(currentModel)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;

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
          const errData = await res.json().catch(() => ({}));
          const detailedMsg = errData.error?.message ? ` (${errData.error.message})` : '';

          if (res.status === 404) {
            // Modelo não encontrado para esta versão/chave; tenta o próximo candidato da lista
            console.warn(`Modelo ${currentModel} retornou 404 na API Gemini. Tentando próximo modelo...`);
            lastError = new Error(`Modelo "${currentModel}" não encontrado na API Gemini (404)${detailedMsg}.`);
            continue;
          }

          if (res.status === 400) {
            throw new Error(`Erro na requisição à API Gemini: ${errData.error?.message || 'Parâmetros inválidos.'}`);
          }
          if (res.status === 401 || res.status === 403) {
            throw new Error(`Chave de API do Gemini inválida ou não autorizada${detailedMsg}. Verifique sua chave nas Configurações.`);
          }
          if (res.status === 429) {
            throw new Error(`Limite de taxa/cota excedido na API Gemini${detailedMsg}.`);
          }
          throw new Error(`Erro HTTP ${res.status} ao contatar a API Gemini${detailedMsg}.`);
        }

        const jsonResponse = await res.json();
        const candidateText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!candidateText) {
          throw new Error('A API Gemini não retornou nenhum conteúdo válido.');
        }

        // Se encontrou um modelo que funcionou, atualiza this.model para as próximas chamadas
        this.model = currentModel;
        return JSON.parse(candidateText);
      } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Tempo limite de resposta esgotado (timeout de 15s). Tente novamente.');
        }
        if (err.message && err.message.includes('404')) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }

    throw lastError || new Error('Nenhum dos modelos disponíveis da API Gemini respondeu com sucesso.');
  }
}
