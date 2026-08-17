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

// Content Script for Caption Scraping, Mute Detection, and Call Lifecycle
let lastLiveState = false
let currentMeetingId = getGoogleMeetingId()

function checkLiveMeetingState() {
  const isLive = isMeetingCallLive()
  const meetId = getGoogleMeetingId() || currentMeetingId

  if (isLive !== lastLiveState || meetId !== currentMeetingId) {
    lastLiveState = isLive
    currentMeetingId = meetId

    chrome.runtime.sendMessage({
      type: 'MEET_LIVE_STATE',
      isLive,
      meetingId: meetId
    }).catch(() => {})
  }
}

// Handle popup queries
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'QUERY_MEET_STATUS') {
    sendResponse({
      isLive: isMeetingCallLive(),
      meetingId: getGoogleMeetingId() || currentMeetingId
    })
    return true
  }
})

// High-frequency live state poller
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

console.log('MeetStudio in-meeting caption & mute controller loaded')


