# 🎥 MeetStudio Pro — Executive Google Meet Recorder & Transcriber

[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Chrome Extension](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-success?logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/mv3/)
[![Web Audio API](https://img.shields.io/badge/Web_Audio-Studio_Mixer-indigo)](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
[![Vercel Deployment](https://img.shields.io/badge/Vercel-Ready_for_Deploy-black?logo=vercel&logoColor=white)](https://vercel.com)
[![Privacy](https://img.shields.io/badge/Privacy-100%25_Local_&_Private-emerald)](https://github.com)
[![License](https://img.shields.io/badge/License-MIT-purple)](LICENSE)

> **MeetStudio Pro** is a high-performance Google Chrome extension and client-side web application engineered specifically for **Google Meet**. It captures pristine high-definition video, mixes isolated meeting audio with enhanced microphone speech, synchronizes with Google Meet's mute state in real-time, and extracts live closed-caption transcripts with zero cloud dependencies.

---

## ✨ Key Features

### 🎙️ 1. Native In-Meeting Recording Experience
* **Floating In-Call HUD Controller**: A frosted-glass capsule pill is injected directly into the top-left corner of the Google Meet call screen.
* **Real-time REC Status**: Shows an active pulsing red badge (`● REC | 00:14:22`) with live duration and microphone status (`• 🔇 Mic Muted` / `• 🎙️ Mic Live`).
* **Leave Call Auto-Finalize**: Automatically stops recording and downloads your video and transcript when you click the red "Leave call" button or navigate away.

### 🔇 2. Dynamic Microphone Mute Synchronization
* **Automatic Hardware Cut-Off**: When you mute yourself in Google Meet (via on-screen button, `Ctrl+D` / `Cmd+D`, or the extension popup), the microphone track is instantly disabled (`enabled = false`) and software gain is zeroed (`0.0x`).
* **Continuous Meeting Sound**: All other participants and meeting tab audio continue recording without any interruption.
* **Instant Unmute Boost**: Unmuting instantly restores your voice with hardware noise filtering and a 1.35x speech enhancement curve.

### 🛡️ 3. Isolated Tab Audio (Zero Background App Sound)
* **Tab Capture Engine**: Built using `chromeMediaSource: 'tab'`, strictly capturing the audio output of the Google Meet tab.
* **No Sound Leaks**: Audio from Spotify, Discord, YouTube in background tabs, system notification dings, or computer games will **never** be recorded into your meeting archive.

### 📝 4. Real-Time Closed Caption (CC) Transcription
* **Intelligent DOM Mutation Observer**: Automatically tracks speaker changes (`.NWpY1d`) and spoken words (`.ygicle`).
* **Formatted Timestamps**: Transcripts are buffered with ISO start/end timestamps and formatted for instant one-click `.txt` download.

### 🎨 5. Executive Dark Glassmorphic UI
* Designed with modern aesthetics: deep obsidian base (`#090d16`), multi-layer glass cards (`backdrop-filter: blur(20px)`), neon indigo & crimson indicators, and high-precision tabular stopwatch timers.

### 🌐 6. Vercel Web Deployment & 1-Click Distribution
* Comes with a production-ready landing page, interactive 3-step setup guide for users, a ready-to-download `.zip` archive, and a fallback **Zero-Install In-Browser Web Recorder**.

---

## 🏗️ Architecture & Technology Stack

```
                               ┌────────────────────────────────────────┐
                               │       GOOGLE MEET CALL TAB             │
                               │  - Captures Subtitles/Transcripts      │
                               │  - Detects Mic Mute/Unmute State       │
                               │  - Shows Floating [ ● REC ] HUD Pill   │
                               └──────────────────┬─────────────────────┘
                                                  │ (chrome.runtime.sendMessage)
                                                  ▼
┌────────────────────────┐             ┌──────────────────────┐             ┌─────────────────────────┐
│       POPUP UI         │◄───────────►│  BACKGROUND WORKER   │◄───────────►│    OFFSCREEN DOCUMENT   │
│ - Stopwatch Timer      │  Messages   │   (background.ts)    │  Port RPC   │     (offscreen.ts)      │
│ - Audio Activity Meter │             │ - Manages Lifecycle  │             │ - Web Audio Studio Mixer│
│ - Manual Mute Toggle   │             │ - Acquires Stream IDs│             │ - Dynamic Compressor    │
│ - 1-Click Record CTA   │             │ - Triggers Downloads │             │ - MediaRecorder (WebM)  │
└────────────────────────┘             └──────────────────────┘             └─────────────────────────┘
```

### Studio Audio Graph Pipeline

```
[ Google Meet Tab Stream ]  ──> [ Tab Gain: 1.0x ]  ──────────┐
                                                              │
                                                              ▼
                                                   [ Dynamics Compressor ] ──> [ MediaStream Destination ] ──> [ MediaRecorder ]
                                                              ▲
                                                              │
[ Microphone Audio Stream ] ──> [ Dynamic Mic Gain ] ─────────┘
                                • Unmuted: 1.35x (Voice Boost)
                                • Muted:   0.00x (Total Silence)

[ Inaudible 0.0001Hz Osc ]  ─────────────────────────────────────────────> [ MediaStream Destination ]
(Prevents Chrome MV3 Web Audio clock from sleeping during conversational pauses)
```

---

## 📂 Project Structure

```
├── dist/                     # Compiled extension assets for Chrome
├── src/
│   ├── background.ts         # Service worker coordinator & stream manager
│   ├── offscreen.ts          # Web Audio mixing graph & MediaRecorder engine
│   ├── popup.ts              # Executive popup UI controller
│   ├── scrapingScript.ts     # In-meeting HUD, caption scraper & mute monitor
│   └── micsetup.ts           # One-time microphone onboarding helper
├── index.html                # Vercel landing page, download hub & web recorder
├── manifest.json             # Chrome Manifest V3 configuration
├── micsetup.html             # Microphone permissions setup page
├── offscreen.html            # Headless offscreen document
├── popup.html                # Dark glassmorphic popup interface
├── package.json              # Dependencies and build scripts
├── tsconfig.json             # TypeScript compiler settings
├── vercel.json               # Vercel deployment and download routing
└── webpack.config.js         # Webpack 5 production bundler
```

---

## 🚀 Quick Start for Developers

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher
* **Google Chrome**: Latest version

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/your-username/meetstudio-pro.git
cd meetstudio-pro
npm install
```

### 2. Build the Extension
```bash
# Build production bundle to /dist
npm run build

# Or build + package into meetstudio-extension.zip
npm run package

# Or run in development watch mode
npm run dev
```

### 3. Load into Google Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle **Developer mode** in the top right corner.
3. Click **"Load unpacked"** in the top left corner.
4. Select the **`dist`** folder inside this repository.
5. Open [meet.google.com](https://meet.google.com) and start recording!

---

## 🌐 Deploying to Vercel (1-Click)

This project includes a landing page and distribution hub ready for Vercel deployment:

### Option A: Via Vercel CLI
```bash
npx vercel
```

### Option B: Via GitHub Integration
1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "MeetStudio Pro v2.0.0"
   git branch -M main
   git remote add origin https://github.com/your-username/meetstudio-pro.git
   git push -u origin main
   ```
2. Go to [vercel.com/new](https://vercel.com/new) and import your repository.
3. Click **Deploy**. Vercel will host your landing page, interactive setup guide, zero-install web recorder, and `meetstudio-extension.zip` download package.

---

## 🔒 Privacy & Security

* **100% Client-Side**: No audio, video, transcripts, or personal data are ever transmitted to any external server or cloud service.
* **On-Device Encoding**: Video frames and audio streams are mixed, compressed, and encoded directly inside the user's browser.
* **Local File Storage**: Output `.webm` recordings and `.txt` transcripts are saved exclusively to the user's local Downloads folder.

---

## 📄 License

Distributed under the **MIT License**. See `LICENSE` for more information.
