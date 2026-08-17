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

/**
 * Mix Tab and Mic audio streams using Web Audio API.
 * Uses a silent keep-alive node to prevent AudioContext clock stalls.
 */
async function mixAudioStreams(tabStream: MediaStream, micStream: MediaStream | null): Promise<MediaStream> {
  const tabAudioTracks = tabStream.getAudioTracks()
  const micAudioTracks = micStream ? micStream.getAudioTracks() : []

  log(`Audio Tracks -> Tab: ${tabAudioTracks.length}, Mic: ${micAudioTracks.length}`)

  // If no mic is available, use tab audio directly without AudioContext overhead
  if (micAudioTracks.length === 0) {
    log('Using direct tab stream (no mic mixing needed)')
    return tabStream
  }

  // If tab has no audio but mic is available, mix mic with video
  if (tabAudioTracks.length === 0 && micAudioTracks.length > 0 && micStream) {
    log('Using mic stream directly with tab video')
    return new MediaStream([
      ...tabStream.getVideoTracks(),
      ...micStream.getAudioTracks()
    ])
  }

  // Both tab audio and mic audio exist -> Mix them
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext
    const ctx = new AC()
    activeAudioCtx = ctx

    // Force resume
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {})
    }

    const destination = ctx.createMediaStreamDestination()

    // Keep-alive oscillator (gain 0.0) ensures Web Audio clock never sleeps
    const dummyOsc = ctx.createOscillator()
    const dummyGain = ctx.createGain()
    dummyGain.gain.setValueAtTime(0.0001, ctx.currentTime)
    dummyOsc.connect(dummyGain)
    dummyGain.connect(destination)
    dummyOsc.start()

    // Compressor on master bus to balance meeting voices & mic
    const compressor = ctx.createDynamicsCompressor()
    compressor.threshold.setValueAtTime(-24, ctx.currentTime)
    compressor.knee.setValueAtTime(30, ctx.currentTime)
    compressor.ratio.setValueAtTime(12, ctx.currentTime)
    compressor.attack.setValueAtTime(0.003, ctx.currentTime)
    compressor.release.setValueAtTime(0.25, ctx.currentTime)
    compressor.connect(destination)

    // Route tab audio (meeting sound - NEVER MUTED)
    if (tabAudioTracks.length > 0) {
      const tabSource = ctx.createMediaStreamSource(new MediaStream([tabAudioTracks[0]]))
      const tabGain = ctx.createGain()
      tabGain.gain.setValueAtTime(1.0, ctx.currentTime)
      tabSource.connect(tabGain)
      tabGain.connect(compressor)
      log('Tab audio connected to mixer (Meeting sound is continuous)')
    }

    // Route mic audio (controlled dynamically by Google Meet mute state)
    if (micAudioTracks.length > 0) {
      const micSource = ctx.createMediaStreamSource(new MediaStream([micAudioTracks[0]]))
      const micGain = ctx.createGain()
      const initialGain = isMicMutedInMeet ? 0.0 : 1.35
      micGain.gain.setValueAtTime(initialGain, ctx.currentTime)
      activeMicGainNode = micGain
      micSource.connect(micGain)
      micGain.connect(compressor)
      log('Mic audio connected to mixer with dynamic mute controller. Initial gain:', initialGain)
    }

    const mixedAudioTracks = destination.stream.getAudioTracks()
    log('Web Audio pipeline established. Tracks:', mixedAudioTracks.length)

    return new MediaStream([
      ...tabStream.getVideoTracks(),
      ...mixedAudioTracks
    ])
  } catch (err) {
    log('Audio mixing fallback to raw tab stream:', err)
    return tabStream
  }
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
  
  // Pick reliable WebM mime type
  let mime = 'video/webm;codecs=vp8,opus'
  if (!MediaRecorder.isTypeSupported(mime)) {
    mime = MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : ''
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
      const blobType = mime || 'video/webm'
      const blob = new Blob(chunks, { type: blobType })
      log('Recording finished. Chunks:', chunks.length, 'Size:', blob.size)

      let suffix = 'google-meet'
      try {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
        suffix = inferSuffixFromActiveTabUrl(tabs[0]?.url || null)
      } catch {}

      const filename = `google-meet-recording-${suffix}-${Date.now()}.webm`
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


