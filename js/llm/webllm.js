/**
 * Provedor Modo B: LLM Local no Navegador via WebLLM / WebGPU (opcional).
 * Se o dispositivo nao suportar WebGPU ou o modelo nao carregar,
 * fornece notificacao clara e instrui o fallback para o Modo C.
 */

export class WebLLMProvider {
  constructor(cartStore, options = {}) {
    this.cartStore = cartStore;
    this.modelName = options.model || 'Llama-3.2-1B-Instruct-q4f32_1-MLC';
    this.engine = null;
    this.isLoading = false;
  }

  isWebGPUSupported() {
    return typeof navigator !== 'undefined' && 'gpu' in navigator;
  }

  async initialize(onProgress = null) {
    if (!this.isWebGPUSupported()) {
      throw new Error('Seu navegador ou dispositivo não possui suporte a WebGPU. Recomendamos utilizar o Modo A (Gemini) ou o Modo Offline.');
    }

    // Se suportado, pode carregar o motor via CDN dinamicamente
    try {
      this.isLoading = true;
      if (onProgress) onProgress({ text: 'Iniciando WebGPU...', progress: 0.1 });
      // Stub preparado para integracao com @mlc-ai/web-llm caso ativado
      this.isLoading = false;
      return true;
    } catch (err) {
      this.isLoading = false;
      throw new Error(`Falha ao inicializar WebLLM: ${err.message}`);
    }
  }

  async generateResponse(systemPrompt, userMessage) {
    if (!this.engine) {
      throw new Error('WebLLM não está inicializado neste ambiente. Por favor, ative o Modo Offline ou Modo A.');
    }
    // Retorna resposta local
    return {
      intent: 'tirar_duvida',
      mensagem_ao_usuario: 'Modo WebLLM ativo.'
    };
  }
}
