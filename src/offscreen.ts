// src/offscreen.ts
export {}

const WANT_MIC_MIX = true

window.addEventListener('error', (e) => {
  console.error('[offscreen] window.onerror', e?.message, e?.error)
})
window.addEventListener('unhandledrejection', (e: any) => {
  console.error('[offscreen] unhandledrejection', e?.reason || e)
})
console.log('[offscreen] audio & recording engine active')

// Port plumbing
let portRef: chrome.runtime.Port | null = null
function log(...a: any[]) { console.log('[offscreen]', ...a) }

function connectPort(): chrome.runtime.Port {
  try { portRef?.disconnect() } catch {}
  const p: chrome.runtime.Port = chrome.runtime.connect({ name: 'offscreen' })
  p.onDisconnect.addListener(() => { log('Port disconnected'); portRef = null })
  p.postMessage({ type: 'OFFSCREEN_READY' })
  log('READY signaled via Port')
  portRef = p
  return p
}
function getPort(): chrome.runtime.Port { return portRef ?? connectPort() }
function respond(req: any, payload: any) { getPort().postMessage({ __respFor: req?.__id, payload }) }

function pushState(recording: boolean, extra?: Record<string, any>) {
  try { 
    (chrome.storage as any)?.session?.set?.({ 
      recording, 
      recordingStartTime: recording ? (extra?.startTime || Date.now()) : 0 
    }).catch?.(() => {}) 
  } catch {}
  getPort().postMessage({ type: 'RECORDING_STATE', recording, ...extra })
}

function inferSuffixFromActiveTabUrl(url?: string | null): string {
  try {
    if (!url) return 'google-meet'
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop() || 'google-meet'
    return last
  } catch { return 'google-meet' }
}

let activeAudioCtx: AudioContext | null = null
let mediaRecorder: MediaRecorder | null = null
let chunks: BlobPart[] = []
let capturing = false
let activeBaseStream: MediaStream | null = null
let activeMicStream: MediaStream | null = null
let activeMicGainNode: GainNode | null = null
let activeMicTrack: MediaStreamTrack | null = null
let isMicMutedInMeet: boolean = false

// Dynamic mic mute control
function setMicMuted(muted: boolean) {
  isMicMutedInMeet = muted
  log('Dynamically setting mic mute in recording mixer:', muted ? 'MUTED' : 'UNMUTED')

  if (activeMicGainNode && activeAudioCtx) {
    try {
      activeMicGainNode.gain.setValueAtTime(muted ? 0.0 : 1.35, activeAudioCtx.currentTime)
      activeMicGainNode.gain.value = muted ? 0.0 : 1.35
    } catch (e) {
      log('Failed to update mic gain:', e)
    }
  }

  if (activeMicTrack) {
    try {
      activeMicTrack.enabled = !muted
    } catch {}
  }

  if (activeMicStream) {
    try {
      activeMicStream.getAudioTracks().forEach(t => { t.enabled = !muted })
    } catch {}
  }
}

// Acquire microphone stream safely
async function maybeGetMicStream(): Promise<MediaStream | null> {
  if (!WANT_MIC_MIX) return null
  try {
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    })
    const t = mic.getAudioTracks()[0]
    activeMicTrack = t || null
    log('Mic stream acquired successfully:', t?.label || 'default')
    return mic
  } catch (e) {
    log('Mic stream unavailable (continuing with tab audio only):', e)
    return null
  }
}

let activeTabSourceNode: MediaStreamAudioSourceNode | null = null
let activeMicSourceNode: MediaStreamAudioSourceNode | null = null
let activePlaybackAudio: HTMLAudioElement | null = null

/**
 * Guaranteed Tab & Mic Audio Engine.
 * Direct pristine tab capture + speaker playback + optional mic mixer.
 */
async function mixAudioStreams(tabStream: MediaStream, micStream: MediaStream | null): Promise<MediaStream> {
  const tabAudioTracks = tabStream.getAudioTracks()
  const micAudioTracks = micStream ? micStream.getAudioTracks() : []

  log(`Audio Engine -> Tab Audio Tracks: ${tabAudioTracks.length}, Mic Tracks: ${micAudioTracks.length}`)

  tabAudioTracks.forEach(t => { t.enabled = true })
  micAudioTracks.forEach(t => { t.enabled = true })

  // 1. Play tab audio in offscreen document so the user can hear the meeting normally
  if (tabAudioTracks.length > 0) {
    try {
      if (!activePlaybackAudio) {
        activePlaybackAudio = new Audio()
        activePlaybackAudio.autoplay = true
      }
      activePlaybackAudio.srcObject = tabStream
      activePlaybackAudio.play().catch(e => log('Speaker playback play error:', e))
      log('Tab audio speaker playback active')
    } catch (e) {
      log('Speaker playback init error:', e)
    }
  }

  // 2. If no microphone stream is present, use direct pristine tab audio stream directly!
  // This guarantees 100% perfect, uncompressed Google Meet audio recording with zero Web Audio dropouts!
  if (!micStream || micAudioTracks.length === 0) {
    log('Recording with DIRECT tab audio stream (All meeting voices captured directly)')
    return new MediaStream([
      ...tabStream.getVideoTracks(),
      ...tabStream.getAudioTracks()
    ])
  }

  // 3. Mix Tab Audio + Microphone Audio using active Web Audio hardware graph
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
    const ctx = new AC()
    activeAudioCtx = ctx

    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }

    const destination = ctx.createMediaStreamDestination()

    // Route tab audio into recording destination & hardware speakers
    if (tabAudioTracks.length > 0) {
      const tabSource = ctx.createMediaStreamSource(tabStream)
      activeTabSourceNode = tabSource
      const tabGain = ctx.createGain()
      tabGain.gain.setValueAtTime(1.0, ctx.currentTime)
      tabSource.connect(tabGain)
      
      // Feed to MediaRecorder destination
      tabGain.connect(destination)
      // Feed to physical speakers: THIS FORCES CHROMIUM'S AUDIO GRAPH TO PULL SAMPLES!
      try { tabGain.connect(ctx.destination) } catch {}
      log('Tab audio connected to recorder destination & hardware output')
    }

    // Route mic audio into recording destination
    if (micAudioTracks.length > 0 && micStream) {
      const micSource = ctx.createMediaStreamSource(micStream)
      activeMicSourceNode = micSource
      const micGain = ctx.createGain()
      const initialGain = isMicMutedInMeet ? 0.0 : 1.35
      micGain.gain.setValueAtTime(initialGain, ctx.currentTime)
      activeMicGainNode = micGain
      micSource.connect(micGain)
      
      // Feed to MediaRecorder destination (not ctx.destination to avoid local mic echo)
      micGain.connect(destination)
      log('Mic audio connected to recorder destination. Initial gain:', initialGain)
    }

    // Keep-alive oscillator connected to ctx.destination ensures continuous hardware sample clock
    const osc = ctx.createOscillator()
    const oscGain = ctx.createGain()
    oscGain.gain.setValueAtTime(0.00001, ctx.currentTime)
    osc.connect(oscGain)
    oscGain.connect(ctx.destination)
    oscGain.connect(destination)
    osc.start()

    const mixedAudioTracks = destination.stream.getAudioTracks()
    if (mixedAudioTracks.length > 0) {
      mixedAudioTracks[0].enabled = true
      log('Web Audio mixer active with hardware clock. Output tracks:', mixedAudioTracks.length)
      return new MediaStream([
        ...tabStream.getVideoTracks(),
        mixedAudioTracks[0]
      ])
    }
  } catch (err) {
    log('Web Audio mixer error, falling back to direct tab stream:', err)
  }

  // Fallback: direct tab audio
  return new MediaStream([
    ...tabStream.getVideoTracks(),
    ...tabStream.getAudioTracks()
  ])
}

// Clean MediaStream constraints for tabCapture
function makeTabConstraints(streamId: string): MediaStreamConstraints {
  return {
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    } as any,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    } as any
  }
}

async function captureWithStreamId(streamId: string): Promise<MediaStream> {
  log(`Acquiring tab stream for streamId: ${streamId}`)
  const s = await navigator.mediaDevices.getUserMedia(makeTabConstraints(streamId))
  log('Tab stream acquired. Video tracks:', s.getVideoTracks().length, 'Audio tracks:', s.getAudioTracks().length)
  return s
}

async function prepareAndRecord(baseStream: MediaStream): Promise<void> {
  activeBaseStream = baseStream
  const videoTracks = baseStream.getVideoTracks()
  const audioTracks = baseStream.getAudioTracks()

  if (!videoTracks.length) {
    throw new Error('No video track captured from Google Meet tab')
  }

  audioTracks.forEach((t) => {
    try { t.enabled = true } catch {}
  })

  // Acquire Mic Stream & Mix
  activeMicStream = await maybeGetMicStream()
  const finalStream = await mixAudioStreams(baseStream, activeMicStream)

  chunks = []
  
  // Prefer native MP4 encoding (H.264/AVC + AAC), fallback to WebM
  const preferredMimes = [
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4;codecs=avc1',
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]

  let mime = ''
  for (const m of preferredMimes) {
    if (MediaRecorder.isTypeSupported(m)) {
      mime = m
      break
    }
  }

  log('Creating MediaRecorder with MIME:', mime || 'browser-default')

  const recorderOptions: MediaRecorderOptions = {
    videoBitsPerSecond: 3_000_000,
    audioBitsPerSecond: 192_000
  }
  if (mime) recorderOptions.mimeType = mime

  mediaRecorder = new MediaRecorder(finalStream, recorderOptions)

  mediaRecorder.ondataavailable = (e: BlobEvent) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data)
    }
  }

  mediaRecorder.onerror = (e: any) => {
    log('MediaRecorder error event:', e)
    cleanupStreams(finalStream)
    mediaRecorder = null
    capturing = false
    pushState(false)
  }

  mediaRecorder.onstop = async () => {
    try {
      const blobType = mime || 'video/mp4'
      const blob = new Blob(chunks, { type: blobType })
      log('Recording finished. Chunks:', chunks.length, 'Size:', blob.size)

      let suffix = 'google-meet'
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        suffix = inferSuffixFromActiveTabUrl(tabs[0]?.url || null)
      } catch {}

      const ext = mime.includes('mp4') ? 'mp4' : 'mp4'
      const filename = `google-meet-recording-${suffix}-${Date.now()}.${ext}`
      const blobUrl = URL.createObjectURL(blob)
      getPort().postMessage({ type: 'OFFSCREEN_SAVE', filename, blobUrl })
    } catch (e) {
      log('Saving recording failed:', e)
    } finally {
      cleanupStreams(finalStream)
      mediaRecorder = null
      chunks = []
      capturing = false
      pushState(false)
    }
  }

  // Start recording with 1000ms chunk intervals
  mediaRecorder.start(1000)
  capturing = true
  const startTime = Date.now()
  pushState(true, { startTime })
  log('Recording started successfully at', startTime)

  // Auto-stop if user navigates or closes the tab
  finalStream.getVideoTracks()[0]?.addEventListener('ended', () => {
    log('Tab video stream ended')
    if (mediaRecorder && capturing) {
      try { mediaRecorder.stop() } catch {}
    }
  })
}

function cleanupStreams(finalStream?: MediaStream) {
  try { finalStream?.getTracks().forEach(t => t.stop()) } catch {}
  try { activeBaseStream?.getTracks().forEach(t => t.stop()) } catch {}
  try { activeMicStream?.getTracks().forEach(t => t.stop()) } catch {}
  activeBaseStream = null
  activeMicStream = null
  if (activeAudioCtx) {
    try { activeAudioCtx.close() } catch {}
    activeAudioCtx = null
  }
}

async function startRecordingFromStreamId(streamId: string): Promise<void> {
  if (capturing) {
    log('Already recording; ignoring start request')
    return
  }
  const baseStream = await captureWithStreamId(streamId)
  await prepareAndRecord(baseStream)
}

function stopRecording() {
  if (!mediaRecorder || !capturing) {
    console.warn('[offscreen] Stop requested but not capturing')
    throw new Error('Not currently recording')
  }
  try {
    mediaRecorder.stop()
  } catch (e) {
    console.error('[offscreen] Stop error:', e)
    throw e
  }
}

// RPC Messaging
const rpcPort = getPort()
rpcPort.onMessage.addListener(async (msg: any) => {
  try {
    if (msg?.type === 'OFFSCREEN_START') {
      const streamId = msg.streamId as string | undefined
      if (!streamId) return respond(msg, { ok: false, error: 'Missing streamId' })
      try {
        await startRecordingFromStreamId(streamId)
        return respond(msg, { ok: true })
      } catch (e: any) {
        log('startRecordingFromStreamId failed:', e)
        return respond(msg, { ok: false, error: `${e?.name || 'Error'}: ${e?.message || e}` })
      }
    }

    if (msg?.type === 'OFFSCREEN_STOP') {
      try {
        stopRecording()
        return respond(msg, { ok: true })
      } catch (e) {
        return respond(msg, { ok: false, error: String(e) })
      }
    }

    if (msg?.type === 'SET_MIC_MUTED') {
      setMicMuted(!!msg.muted)
      return
    }

    if (msg?.type === 'OFFSCREEN_STATUS') {
      let recording = false
      try {
        const res = await (chrome.storage as any)?.session?.get?.(['recording'])
        recording = !!res?.recording
      } catch {}
      return respond(msg, { recording })
    }

    if (msg?.type === 'DIAG_ECHO') {
      return respond(msg, { ok: true, pong: 'offscreen-alive' })
    }

    if (msg?.type === 'REVOKE_BLOB_URL' && typeof msg.blobUrl === 'string') {
      try { URL.revokeObjectURL(msg.blobUrl) } catch {}
      return
    }
  } catch (e) {
    console.error('[offscreen] RPC listener error:', e)
    respond(msg, { ok: false, error: String(e) })
  }
})

// Handshake listener
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  try {
    if (msg?.type === 'OFFSCREEN_PING') { sendResponse({ ok: true, via: 'onMessage' }); return true }
    if (msg?.type === 'OFFSCREEN_CONNECT') { connectPort(); sendResponse({ ok: true }); return true }
  } catch (e) { sendResponse({ ok: false, error: String(e) }) }
  return false
})


