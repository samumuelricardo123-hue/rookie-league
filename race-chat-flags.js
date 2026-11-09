/* Rookie League Race Chat — audio flags. Requires Supabase SQL migration. */
(function () {
  'use strict';
  const messages = {
    RED: 'Atenção pilotos. Bandeira vermelha! Corrida interrompida. Aguardem instruções da direção de prova.',
    VSC: 'Atenção pilotos. Virtual Safety Car ativado! Reduzam a velocidade. Ultrapassagens proibidas.',
    GREEN: 'Atenção pilotos. Bandeira verde! Pista liberada. Corrida retomada.',
    YELLOW: 'Atenção pilotos. Procedimento de relargada! Bandeira amarela. Mantenham posição, não ultrapassem e aguardem as luzes.',
    START: 'Atenção pilotos. Luzes de relargada acendendo. Aguardem todas apagarem.',
    VSC_END: 'Atenção pilotos. Final de VSC. Aguardem as três luzes se apagarem.'
  };
  const colors = { RED: '#ff5757', VSC: '#ffc857', GREEN: '#a6ff00', YELLOW: '#ffc857', START: '#ff5757', VSC_END: '#ffc857' };
  let lastVersion = null;
  let lastMode = 'GREEN';
  let lastPhaseKey = null;
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
      '<div id="rvFlagCountdown" style="font-size:28px;font-weight:900;margin:9px 0;color:#fff" aria-live="off"></div>' +
      '<div id="rvFlagLights" style="display:flex;gap:9px;margin:12px 0" aria-label="Sinais luminosos"></div>' +
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

  function setStatus(mode, message, remaining=0, lightsTotal=0, lightsOn=0) {
    const title = el('rvFlagStatus');
    if (title) {
      title.textContent = ({RED:'🔴 BANDEIRA VERMELHA', VSC:'🟡 VSC ATIVO', GREEN:'🟢 BANDEIRA VERDE', YELLOW:'🟡 BANDEIRA AMARELA · RELARGADA', START:'🔴 LUZES DE RELARGADA', VSC_END:'🟡 FINAL DO VSC'})[mode] || 'Sem conexão';
      title.style.color = colors[mode] || '#9aa99e';
    }
    if (el('rvFlagMessage')) el('rvFlagMessage').textContent = message || '';
    const countdown=el('rvFlagCountdown');if(countdown)countdown.textContent=remaining>0?String(Math.floor(remaining/60)).padStart(2,'0')+':'+String(Math.ceil(remaining%60)).padStart(2,'0'):'';
    const lights=el('rvFlagLights');if(lights)lights.innerHTML=Array.from({length:lightsTotal},(_,i)=>'<span style="width:31px;height:31px;border-radius:50%;border:2px solid #6e3333;background:'+(i<lightsOn?'#ff3333':'#221e1e')+';box-shadow:'+(i<lightsOn?'0 0 18px #ff3333':'none')+'"></span>').join('');
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
    if(!audioPaths[mode]){speakFallback(mode,id);return;}
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

  async function refresh() {
    updateAdmin();
    if (!(typeof cloudUser !== 'undefined' && cloudUser) || !(typeof supabaseClient !== 'undefined' && supabaseClient)) return;
    if (polling) return;
    polling = true;
    try {
      const { data, error } = await supabaseClient.rpc('race_chat_flag_state');
      if (error) throw error;
      if (!data) return setStatus(null, 'Configure a migração SQL de bandeiras no Supabase.');
      const phaseKey=String(data.version)+':'+String(data.mode);
      const changed=lastPhaseKey!==null && phaseKey!==lastPhaseKey;
      lastPhaseKey=phaseKey;
      lastVersion=Number(data.version);
      lastMode=data.mode;
      const elapsed=Math.max(0,(Date.now()-Date.parse(data.server_time))/1000);
      const remaining=Math.max(0,Number(data.remaining_seconds||0)-elapsed);
      setStatus(data.mode,data.message,remaining,Number(data.lights_total)||0,Number(data.lights_on)||0);
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
