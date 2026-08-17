// src/popup.ts
export {}

// UI Element References
const saveBtn = document.getElementById('save') as HTMLButtonElement | null;
const micBtn = document.getElementById('enable-mic') as HTMLButtonElement | null;
const micBtnText = document.getElementById('mic-btn-text') as HTMLSpanElement | null;
const micBadge = document.getElementById('mic-badge') as HTMLSpanElement | null;
const startBtn = document.getElementById('start-rec') as HTMLButtonElement | null;
const stopBtn = document.getElementById('stop-rec') as HTMLButtonElement | null;
const statusPill = document.getElementById('status-pill') as HTMLDivElement | null;
const statusText = document.getElementById('status-text') as HTMLSpanElement | null;
const timerDisplay = document.getElementById('timer') as HTMLDivElement | null;
const meetBadge = document.getElementById('meet-badge') as HTMLSpanElement | null;
const meterFill = document.getElementById('meter-fill') as HTMLDivElement | null;
const vuLevelText = document.getElementById('vu-level-text') as HTMLSpanElement | null;
const toastEl = document.getElementById('toast') as HTMLDivElement | null;
const toastMsg = document.getElementById('toast-message') as HTMLSpanElement | null;
const meetNotice = document.getElementById('meet-notice') as HTMLDivElement | null;
const openMeetBtn = document.getElementById('btn-open-meet') as HTMLButtonElement | null;

// Mute Button Elements
const toggleMuteBtn = document.getElementById('btn-toggle-mute') as HTMLButtonElement | null;
const muteIconUnmuted = document.getElementById('mute-icon-unmuted') as SVGElement | null;
const muteIconMuted = document.getElementById('mute-icon-muted') as SVGElement | null;
const muteBtnLabel = document.getElementById('mute-btn-text') as HTMLSpanElement | null;
const muteStatusTag = document.getElementById('mute-status-tag') as HTMLSpanElement | null;

let timerInterval: number | null = null;
let recordingStartTime: number = 0;
let micAudioStream: MediaStream | null = null;
let micAudioCtx: AudioContext | null = null;
let micAnimationId: number | null = null;
let isCurrentlyOnGoogleMeet: boolean = false;
let isCurrentlyRecording: boolean = false;
let isMicMuted: boolean = false;

// Update Mute Button Appearance
function updateMuteButtonUI(muted: boolean) {
  isMicMuted = muted;
  if (!toggleMuteBtn || !muteBtnLabel || !muteStatusTag) return;

  if (muted) {
    toggleMuteBtn.className = 'btn-mute-toggle muted';
    if (muteIconUnmuted) muteIconUnmuted.style.display = 'none';
    if (muteIconMuted) muteIconMuted.style.display = 'block';
    muteBtnLabel.textContent = 'Microphone Muted (Click to Unmute)';
    muteStatusTag.textContent = 'MUTED';
    if (vuLevelText) {
      vuLevelText.textContent = '🔇 Muted';
      vuLevelText.classList.add('muted');
    }
    if (meterFill) meterFill.style.width = '0%';
  } else {
    toggleMuteBtn.className = 'btn-mute-toggle unmuted';
    if (muteIconUnmuted) muteIconUnmuted.style.display = 'block';
    if (muteIconMuted) muteIconMuted.style.display = 'none';
    muteBtnLabel.textContent = 'Microphone Live (Click to Mute)';
    muteStatusTag.textContent = 'LIVE';
    if (vuLevelText) {
      vuLevelText.textContent = '🎙️ Live';
      vuLevelText.classList.remove('muted');
    }
  }
}

// Toast Notification
function showToast(message: string, durationMs = 3500) {
  if (!toastEl || !toastMsg) return;
  toastMsg.textContent = message;
  toastEl.classList.add('show');
  setTimeout(() => {
    toastEl.classList.remove('show');
  }, durationMs);
}

// Format milliseconds into HH:MM:SS
function formatTime(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [
    hours.toString().padStart(2, '0'),
    minutes.toString().padStart(2, '0'),
    seconds.toString().padStart(2, '0')
  ].join(':');
}

// Manage Recording Timer
function startTimer(startTime?: number) {
  if (timerInterval) clearInterval(timerInterval);
  recordingStartTime = startTime && startTime > 0 ? startTime : Date.now();
  
  const update = () => {
    const elapsed = Date.now() - recordingStartTime;
    if (timerDisplay) {
      timerDisplay.textContent = formatTime(elapsed);
    }
  };
  update();
  timerInterval = window.setInterval(update, 500);
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  recordingStartTime = 0;
  if (timerDisplay) {
    timerDisplay.textContent = '00:00:00';
  }
}

// UI State Manager
function setUI(recording: boolean, startTime?: number) {
  if (!startBtn || !stopBtn || !statusPill || !statusText || !timerDisplay || !saveBtn) return;
  isCurrentlyRecording = recording;

  if (recording) {
    startBtn.style.display = 'none';
    startBtn.disabled = true;

    stopBtn.style.display = 'flex';
    stopBtn.disabled = false;

    statusPill.classList.add('recording');
    statusText.textContent = 'Recording Live';

    timerDisplay.classList.add('recording');
    startTimer(startTime);
  } else {
    stopBtn.style.display = 'none';
    stopBtn.disabled = true;

    startBtn.style.display = 'flex';
    startBtn.disabled = !isCurrentlyOnGoogleMeet;

    saveBtn.disabled = !isCurrentlyOnGoogleMeet;

    statusPill.classList.remove('recording');
    statusText.textContent = 'Standby';

    timerDisplay.classList.remove('recording');
    stopTimer();
  }
}

// Open dedicated mic setup tab if inline prompt fails
async function openMicSetupTab() {
  await chrome.tabs.create({ url: chrome.runtime.getURL('micsetup.html') });
}

// Setup live audio meter visualizer in popup
async function startLiveMicMeter() {
  stopLiveMicMeter();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    micAudioStream = stream;

    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    const ctx = new AC();
    micAudioCtx = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.4;
    source.connect(analyser);

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateMeter = () => {
      if (!meterFill || !micAudioCtx) return;
      analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      const avg = sum / bufferLength;
      const percent = Math.min(100, Math.round((avg / 128) * 100));

      meterFill.style.width = `${Math.max(4, percent)}%`;

      if (vuLevelText) {
        vuLevelText.textContent = percent > 8 ? 'Voice active' : 'Listening...';
      }

      micAnimationId = requestAnimationFrame(updateMeter);
    };

    updateMeter();
  } catch (err) {
    if (meterFill) meterFill.style.width = '0%';
    if (vuLevelText) vuLevelText.textContent = 'Mic off or blocked';
  }
}

function stopLiveMicMeter() {
  if (micAnimationId) {
    cancelAnimationFrame(micAnimationId);
    micAnimationId = null;
  }
  if (micAudioStream) {
    micAudioStream.getTracks().forEach(t => t.stop());
    micAudioStream = null;
  }
  if (micAudioCtx) {
    try { micAudioCtx.close(); } catch {}
    micAudioCtx = null;
  }
  if (meterFill) meterFill.style.width = '0%';
}

// Check and update mic status badge
async function refreshMicButton() {
  if (!micBadge || !micBtnText || !('permissions' in navigator)) return;
  try {
    // @ts-ignore - Chrome supports microphone query
    const status = await (navigator as any).permissions.query({ name: 'microphone' });

    const applyStatus = () => {
      if (status.state === 'granted') {
        micBadge.textContent = 'Ready & Active';
        micBadge.className = 'mic-badge ready';
        if (micBtnText) micBtnText.textContent = 'Microphone Enabled ✓';
        if (vuLevelText) vuLevelText.textContent = 'Mic ready';
        startLiveMicMeter().catch(() => {});
      } else if (status.state === 'denied') {
        micBadge.textContent = 'Blocked';
        micBadge.className = 'mic-badge warning';
        if (micBtnText) micBtnText.textContent = 'Microphone Blocked';
        if (vuLevelText) vuLevelText.textContent = 'Permission needed';
        stopLiveMicMeter();
      } else {
        micBadge.textContent = 'Permission Needed';
        micBadge.className = 'mic-badge warning';
        if (micBtnText) micBtnText.textContent = 'Enable Microphone';
        if (vuLevelText) vuLevelText.textContent = 'Click below to enable';
        stopLiveMicMeter();
      }
    };

    applyStatus();
    status.onchange = applyStatus;
  } catch {
    if (micBadge) micBadge.textContent = 'Available';
  }
}

// Inspect active tab URL - STRICT Google Meet & Live Call Validation
async function checkActiveTab(): Promise<chrome.tabs.Tab | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      setMeetStatus(false, null, false);
      return null;
    }

    const url = new URL(tab.url);
    const isMeet = url.hostname.includes('meet.google.com');

    if (isMeet) {
      const code = url.pathname.replace(/^\//, '').split('?')[0];

      // Query content script to check if the call is actively live inside the room
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'QUERY_MEET_STATUS' }, (res) => {
          if (!chrome.runtime.lastError && res) {
            setMeetStatus(true, res.meetingId || code || 'google-meet', !!res.isLive);
          } else {
            setMeetStatus(true, code || 'google-meet', true);
          }
        });
      } else {
        setMeetStatus(true, code || 'google-meet', true);
      }
      return tab;
    } else {
      setMeetStatus(false, null, false);
      return tab;
    }
  } catch {
    setMeetStatus(false, null, false);
    return null;
  }
}

function setMeetStatus(isMeet: boolean, meetCode: string | null, isLive: boolean = true) {
  isCurrentlyOnGoogleMeet = isMeet;

  if (meetBadge) {
    if (isMeet) {
      const cleanCode = meetCode && meetCode !== 'google-meet' && meetCode !== 'home' && meetCode !== '' ? meetCode : null;
      if (cleanCode) {
        meetBadge.textContent = isLive ? `Meet: ${cleanCode} (Live)` : `Meet: ${cleanCode}`;
        meetBadge.style.color = isLive ? '#86efac' : '#818cf8';
        meetBadge.style.background = isLive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(99, 102, 241, 0.12)';
      } else {
        meetBadge.textContent = 'Google Meet Ready';
        meetBadge.style.color = '#86efac';
        meetBadge.style.background = 'rgba(16, 185, 129, 0.15)';
      }
    } else {
      meetBadge.textContent = 'Not in Meet (Required)';
      meetBadge.style.color = '#f59e0b';
      meetBadge.style.background = 'rgba(245, 158, 11, 0.15)';
    }
  }

  if (meetNotice) {
    if (isMeet) {
      meetNotice.classList.remove('visible');
    } else {
      meetNotice.classList.add('visible');
    }
  }

  // Ensure button is ALWAYS enabled whenever on any Google Meet tab!
  if (!isCurrentlyRecording) {
    if (startBtn) {
      startBtn.disabled = !isMeet;
      startBtn.style.opacity = isMeet ? '1' : '0.5';
      startBtn.style.cursor = isMeet ? 'pointer' : 'not-allowed';
    }
    if (saveBtn) {
      saveBtn.disabled = !isMeet;
      saveBtn.style.opacity = isMeet ? '1' : '0.5';
      saveBtn.style.cursor = isMeet ? 'pointer' : 'not-allowed';
    }
  }
}

// Switch to an existing Google Meet tab or open a new one
openMeetBtn?.addEventListener('click', async () => {
  try {
    const meetTabs = await chrome.tabs.query({ url: 'https://meet.google.com/*' });
    if (meetTabs.length > 0 && meetTabs[0]?.id) {
      await chrome.tabs.update(meetTabs[0].id, { active: true });
      if (meetTabs[0].windowId) {
        await chrome.windows.update(meetTabs[0].windowId, { focused: true });
      }
      window.close();
    } else {
      await chrome.tabs.create({ url: 'https://meet.google.com/new' });
      window.close();
    }
  } catch (err) {
    await chrome.tabs.create({ url: 'https://meet.google.com/' });
    window.close();
  }
});

// Initialize popup
void (async () => {
  const activeTab = await checkActiveTab();
  try {
    const st = await chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' });
    setUI(!!st?.recording, st?.startTime);
  } catch {
    setUI(false);
  }

  // Check initial mute state from Google Meet if open
  if (activeTab?.id && activeTab.url?.startsWith('https://meet.google.com')) {
    try {
      chrome.tabs.sendMessage(activeTab.id, { type: 'QUERY_MIC_MUTE_STATE' }, (res) => {
        if (!chrome.runtime.lastError && res && typeof res.muted === 'boolean') {
          updateMuteButtonUI(res.muted);
        }
      });
    } catch {}
  }

  await refreshMicButton();
})();

// Toggle Mute Button Click Listener
toggleMuteBtn?.addEventListener('click', async () => {
  const nextMuted = !isMicMuted;
  updateMuteButtonUI(nextMuted);
  showToast(nextMuted ? '🔇 Microphone Muted in recording' : '🎙️ Microphone Unmuted & Live');

  // Broadcast to background / offscreen recording mixer
  chrome.runtime.sendMessage({ type: 'MEET_MIC_MUTE_STATE', muted: nextMuted }).catch(() => {});

  // Forward to Google Meet tab to sync in-call HUD
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url?.startsWith('https://meet.google.com')) {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_MIC_MUTED_FROM_POPUP', muted: nextMuted }).catch(() => {});
    }
  } catch {}
});

// React to background messages
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'RECORDING_STATE') {
    setUI(!!msg.recording, msg.startTime);
  }
  if (msg?.type === 'MEET_MIC_MUTE_STATE') {
    updateMuteButtonUI(!!msg.muted);
  }
  if (msg?.type === 'MEET_LIVE_STATE') {
    setMeetStatus(true, msg.meetingId, !!msg.isLive);
  }
  if (msg?.type === 'RECORDING_SAVED') {
    showToast(`Video saved: ${msg.filename || 'recording.webm'}`);
    setUI(false);
  }
});

// Clean up mic meter when popup closes
window.addEventListener('unload', () => {
  stopLiveMicMeter();
});

// Enable / prime mic permission
micBtn?.addEventListener('click', async () => {
  try {
    if ('permissions' in navigator) {
      // @ts-ignore
      const p = await (navigator as any).permissions.query({ name: 'microphone' });
      if (p.state === 'granted') {
        showToast('Microphone is active & ready for recording.');
        await refreshMicButton();
        return;
      }
      if (p.state === 'denied') {
        await openMicSetupTab();
        return;
      }
    }

    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      showToast('Microphone enabled successfully!');
      await refreshMicButton();
    } catch {
      await openMicSetupTab();
    }
  } catch (e) {
    console.error('[popup] mic enable error', e);
    await openMicSetupTab();
  }
});

// Download transcript (Only for Google Meet)
saveBtn?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !tab.url.startsWith('https://meet.google.com')) {
    showToast('Transcripts are only available in an active Google Meet call.');
    return;
  }

  const res = await chrome.tabs
    .sendMessage(tab.id, { type: 'GET_TRANSCRIPT' })
    .catch((_e) => {
      showToast('Captions not found. Make sure CC is ON in Meet.');
      return undefined;
    });

  const transcript = (res as any)?.transcript as string | undefined;
  if (!transcript?.trim()) {
    showToast('Transcript is empty. Turn on CC in Google Meet.');
    return;
  }

  const blob = new Blob([transcript], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const suffix =
    new URL(tab.url).pathname.split('/').filter(Boolean).pop() || 'google-meet';

  chrome.downloads.download(
    { url, filename: `google-meet-transcript-${suffix}-${Date.now()}.txt`, saveAs: true },
    () => {
      URL.revokeObjectURL(url);
      showToast('Transcript downloaded (.txt)');
    }
  );
});

let inFlight = false;

// Start Recording (Only for Google Meet)
startBtn?.addEventListener('click', async () => {
  if (!startBtn || inFlight) return;

  // Release local preview mic so offscreen document can acquire it without device lock
  stopLiveMicMeter();

  let tab: chrome.tabs.Tab | undefined;
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = tabs[0];
    if (!tab?.url) {
      const fallbackTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tab = fallbackTabs[0];
    }
  } catch {}

  if (!tab?.id || !tab?.url || !tab.url.startsWith('https://meet.google.com')) {
    showToast('Please open or switch to an active Google Meet tab first.');
    return;
  }

  inFlight = true;
  startBtn.disabled = true;
  showToast('Starting recording…');

  try {
    // Reset transcript buffer in Meet tab
    await chrome.tabs.sendMessage(tab.id, { type: 'RESET_TRANSCRIPT' }).catch(() => {});

    const resp = await chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId: tab.id });
    if (!resp) throw new Error('No response received from background service worker');
    if (resp.ok === false) throw new Error(resp.error || 'Failed to start recording');

    setUI(true, Date.now());
    showToast('HD Meeting Recording is LIVE!');
  } catch (e: any) {
    console.error('[popup] START_RECORDING error', e);
    setUI(false);
    showToast(`Error: ${e?.message || e}`);
    // Resume preview if start failed
    startLiveMicMeter().catch(() => {});
  } finally {
    inFlight = false;
  }
});

// Stop Recording
stopBtn?.addEventListener('click', async () => {
  if (!stopBtn || inFlight) return;
  inFlight = true;
  stopBtn.disabled = true;
  showToast('Finalizing and preparing video download...');

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'STOP_RECORDING' });
    if (!resp) throw new Error('No response from background');
    if (resp.ok === false) throw new Error(resp.error || 'Failed to stop recording');
  } catch (e: any) {
    console.error('[popup] STOP_RECORDING error', e);
    showToast(`Stop error: ${e?.message || e}`);
    setUI(false);
  } finally {
    inFlight = false;
  }
});


