/* Rookie League Race Chat — audio flags. Requires Supabase SQL migration. */
(function () {
  'use strict';
  const messages = {
    RED: 'Atenção pilotos. Bandeira vermelha! Corrida interrompida. Aguardem instruções da direção de prova.',
    VSC: 'Atenção pilotos. Virtual Safety Car ativado! Reduzam a velocidade. Ultrapassagens proibidas.',
    GREEN: 'Atenção pilotos. Bandeira verde! Pista liberada. Corrida retomada.'
  };
  const colors = { RED: '#ff5757', YELLOW: '#ffc857', VSC: '#ffc857', GREEN: '#a6ff00' };
  let lastVersion = null;
  let lastMode = 'GREEN';
  let lastPhase = null;
  let currentState = null;
  let receivedAt = 0;
  let polling = false;
  let voiceUnlocked = false;
  let speaking = false;
  const el = id => document.getElementById(id);

  function render() {
    const root = el('rvFlagPanel');
    if (!root) return;
    root.innerHTML = '<div style="font-size:12px;letter-spacing:1px;font-weight:900;color:#a6ff00">DIREÇÃO DE PROVA · BANDEIRAS</div>' +
      '<div id="rvFlagStatus" role="status" aria-live="polite" style="font-size:20px;font-weight:900;margin:10px 0">Aguardando conexão</div>' +
      '<div id="rvFlagMessage" style="font-size:13px;color:#9aa99e">Entre na Sala Geral para receber os avisos por áudio.</div>' +
      '<div id="rvFlagTimer" style="font-size:28px;font-weight:900;margin-top:8px;font-variant-numeric:tabular-nums" aria-label="Tempo restante"></div>' +
      '<div id="rvFlagLights" style="font-size:26px;letter-spacing:8px;margin-top:6px" aria-label="Luzes de largada"></div>' +
      '<div id="rvFlagAdmin" hidden style="display:none;gap:8px;flex-wrap:wrap;margin-top:15px">' +
      '<button type="button" data-flag="RED" style="background:#a72b2b;color:white;border:0;border-radius:8px;padding:12px;cursor:pointer;font-weight:900">🔴 BANDEIRA VERMELHA</button>' +
      '<button type="button" data-flag="VSC" style="background:#e6b32b;color:#151515;border:0;border-radius:8px;padding:12px;cursor:pointer;font-weight:900">🟡 ATIVAR VSC</button>' +
      '<button type="button" data-flag="GREEN" style="background:#a6ff00;color:#151515;border:0;border-radius:8px;padding:12px;cursor:pointer;font-weight:900">🟢 BANDEIRA VERDE</button></div>';
    root.querySelectorAll('[data-flag]').forEach(button => button.addEventListener('click', () => send(button.dataset.flag)));
  }

  function updateAdmin() {
    const panel = el('rvFlagAdmin');
    if (!panel) return;
    const allowed = !!(typeof cloudUser !== 'undefined' && cloudUser) && !!(typeof cloudIsAdmin !== 'undefined' && cloudIsAdmin);
    panel.hidden = !allowed;
    panel.style.display = allowed ? 'flex' : 'none';
  }

  function setStatus(mode, message) {
    const title = el('rvFlagStatus');
    if (title) {
      title.textContent = ({RED:'🔴 BANDEIRA VERMELHA', YELLOW:'🟡 BANDEIRA AMARELA', VSC:'🟡 VSC ATIVO', GREEN:'🟢 BANDEIRA VERDE'})[mode] || 'Sem conexão';
      title.style.color = colors[mode] || '#9aa99e';
    }
    if (el('rvFlagMessage')) el('rvFlagMessage').textContent = message || '';
  }

  // Prefer a consistent, professionally recorded Portuguese announcement when available.
  // Optional files: race-chat-audio/red.mp3, vsc.mp3, green.mp3.
  let activeAudio = null;
  let announcementId = 0;
  const audioPaths = {
    RED: 'race-chat-audio/red.mp3',
    VSC: 'race-chat-audio/vsc.mp3',
    GREEN: 'race-chat-audio/green.mp3'
  };
  function chooseBrazilianVoice() {
    const voices = window.speechSynthesis?.getVoices() || [];
    const ptbr = voices.filter(v => /^pt[-_]BR$/i.test(v.lang));
    return ptbr.find(v => /natural|neural|online/i.test(v.name)) ||
      ptbr.find(v => /male|masculin|daniel|antonio|ant[oô]nio/i.test(v.name)) ||
      ptbr.find(v => !v.localService) ||
      ptbr[0] ||
      voices.find(v => /^pt/i.test(v.lang)) || null;
  }
  function speakFallback(mode, id) {
    if (id !== announcementId || !window.speechSynthesis) return;
    const utterance = new SpeechSynthesisUtterance(messages[mode]);
    utterance.lang = 'pt-BR';
    utterance.rate = 1.12;
    utterance.pitch = 0.93;
    utterance.volume = 1;
    const voice = chooseBrazilianVoice();
    if (voice) utterance.voice = voice;
    speaking = true;
    utterance.onend = utterance.onerror = () => { if (id === announcementId) speaking = false; };
    window.speechSynthesis.speak(utterance);
  }
  function speak(mode) {
    if (!voiceUnlocked || !messages[mode]) return;
    const id = ++announcementId;
    if (activeAudio) {
      activeAudio.pause();
      activeAudio = null;
    }
    window.speechSynthesis?.cancel();
    const audio = new Audio(audioPaths[mode]);
    audio.preload = 'auto';
    audio.playbackRate = 1.12;
    activeAudio = audio;
    speaking = true;
    let fallbackUsed = false;
    function fallback() {
      if (fallbackUsed || id !== announcementId) return;
      fallbackUsed = true;
      activeAudio = null;
      speakFallback(mode, id);
    }
    audio.addEventListener('error', fallback, { once: true });
    audio.addEventListener('ended', () => {
      if (id === announcementId) { speaking = false; activeAudio = null; }
    }, { once: true });
    audio.play().catch(fallback);
  }

  function displayState() {
    if (!currentState) return;
    const data = currentState;
    const remaining = data.phase_ends_at && data.synchronized
      ? Math.max(0, Date.parse(data.phase_ends_at) - Date.now())
      : null;
    const phase = data.phase || data.mode;
    const phaseLabels = {
      RESTART: 'PROCEDIMENTO DE RELARGADA — LARGADA PARADA',
      START_LIGHTS: 'LUZES DE LARGADA — AGUARDE',
      VSC_LIGHTS: 'FINAL DO VSC — AGUARDE AS LUZES'
    };
    setStatus(data.mode, data.message || phaseLabels[phase] || 'Estado atual da corrida.');
    const timer = el('rvFlagTimer');
    if (timer) {
      const secs = remaining === null ? null : Math.ceil(remaining / 1000);
      timer.textContent = secs === null ? '' : String(Math.floor(secs / 60)).padStart(2, '0') + ':' + String(secs % 60).padStart(2, '0');
    }
    const lights = el('rvFlagLights');
    if (lights) {
      const total = Math.max(0, Math.min(5, Number(data.lights_total) || 0));
      let on = Math.max(0, Math.min(total, Number(data.lights_on) || 0));
      if (total && data.phase_ends_at && Number.isFinite(Date.parse(data.phase_ends_at))) {
        const left = Math.max(0, Date.parse(data.phase_ends_at) - Date.now());
        if (phase === 'START_LIGHTS') on = Math.max(0, Math.min(5, 5 - Math.ceil(left / 1000) + 1));
        if (phase === 'VSC_LIGHTS') on = Math.max(0, Math.min(3, Math.ceil(left / 1000) - 1));
      }
      lights.textContent = total ? '🔴'.repeat(on) + '⚫'.repeat(total - on) : '';
    }
  }

  async function refresh() {
    updateAdmin();
    if (!(typeof supabaseClient !== 'undefined' && supabaseClient)) return;
    if (polling) return;
    polling = true;
    try {
      const { data, error } = await supabaseClient.functions.invoke('race-control-flags', { method: 'GET' });
      if (error) throw error;
      if (!data || !data.mode || data.error) throw new Error(data?.error || 'Resposta inválida do servidor');
      const previous = lastMode;
      const changed = lastPhase !== null && (data.mode !== lastMode || data.phase !== lastPhase);
      lastVersion = Number(data.version);
      lastMode = data.mode;
      lastPhase = data.phase || data.mode;
      currentState = data;
      receivedAt = Date.now();
      displayState();
      if (changed && data.mode !== previous && (typeof rookieVoiceRoom !== 'undefined' && rookieVoiceRoom) && voiceUnlocked) speak(data.mode);
    } catch (e) {
      currentState = null;
      setStatus(null, 'Sinalização indisponível — não assumir pista liberada. ' + (e.message || e));
      if (el('rvFlagTimer')) el('rvFlagTimer').textContent = '';
      if (el('rvFlagLights')) el('rvFlagLights').textContent = '';
    } finally { polling = false; }
  }

  async function send(mode) {
    if (!(typeof cloudUser !== 'undefined' && cloudUser) || !(typeof cloudIsAdmin !== 'undefined' && cloudIsAdmin)) return;
    if (!confirm('Confirmar ' + ({RED:'BANDEIRA VERMELHA',VSC:'VSC',GREEN:'BANDEIRA VERDE'})[mode] + ' para todos os pilotos do Race Chat?')) return;
    const buttons = el('rvFlagAdmin')?.querySelectorAll('button') || [];
    buttons.forEach(b => b.disabled = true);
    try {
      const { error } = await supabaseClient.rpc('set_race_chat_flag', { p_mode: mode });
      if (error) throw error;
      await refresh();
    } catch (e) {
      alert('Não foi possível enviar bandeira: ' + (e.message || e));
    } finally { buttons.forEach(b => b.disabled = false); }
  }

  // Browser audio needs a user gesture. Joining the room is the explicit opt-in.
  document.addEventListener('click', e => {
    if (e.target.closest('#rvJoinBtn')) {
      voiceUnlocked = true;
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
        const silent = new SpeechSynthesisUtterance(' ');
        silent.volume = 0;
        window.speechSynthesis.speak(silent);
      }
    }
  }, true);

  function start() {
    const anchor = el('rvMediaGrid');
    if (!anchor || el('rvFlagPanel')) return;
    const root = document.createElement('section');
    root.id = 'rvFlagPanel';
    root.style.cssText = 'border:1px solid #30422c;border-radius:14px;padding:18px;margin:18px 0;background:#101a13';
    anchor.parentNode.insertBefore(root, anchor);
    render();
    refresh();
    setInterval(refresh, 2000);
    setInterval(() => { if (currentState && Date.now() - receivedAt < 6000) displayState(); }, 200);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
