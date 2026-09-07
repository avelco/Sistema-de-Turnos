(() => {
  'use strict';

  const voiceStorageKey = 'lab-maria-eugenia:voice-uri';
  let lastAnnouncementId = sessionStorage.getItem('lab-maria-eugenia:last-announcement') || '';
  let spanishVoices = [];
  let audioReady = Boolean(window.navigator?.userActivation?.hasBeenActive);
  let pendingAnnouncement = '';

  function updateClock() {
    const now = new Date();
    const value = new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    }).format(now);
    document.querySelectorAll('.live-clock').forEach((clock) => {
      clock.textContent = value;
      clock.dateTime = now.toISOString();
    });
  }

  function updateServiceChoices(root = document) {
    root.querySelectorAll('.service-choice').forEach((choice) => {
      choice.classList.toggle('is-selected', Boolean(choice.querySelector('input:checked')));
    });
  }

  function showToast(message) {
    const region = document.getElementById('toast-region');
    if (!region) return;
    region.innerHTML = `<div class="toast" role="status"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg><span>${message}</span></div>`;
    window.setTimeout(() => { region.innerHTML = ''; }, 3200);
  }

  function voiceScore(voice) {
    const language = voice.lang.toLowerCase();
    const name = voice.name.toLowerCase();
    let score = 0;

    if (language === 'es-co') score += 500;
    else if (language === 'es-mx') score += 460;
    else if (language === 'es-us') score += 440;
    else if (language === 'es-419') score += 420;
    else if (language === 'es-es') score += 400;
    else if (language.startsWith('es')) score += 350;

    if (/premium|enhanced|natural|neural/.test(name)) score += 220;
    if (/paulina|ximena|m[oó]nica|helena|sabina|jorge|[aá]lvaro/.test(name)) score += 80;
    if (/google|microsoft|apple/.test(name)) score += 30;
    if (voice.localService) score += 50;
    if (voice.default) score += 10;
    return score;
  }

  function selectedVoice() {
    const selector = document.querySelector('[data-voice-select]');
    return spanishVoices.find((voice) => voice.voiceURI === selector?.value) || spanishVoices[0] || null;
  }

  function voiceDescription(voice) {
    return voice ? `${voice.name} (${voice.lang})` : 'voz automática en español';
  }

  function setVoiceStatus(message) {
    const status = document.querySelector('[data-voice-status]');
    if (status) status.textContent = message;
  }

  function setAudioReady(ready) {
    audioReady = ready;
    const label = document.querySelector('[data-audio-label]');
    const trigger = document.querySelector('[data-audio-activate]');
    if (label) label.textContent = ready ? 'Audio activo' : 'Activar audio';
    if (trigger) trigger.setAttribute('aria-label', ready ? 'Configurar la voz de los llamados' : 'Activar el audio de los llamados');
  }

  function loadVoices() {
    const selector = document.querySelector('[data-voice-select]');
    if (!selector || !('speechSynthesis' in window)) return;

    const currentPreference = selector.value || localStorage.getItem(voiceStorageKey) || '';
    spanishVoices = window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang?.toLowerCase().startsWith('es'))
      .sort((left, right) => voiceScore(right) - voiceScore(left) || left.name.localeCompare(right.name));

    selector.replaceChildren();
    if (!spanishVoices.length) {
      selector.append(new Option('Automática del sistema (español)', ''));
      selector.disabled = true;
      setVoiceStatus('No encontramos voces españolas instaladas; se usará la voz automática del sistema.');
      return;
    }

    selector.disabled = false;
    spanishVoices.forEach((voice) => {
      const location = voice.localService ? ' · instalada' : '';
      selector.append(new Option(`${voice.name} — ${voice.lang}${location}`, voice.voiceURI));
    });
    const preferredVoice = spanishVoices.find((voice) => voice.voiceURI === currentPreference) || spanishVoices[0];
    selector.value = preferredVoice.voiceURI;
    setVoiceStatus(`Voz seleccionada: ${voiceDescription(preferredVoice)}.`);
  }

  function speak(message, { preview = false, rememberIfBlocked = false } = {}) {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) {
      setVoiceStatus('Este navegador no permite reproducir los llamados por voz.');
      return;
    }

    const voice = selectedVoice();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.voice = voice;
    utterance.lang = voice?.lang || 'es-CO';
    utterance.rate = 0.95;
    utterance.pitch = 1;
    utterance.volume = 1;
    if (preview) setVoiceStatus(`Reproduciendo prueba con ${voiceDescription(voice)}…`);
    utterance.onstart = () => {
      setAudioReady(true);
      setVoiceStatus(`${preview ? 'Reproduciendo prueba' : 'Reproduciendo llamado'} con ${voiceDescription(voice)}…`);
    };
    utterance.onend = () => setVoiceStatus(`Voz seleccionada: ${voiceDescription(voice)}.`);
    utterance.onerror = (event) => {
      if (event.error === 'canceled' || event.error === 'interrupted') return;
      setAudioReady(false);
      if (event.error === 'not-allowed') {
        if (rememberIfBlocked) pendingAnnouncement = message;
        setVoiceStatus('El navegador bloqueó el audio automático. Pulsa “Activar audio” una vez.');
        return;
      }
      setVoiceStatus('No fue posible reproducir la voz. Prueba con otra opción.');
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  }

  function announceCurrentTurn(force = false) {
    const current = document.querySelector('[data-current-announcement]');
    if (!current || !('speechSynthesis' in window)) return;
    const announcementId = current.dataset.currentAnnouncement || '';
    const patientName = current.dataset.currentName || '';
    if (!announcementId || !patientName || (!force && announcementId === lastAnnouncementId)) return;
    lastAnnouncementId = announcementId;
    sessionStorage.setItem('lab-maria-eugenia:last-announcement', announcementId);
    speak(`${patientName}. Por favor, dirigirse a ${current.dataset.currentService}.`, { rememberIfBlocked: true });
    const highlightedCall = current.querySelector('.primary-call');
    highlightedCall?.classList.add('is-new');
    window.setTimeout(() => highlightedCall?.classList.remove('is-new'), 4000);
  }

  document.addEventListener('change', (event) => {
    if (event.target.matches('.service-choice input')) updateServiceChoices(event.target.closest('.service-fieldset'));
    if (event.target.matches('[data-voice-select]')) {
      localStorage.setItem(voiceStorageKey, event.target.value);
      setVoiceStatus(`Voz seleccionada: ${voiceDescription(selectedVoice())}.`);
    }
  });

  document.addEventListener('reset', (event) => {
    window.setTimeout(() => updateServiceChoices(event.target), 0);
  });

  document.addEventListener('click', (event) => {
    const audioTrigger = event.target.closest('[data-audio-activate]');
    if (audioTrigger && !audioReady) {
      const message = pendingAnnouncement || 'Audio activado. Los próximos llamados se reproducirán automáticamente.';
      const hasPendingAnnouncement = Boolean(pendingAnnouncement);
      pendingAnnouncement = '';
      speak(message, { preview: !hasPendingAnnouncement, rememberIfBlocked: hasPendingAnnouncement });
    }
    const passwordToggle = event.target.closest('[data-password-toggle]');
    if (passwordToggle) {
      const input = passwordToggle.closest('.admin-password-control')?.querySelector('input');
      if (input) {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        passwordToggle.setAttribute('aria-pressed', String(!showing));
        passwordToggle.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
        input.focus();
      }
    }
    const printButton = event.target.closest('.js-print');
    if (printButton) window.print();
    if (event.target.closest('[data-test-voice]')) {
      pendingAnnouncement = '';
      speak('María López. Por favor, dirigirse a Toma de muestras, Módulo 1.', { preview: true });
    }
  });

  document.body.addEventListener('htmx:afterSwap', (event) => {
    updateServiceChoices(event.target);
    if (event.target.id === 'attention-workspace') {
      const form = event.target.querySelector('.service-control');
      if (form) window.history.replaceState(null, '', `/atencion?${new URLSearchParams(new FormData(form))}`);
    }
    if (event.target.id === 'registration-panel' && event.target.querySelector('[data-created-turn]')) {
      showToast('Turno creado y agregado a la cola.');
    }
    if (event.target.id === 'display-content') {
      window.setTimeout(() => announceCurrentTurn(), 80);
    }
  });

  document.body.addEventListener('htmx:sseMessage', (event) => {
    if (event.target.id === 'announcement-trigger') {
      window.setTimeout(() => announceCurrentTurn(), 80);
    }
  });

  document.body.addEventListener('htmx:responseError', (event) => {
    if (event.detail.xhr.status >= 500) showToast('No pudimos completar la acción. Inténtalo de nuevo.');
  });

  setAudioReady(audioReady);
  updateClock();
  window.setInterval(updateClock, 1000);
  updateServiceChoices();
  loadVoices();
  if ('speechSynthesis' in window) window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
})();
