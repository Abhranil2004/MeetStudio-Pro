// src/scrapingScript.ts
export {}

let transcript: string[] = []

interface Chunk {
  startTime: number
  endTime: number
  speaker: string
  text: string
}
type OpenChunk = Chunk & { timer: number }

const CHUNK_GRACE_MS = 2000

const prior = new Map<string, OpenChunk>()
const lastSeen = new Map<string, string>()

const normalize = (pre: string) =>
  pre.toLowerCase().replace(/[.,?!'"\u2019]/g, "").replace(/\s+/g, " ").trim()

function handleCaption(speakerKey: string, speakerName: string, rawText: string){
  const text = rawText.trim()
  if(!text) return

  const norm = normalize(text)
  const prev = lastSeen.get(speakerKey)
  if (prev === norm) return
  lastSeen.set(speakerKey, norm)

  const now = Date.now()
  const existing = prior.get(speakerKey)

  if (!existing){
    const timer = window.setTimeout(() => commit(speakerKey), CHUNK_GRACE_MS)
    prior.set(speakerKey, {
      startTime: now,
      endTime: now,
      speaker: speakerName,
      text,
      timer
    })
    return
  }

  existing.endTime = now
  existing.text = text
  existing.speaker = speakerName

  clearTimeout(existing.timer)
  existing.timer = window.setTimeout(() => commit(speakerKey), CHUNK_GRACE_MS)
}

function commit(key: string){
  const entry = prior.get(key)
  if(!entry) return

  const startTS = new Date(entry.startTime).toISOString()
  const endTS = new Date(entry.endTime).toISOString()
  transcript.push(`[${startTS}] [${endTS}] ${entry.speaker} : ${entry.text}`.trim())
  clearTimeout(entry.timer)
  prior.delete(key)
}

let captionSelector = '.ygicle'
let speakerSelector = '.NWpY1d'
let captionParent  = '.nMcdL'

let captionObserver: MutationObserver | null = null

function scanClasses(cl: HTMLElement){
  const txtNode = cl.querySelector<HTMLDivElement>(captionSelector)
  if(!txtNode) return

  const speakerName = cl.querySelector<HTMLElement>(speakerSelector)?.textContent?.trim() ?? ' '
  const key = cl.getAttribute('data-participant-id') || speakerName

  const push = () => {
    const trimmed = txtNode.textContent?.trim() ?? ''
    if(trimmed) handleCaption(key, speakerName, trimmed)
  }

  push()

  new MutationObserver(push).observe(txtNode, { childList: true, subtree: true, characterData: true })
}

function launchAttachObserver(region: HTMLElement) {
  captionObserver?.disconnect()

  captionObserver = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        if (node instanceof HTMLElement && node.matches(captionParent)) {
          scanClasses(node)
        }
      })
    })
  })

  captionObserver.observe(region, { childList: true, subtree: true })
  console.log(`Caption observer attached`)
  region.querySelectorAll<HTMLElement>(captionParent).forEach(scanClasses)
}

new MutationObserver(() => {
  const region = document.querySelector<HTMLElement>('div[role="region"][aria-label="Captions"]')
  if(region){
    launchAttachObserver(region)
  }
}).observe(document.body, { childList: true, subtree: true })

// Mute state detection for Google Meet
let lastMuteState: boolean | null = null

function checkGoogleMeetMicMuted(): boolean {
  try {
    // Check 1: data-is-muted attribute anywhere in the controls
    const mutedElements = document.querySelectorAll('[data-is-muted]')
    for (const el of Array.from(mutedElements)) {
      const val = el.getAttribute('data-is-muted')
      if (val === 'true') return true
      if (val === 'false') return false
    }

    // Check 2: Find all microphone buttons in Google Meet bottom bar
    const micButtons = document.querySelectorAll(
      'button[data-tooltip*="microphone" i], button[data-tooltip*="mic" i], ' +
      'button[aria-label*="microphone" i], button[aria-label*="mic" i], ' +
      'div[role="button"][aria-label*="microphone" i], div[role="button"][data-tooltip*="mic" i]'
    )

    for (const btn of Array.from(micButtons)) {
      // 2a: Check text content of icons inside the button (e.g. 'mic_off' vs 'mic')
      const text = btn.textContent || ''
      if (text.includes('mic_off')) return true
      if (text.includes('mic') && !text.includes('mic_off')) {
        // Also check if aria-label explicitly says turn on / off
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase()
        if (aria.includes('turn on') || aria.includes('is off') || aria.includes('unmute')) return true
        if (aria.includes('turn off') || aria.includes('is on') || aria.includes('mute')) return false
      }

      // 2b: Check aria-label / data-tooltip
      const label = ((btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('data-tooltip') || '')).toLowerCase()
      if (label.includes('turn on') || label.includes('is off') || label.includes('unmute') || label.includes('activar') || label.includes('activer') || label.includes('einschalten')) {
        return true
      }
      if (label.includes('turn off') || label.includes('is on') || label.includes('desactivar') || label.includes('désactiver') || label.includes('ausschalten')) {
        return false
      }

      // 2c: Computed Style Check - Google Meet ALWAYS turns the mic button RED when muted!
      try {
        const style = window.getComputedStyle(btn as Element)
        const bg = style.backgroundColor || ''
        // Check for red color rgb(234, 67, 53) or any red dominant background
        if (bg.includes('234, 67, 53') || bg.includes('217, 48, 37') || bg.includes('179, 38, 30')) {
          return true
        }
      } catch {}
    }

    // Check 3: Search for any standalone mic_off material icon in bottom bar
    const micOffIcons = document.querySelectorAll('i, span')
    for (const icon of Array.from(micOffIcons)) {
      if (icon.textContent?.trim() === 'mic_off') {
        const parentBtn = icon.closest('button, [role="button"]')
        if (parentBtn) return true
      }
    }
  } catch {}

  return false
}

function syncMicMuteState() {
  const isMuted = checkGoogleMeetMicMuted()
  if (isMuted !== lastMuteState) {
    lastMuteState = isMuted
    console.log('[MeetContentScript] Google Meet Mic Mute state is now:', isMuted ? 'MUTED' : 'UNMUTED')

    // Update in-meeting HUD status
    const micStatusSpan = document.getElementById('gmeet-rec-mic-status')
    if (micStatusSpan) {
      micStatusSpan.textContent = isMuted ? '• 🔇 Mic Muted' : '• 🎙️ Mic Live'
      micStatusSpan.style.color = isMuted ? '#fca5a5' : '#86efac'
    }

    chrome.runtime.sendMessage({
      type: 'MEET_MIC_MUTE_STATE',
      muted: isMuted
    }).catch(() => {})
  }
}

// Check on clicks, mouse movements in bottom bar, and shortcuts (Ctrl+D / Cmd+D)
window.addEventListener('click', () => {
  setTimeout(syncMicMuteState, 50)
  setTimeout(syncMicMuteState, 200)
}, true)

window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'd') {
    setTimeout(syncMicMuteState, 50)
    setTimeout(syncMicMuteState, 250)
  }
}, true)

// High-frequency check (every 300ms) to ensure instant synchronization
setInterval(syncMicMuteState, 300)

// Meeting ID Analyzer & In-Call Live Detector
function getGoogleMeetingId(): string | null {
  try {
    const path = window.location.pathname;
    const match = path.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i) || path.match(/\/([a-z0-9_-]{9,12})/i);
    if (match && match[1]) {
      return match[1].toLowerCase();
    }
    const elem = document.querySelector('[data-meeting-code], [data-unresolved-meeting-id]');
    if (elem) {
      const attr = elem.getAttribute('data-meeting-code') || elem.getAttribute('data-unresolved-meeting-id');
      if (attr) return attr.toLowerCase();
    }
  } catch {}
  return null;
}

function isMeetingCallLive(): boolean {
  try {
    const leaveBtn = document.querySelector('button[aria-label*="Leave call" i], button[aria-label*="leave" i], [data-call-ended]');
    const callControls = document.querySelector('[role="region"][aria-label*="controls" i], [data-is-muted]');
    return !!(leaveBtn || callControls);
  } catch {
    return false;
  }
}

function isInsideMeetingRoom(): boolean {
  try {
    const path = window.location.pathname;
    return /\/([a-z]{3}-[a-z]{4}-[a-z]{3})/i.test(path) || (path.length > 5 && path !== '/' && !path.startsWith('/landing') && !path.startsWith('/home'));
  } catch {
    return false;
  }
}

let lastLiveState = false;
let currentMeetingId = getGoogleMeetingId();

function checkLiveMeetingState() {
  const isLive = isMeetingCallLive();
  const meetId = getGoogleMeetingId() || currentMeetingId;
  const inRoom = isInsideMeetingRoom();

  const hudContainer = document.getElementById('gmeet-rec-hud-container');
  const label = document.getElementById('gmeet-rec-label');

  if (inRoom) {
    if (hudContainer) hudContainer.style.display = 'flex';
    if (label && !inMeetingTimerInterval) {
      label.textContent = meetId ? `Record Meeting (${meetId})` : 'Record Meeting';
    }
  } else {
    // Hide HUD completely when on Google Meet home page
    if (hudContainer) hudContainer.style.display = 'none';
  }

  if (isLive !== lastLiveState || meetId !== currentMeetingId) {
    lastLiveState = isLive;
    currentMeetingId = meetId;

    if (isLive && inRoom) {
      showMeetToast(`⚡ Google Meet ${meetId ? `(${meetId})` : ''} is LIVE — Recording Ready`);
    }

    chrome.runtime.sendMessage({
      type: 'MEET_LIVE_STATE',
      isLive: isLive && inRoom,
      meetingId: inRoom ? meetId : null
    }).catch(() => {});
  }
}

// In-Meeting Google Meet Native Recording HUD & UI Overlay
let inMeetingTimerInterval: number | null = null
let inMeetingStartTime = 0

function createInMeetingUI() {
  if (document.getElementById('gmeet-rec-hud-container')) return

  const container = document.createElement('div')
  container.id = 'gmeet-rec-hud-container'
  container.style.cssText = `
    position: fixed;
    top: 16px;
    left: 24px;
    z-index: 9999999;
    display: ${isInsideMeetingRoom() ? 'flex' : 'none'};
    align-items: center;
    gap: 8px;
    font-family: 'Google Sans', Roboto, -apple-system, sans-serif;
    user-select: none;
    pointer-events: auto;
  `

  const pill = document.createElement('button')
  pill.id = 'gmeet-rec-pill'
  pill.style.cssText = `
    display: flex;
    align-items: center;
    gap: 9px;
    background: rgba(18, 20, 28, 0.88);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.14);
    border-radius: 9999px;
    padding: 7px 16px;
    color: #ffffff;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
  `

  const dot = document.createElement('span')
  dot.id = 'gmeet-rec-dot'
  dot.style.cssText = `
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: #64748b;
    display: inline-block;
    transition: all 0.25s ease;
  `

  const meetId = getGoogleMeetingId();
  const label = document.createElement('span')
  label.id = 'gmeet-rec-label'
  label.textContent = meetId ? `Record Meeting (${meetId})` : 'Record Meeting'
  label.style.cssText = `
    letter-spacing: -0.2px;
  `

  const timerSpan = document.createElement('span')
  timerSpan.id = 'gmeet-rec-timer'
  timerSpan.style.cssText = `
    display: none;
    font-family: 'Roboto Mono', monospace;
    font-size: 12.5px;
    font-weight: 600;
    color: #fda4af;
    letter-spacing: 0.5px;
  `

  const micStatusSpan = document.createElement('span')
  micStatusSpan.id = 'gmeet-rec-mic-status'
  micStatusSpan.style.cssText = `
    display: none;
    font-size: 11px;
    font-weight: 600;
    margin-left: 2px;
    padding: 2px 7px;
    border-radius: 9999px;
    background: rgba(255, 255, 255, 0.08);
    transition: all 0.2s ease;
  `

  pill.appendChild(dot)
  pill.appendChild(label)
  pill.appendChild(timerSpan)
  pill.appendChild(micStatusSpan)

  pill.addEventListener('mouseenter', () => {
    pill.style.background = 'rgba(30, 34, 48, 0.95)'
    pill.style.transform = 'translateY(-1px) scale(1.02)'
    pill.style.boxShadow = '0 12px 36px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.15)'
  })
  pill.addEventListener('mouseleave', () => {
    pill.style.background = 'rgba(18, 20, 28, 0.88)'
    pill.style.transform = 'translateY(0) scale(1.0)'
    pill.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.05)'
  })

  pill.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'CONTENT_TOGGLE_RECORDING' }, (res) => {
      if (res?.action === 'started') {
        showMeetToast('🔴 Google Meet Recording active')
      } else if (res?.action === 'stopped') {
        showMeetToast('⏹ Recording saved to Downloads')
      }
    })
  })

  container.appendChild(pill)
  document.body.appendChild(container)
}

function updateInMeetingHUD(recording: boolean, startTime?: number) {
  createInMeetingUI()
  const pill = document.getElementById('gmeet-rec-pill')
  const dot = document.getElementById('gmeet-rec-dot')
  const label = document.getElementById('gmeet-rec-label')
  const timerSpan = document.getElementById('gmeet-rec-timer')
  const micStatusSpan = document.getElementById('gmeet-rec-mic-status')

  if (!pill || !dot || !label || !timerSpan) return

  const meetId = getGoogleMeetingId() || currentMeetingId;

  if (recording) {
    pill.style.border = '1px solid rgba(234, 67, 53, 0.5)'
    dot.style.backgroundColor = '#ea4335'
    dot.style.boxShadow = '0 0 8px #ea4335'
    dot.style.animation = 'meet-pulse 1.2s infinite'

    label.textContent = meetId ? `REC (${meetId})` : 'REC'
    timerSpan.style.display = 'inline'
    if (micStatusSpan) {
      micStatusSpan.style.display = 'inline'
      const isMuted = checkGoogleMeetMicMuted()
      micStatusSpan.textContent = isMuted ? '• 🔇 Mic Muted' : '• 🎙️ Mic Live'
      micStatusSpan.style.color = isMuted ? '#fca5a5' : '#86efac'
    }

    inMeetingStartTime = startTime && startTime > 0 ? startTime : Date.now()
    if (inMeetingTimerInterval) clearInterval(inMeetingTimerInterval)

    const updateTimer = () => {
      const elapsed = Date.now() - inMeetingStartTime
      const totalSec = Math.max(0, Math.floor(elapsed / 1000))
      const h = Math.floor(totalSec / 3600)
      const m = Math.floor((totalSec % 3600) / 60)
      const s = totalSec % 60
      timerSpan.textContent = [
        h > 0 ? h.toString().padStart(2, '0') : null,
        m.toString().padStart(2, '0'),
        s.toString().padStart(2, '0')
      ].filter(Boolean).join(':')
    }
    updateTimer()
    inMeetingTimerInterval = window.setInterval(updateTimer, 500)
  } else {
    pill.style.border = '1px solid rgba(255, 255, 255, 0.15)'
    dot.style.backgroundColor = '#9aa0a6'
    dot.style.boxShadow = 'none'
    dot.style.animation = 'none'

    label.textContent = meetId ? `Record Meeting (${meetId})` : 'Record Meeting'
    timerSpan.style.display = 'none'
    if (micStatusSpan) {
      micStatusSpan.style.display = 'none'
    }

    if (inMeetingTimerInterval) {
      clearInterval(inMeetingTimerInterval)
      inMeetingTimerInterval = null
    }
  }
}

// In-Meeting native toast banner
function showMeetToast(msg: string) {
  const existing = document.getElementById('gmeet-rec-toast')
  if (existing) existing.remove()

  const toast = document.createElement('div')
  toast.id = 'gmeet-rec-toast'
  toast.textContent = msg
  toast.style.cssText = `
    position: fixed;
    bottom: 90px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(32, 33, 36, 0.95);
    backdrop-filter: blur(8px);
    color: #ffffff;
    font-family: 'Google Sans', Roboto, sans-serif;
    font-size: 13.5px;
    font-weight: 500;
    padding: 10px 22px;
    border-radius: 8px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.12);
    z-index: 999999;
    animation: meet-toast-in 0.25s ease;
  `
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 4000)
}

// CSS Animations injection
const styleTag = document.createElement('style')
styleTag.textContent = `
  @keyframes meet-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.35); opacity: 0.5; }
  }
  @keyframes meet-toast-in {
    from { opacity: 0; transform: translate(-50%, 10px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
`
document.head.appendChild(styleTag)

// Initialize in-meeting HUD when joining call
function initMeetingHUD() {
  createInMeetingUI()
  checkLiveMeetingState()
  chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => {
    if (!chrome.runtime.lastError && res) {
      updateInMeetingHUD(!!res.recording, res.startTime)
    }
  })
}

// Sync HUD on recording state broadcast and handle popup queries
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'RECORDING_STATE') {
    updateInMeetingHUD(!!msg.recording, msg.startTime)
    if (msg.recording) {
      showMeetToast('🔴 Google Meet Recording active')
    }
  }
  if (msg?.type === 'SET_MIC_MUTED_FROM_POPUP') {
    const isMuted = !!msg.muted
    lastMuteState = isMuted
    const micStatusSpan = document.getElementById('gmeet-rec-mic-status')
    if (micStatusSpan) {
      micStatusSpan.textContent = isMuted ? '• 🔇 Mic Muted' : '• 🎙️ Mic Live'
      micStatusSpan.style.color = isMuted ? '#fca5a5' : '#86efac'
    }
    showMeetToast(isMuted ? '🔇 Microphone Muted in recording' : '🎙️ Microphone Live in recording')
  }
  if (msg?.type === 'QUERY_MEET_STATUS') {
    sendResponse({
      isLive: isMeetingCallLive(),
      meetingId: getGoogleMeetingId() || currentMeetingId
    })
    return true
  }
})

// Auto-inject HUD and start live state poller
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initMeetingHUD)
} else {
  initMeetingHUD()
}

// High-frequency live state poller (checks every 500ms)
setInterval(checkLiveMeetingState, 500)

// Auto-stop when user clicks Leave Call (hang up)
window.addEventListener('click', (e) => {
  const target = e.target as HTMLElement | null
  const leaveBtn = target?.closest('button[aria-label*="Leave call" i], button[aria-label*="leave" i], [data-call-ended]')
  if (leaveBtn) {
    chrome.runtime.sendMessage({ type: 'GET_RECORDING_STATUS' }, (res) => {
      if (res?.recording) {
        chrome.runtime.sendMessage({ type: 'STOP_RECORDING' })
      }
    })
  }
  setTimeout(checkLiveMeetingState, 200)
}, true)

console.log('MeetStudio in-meeting controller loaded')


