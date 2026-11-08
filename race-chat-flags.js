/* Rookie League Race Chat — audio flags. Requires Supabase SQL migration. */
(function () {
  'use strict';
  const messages = {
    RED: 'Atenção pilotos. Bandeira vermelha! Corrida interrompida. Aguardem instruções da direção de prova.',
    VSC: 'Atenção pilotos. Virtual Safety Car ativado! Reduzam a velocidade. Ultrapassagens proibidas.',
    GREEN: 'Atenção pilotos. Bandeira verde! Pista liberada. Corrida retomada.'
  };
  const colors = { RED: '#ff5757', VSC: '#ffc857', GREEN: '#a6ff00' };
  let lastVersion = null;
  let lastMode = 'GREEN';
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
      title.textContent = ({RED:'🔴 BANDEIRA VERMELHA', VSC:'🟡 VSC ATIVO', GREEN:'🟢 BANDEIRA VERDE'})[mode] || 'Sem conexão';
      title.style.color = colors[mode] || '#9aa99e';
    }
    if (el('rvFlagMessage')) el('rvFlagMessage').textContent = message || '';
  }

  function speak(mode) {
    if (!voiceUnlocked || !window.speechSynthesis || !messages[mode]) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(messages[mode]);
    utterance.lang = 'pt-BR';
    utterance.rate = 0.92;
    utterance.volume = 1;
    speaking = true;
    utterance.onend = utterance.onerror = () => { speaking = false; };
    window.speechSynthesis.speak(utterance);
  }

  async function refresh() {
    updateAdmin();
    if (!(typeof cloudUser !== 'undefined' && cloudUser) || !(typeof supabaseClient !== 'undefined' && supabaseClient)) return;
    if (polling) return;
    polling = true;
    try {
      const { data, error } = await supabaseClient.from('race_chat_flags')
        .select('mode,version').eq('room_name','rookie-general').maybeSingle();
      if (error) throw error;
      if (!data) return setStatus(null, 'Configure a migração SQL de bandeiras no Supabase.');
      const changed = lastVersion !== null && Number(data.version) !== lastVersion;
      lastVersion = Number(data.version);
      lastMode = data.mode;
      setStatus(data.mode, 'Estado atual da corrida. Áudio disponível para pilotos conectados à Sala Geral.');
      if (changed && (typeof rookieVoiceRoom !== 'undefined' && rookieVoiceRoom) && voiceUnlocked) speak(data.mode);
    } catch (e) {
      setStatus(null, 'Falha ao consultar bandeiras: ' + (e.message || e));
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
