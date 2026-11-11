/**
 * Modulo de interface do Chat.
 * Implementa renderizacao segura (imune a XSS, sem innerHTML arbitrario),
 * indicador de digitacao, botoes de acao rapida e formatacao limpa.
 */

export class ChatUI {
  constructor({ messagesContainer, inputElement, charCounter, onSendMessage, onQuickAction }) {
    this.messagesContainer = messagesContainer;
    this.inputElement = inputElement;
    this.charCounter = charCounter;
    this.onSendMessage = onSendMessage;
    this.onQuickAction = onQuickAction;
    this.typingElement = null;

    this.setupInputEvents();
  }

  setupInputEvents() {
    if (!this.inputElement) return;

    this.inputElement.addEventListener('input', () => {
      const len = this.inputElement.value.length;
      if (this.charCounter) {
        this.charCounter.textContent = `${len}/300`;
        this.charCounter.style.color = len > 280 ? '#dc2626' : 'var(--text-muted)';
      }
    });

    this.inputElement.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.submitMessage();
      }
    });
  }

  submitMessage() {
    const text = this.inputElement.value.trim();
    if (!text) return;
    this.inputElement.value = '';
    if (this.charCounter) this.charCounter.textContent = '0/300';
    if (this.onSendMessage) {
      this.onSendMessage(text);
    }
  }

  /**
   * Adiciona mensagem do usuario no chat.
   */
  appendUserMessage(text) {
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message user';

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.textContent = '👤';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';
    bubble.textContent = text; // 100% seguro contra XSS

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = timeStr;

    contentDiv.appendChild(bubble);
    contentDiv.appendChild(timeSpan);

    msgDiv.appendChild(avatarDiv);
    msgDiv.appendChild(contentDiv);

    this.messagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Adiciona mensagem do bot com formatacao segura e opcionais CTAs (WhatsApp, copiar).
   */
  appendBotMessage(text, options = {}) {
    const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const msgDiv = document.createElement('div');
    msgDiv.className = 'message bot';

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.textContent = '🍱';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    // Formata o texto seguro respeitando quebras e negrito
    this.formatSafeMessageText(bubble, text);

    // Se houver link do WhatsApp ou acao de copiar, anexa botoes
    if (options.whatsappUrl) {
      const ctaBox = document.createElement('div');
      ctaBox.className = 'chat-cta-box';

      const waLink = document.createElement('a');
      waLink.className = 'btn-whatsapp-cta';
      waLink.href = options.whatsappUrl;
      waLink.target = '_blank';
      waLink.rel = 'noopener noreferrer';
      waLink.textContent = '📲 Finalizar Pedido no WhatsApp';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-copy-cta';
      copyBtn.type = 'button';
      copyBtn.textContent = '📋 Copiar Resumo do Pedido';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '✓ Resumo Copiado!';
          setTimeout(() => { copyBtn.textContent = '📋 Copiar Resumo do Pedido'; }, 3000);
        });
      });

      ctaBox.appendChild(waLink);
      ctaBox.appendChild(copyBtn);
      bubble.appendChild(ctaBox);
    }

    const timeSpan = document.createElement('span');
    timeSpan.className = 'message-time';
    timeSpan.textContent = timeStr;

    contentDiv.appendChild(bubble);
    contentDiv.appendChild(timeSpan);

    msgDiv.appendChild(avatarDiv);
    msgDiv.appendChild(contentDiv);

    this.messagesContainer.appendChild(msgDiv);
    this.scrollToBottom();
  }

  /**
   * Renderiza aviso de sistema (ex: aviso de fallback ou privacidade).
   */
  appendSystemNotice(text) {
    const noticeDiv = document.createElement('div');
    noticeDiv.className = 'message system-notice';
    noticeDiv.textContent = `ℹ️ ${text}`;
    this.messagesContainer.appendChild(noticeDiv);
    this.scrollToBottom();
  }

  /**
   * Formata texto em negrito (*texto*) e quebras de linha sem nunca usar innerHTML.
   */
  formatSafeMessageText(container, text) {
    const lines = text.split('\n');

    lines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        container.appendChild(document.createElement('br'));
      }

      // Separa palavras com delimitadores de negrito *palavra*
      const parts = line.split(/(\*[^*]+\*)/g);
      for (const part of parts) {
        if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
          const bold = document.createElement('strong');
          bold.textContent = part.slice(1, -1);
          container.appendChild(bold);
        } else if (part) {
          container.appendChild(document.createTextNode(part));
        }
      }
    });
  }

  showTyping() {
    if (this.typingElement) return;

    const typingDiv = document.createElement('div');
    typingDiv.className = 'message bot';
    typingDiv.id = 'bot-typing-indicator';

    const avatarDiv = document.createElement('div');
    avatarDiv.className = 'message-avatar';
    avatarDiv.textContent = '🍱';

    const typingBox = document.createElement('div');
    typingBox.className = 'typing-indicator';

    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span');
      dot.className = 'typing-dot';
      typingBox.appendChild(dot);
    }

    typingDiv.appendChild(avatarDiv);
    typingDiv.appendChild(typingBox);

    this.messagesContainer.appendChild(typingDiv);
    this.typingElement = typingDiv;
    this.scrollToBottom();
  }

  hideTyping() {
    if (this.typingElement) {
      this.typingElement.remove();
      this.typingElement = null;
    }
  }

  scrollToBottom() {
    setTimeout(() => {
      this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
    }, 50);
  }
}
