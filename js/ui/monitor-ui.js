/**
 * Interface do Painel de Monitoramento em Tempo Real.
 * Renderiza métricas operacionais, histórico de conversas e logs técnicos
 * em tempo real via subscrição reativa ao MonitorService.
 */

import { monitorService } from '../monitor/monitor.js';

export class MonitorUI {
  constructor() {
    this.container = null;
    this.unsubscribe = null;
    this.currentTab = 'overview'; // 'overview' | 'events' | 'chats'
  }

  /**
   * Conecta a UI de monitoramento aos elementos do modal de configurações.
   */
  init() {
    this.setupTabNavigation();
    this.setupControlButtons();

    // Inscreve para atualizações do monitor
    this.unsubscribe = monitorService.subscribe((state) => {
      this.render(state);
    });
  }

  setupTabNavigation() {
    const tabs = document.querySelectorAll('.settings-tab-btn');
    const panes = document.querySelectorAll('.settings-tab-pane');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab;
        tabs.forEach(t => t.classList.toggle('active', t === tab));
        panes.forEach(p => p.classList.toggle('active', p.id === `tab-pane-${target}`));
      });
    });
  }

  setupControlButtons() {
    const btnPause = document.getElementById('btn-monitor-pause');
    const btnClear = document.getElementById('btn-monitor-clear');

    if (btnPause) {
      btnPause.addEventListener('click', () => {
        const isPaused = !monitorService.isPaused;
        monitorService.setPaused(isPaused);
        btnPause.innerHTML = isPaused ? '▶️ Retomar' : '⏸️ Pausar';
        btnPause.classList.toggle('btn-warning-active', isPaused);
      });
    }

    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('Deseja limpar todos os registros e histórico de monitoramento?')) {
          monitorService.clearLogs();
        }
      });
    }
  }

  /**
   * Renderiza os indicadores e listas de eventos/conversas.
   */
  render(state) {
    const { metrics, conversations, events, isPaused } = state;

    // 1. Atualiza Indicadores Visuais (KPIs)
    const statusEl = document.getElementById('metric-status');
    const receivedEl = document.getElementById('metric-received');
    const processedEl = document.getElementById('metric-processed');
    const responsesEl = document.getElementById('metric-responses');
    const errorsEl = document.getElementById('metric-errors');
    const avgTimeEl = document.getElementById('metric-avg-time');
    const lastTimeEl = document.getElementById('metric-last-time');
    const pauseBadge = document.getElementById('monitor-pause-indicator');

    if (statusEl) {
      statusEl.textContent = metrics.status.toUpperCase();
      statusEl.className = `metric-status-badge status-${metrics.status}`;
    }

    if (receivedEl) receivedEl.textContent = String(metrics.messagesReceived);
    if (processedEl) processedEl.textContent = String(metrics.messagesProcessed);
    if (responsesEl) responsesEl.textContent = String(metrics.responsesEmitted);
    if (errorsEl) {
      errorsEl.textContent = String(metrics.errorsCount);
      errorsEl.style.color = metrics.errorsCount > 0 ? 'var(--danger)' : '';
    }
    if (avgTimeEl) avgTimeEl.textContent = `${metrics.averageProcessingTimeMs} ms`;
    if (lastTimeEl) lastTimeEl.textContent = `${metrics.lastProcessingTimeMs} ms`;

    if (pauseBadge) {
      pauseBadge.style.display = isPaused ? 'inline-block' : 'none';
    }

    // 2. Renderiza Histórico de Conversação em Tempo Real
    const chatListEl = document.getElementById('monitor-chat-list');
    if (chatListEl) {
      if (conversations.length === 0) {
        chatListEl.innerHTML = '<div class="monitor-empty">Nenhuma mensagem registrada na sessão atual.</div>';
      } else {
        chatListEl.innerHTML = '';
        conversations.slice(-20).forEach(msg => {
          const item = document.createElement('div');
          item.className = `monitor-chat-item sender-${msg.sender}`;

          const header = document.createElement('div');
          header.className = 'monitor-item-header';

          const senderBadge = document.createElement('span');
          senderBadge.className = `sender-badge badge-${msg.sender}`;
          senderBadge.textContent = msg.senderLabel;

          const timeSpan = document.createElement('span');
          timeSpan.className = 'item-timestamp';
          timeSpan.textContent = this.formatTime(msg.timestamp);

          header.appendChild(senderBadge);
          header.appendChild(timeSpan);

          const body = document.createElement('div');
          body.className = 'monitor-chat-text';
          body.textContent = msg.text;

          item.appendChild(header);
          item.appendChild(body);
          chatListEl.appendChild(item);
        });
        chatListEl.scrollTop = chatListEl.scrollHeight;
      }
    }

    // 3. Renderiza Log de Eventos Técnicos
    const eventListEl = document.getElementById('monitor-event-list');
    if (eventListEl) {
      if (events.length === 0) {
        eventListEl.innerHTML = '<div class="monitor-empty">Nenhum evento técnico registrado.</div>';
      } else {
        eventListEl.innerHTML = '';
        events.slice(0, 50).forEach(evt => {
          const row = document.createElement('div');
          row.className = `monitor-event-row type-${evt.type}`;

          const timeEl = document.createElement('span');
          timeEl.className = 'event-time';
          timeEl.textContent = this.formatTime(evt.timestamp);

          const catEl = document.createElement('span');
          catEl.className = `event-category cat-${evt.type}`;
          catEl.textContent = evt.category;

          const descEl = document.createElement('span');
          descEl.className = 'event-desc';
          descEl.textContent = evt.description;

          row.appendChild(timeEl);
          row.appendChild(catEl);
          row.appendChild(descEl);

          eventListEl.appendChild(row);
        });
      }
    }
  }

  formatTime(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (_) {
      return isoString;
    }
  }
}
