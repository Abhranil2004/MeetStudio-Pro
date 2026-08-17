// src/micsetup.ts
export {}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('enable') as HTMLButtonElement | null;
  const statusEl = document.getElementById('status') as HTMLDivElement | null;
  const meterBox = document.getElementById('meter-box') as HTMLDivElement | null;
  const micFill = document.getElementById('mic-fill') as HTMLDivElement | null;

  if (!btn || !statusEl) return;

  btn.addEventListener('click', async () => {
    statusEl.textContent = 'Requesting microphone permission…';
    statusEl.className = 'status-msg';

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      statusEl.textContent = '✓ Microphone enabled successfully! You can close this tab and start recording.';
      statusEl.className = 'status-msg success';
      btn.style.display = 'none';

      if (meterBox && micFill) {
        meterBox.classList.add('active');

        const AC = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
        const ctx = new AC();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const tick = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          const pct = Math.min(100, Math.round((avg / 128) * 100));
          micFill.style.width = `${Math.max(4, pct)}%`;
          requestAnimationFrame(tick);
        };
        tick();
      }
    } catch (e: any) {
      statusEl.textContent = `Microphone blocked: ${e?.name || e}. Please check browser permissions in the URL bar.`;
      statusEl.className = 'status-msg';
      console.error('[micsetup] getUserMedia error:', e);
    }
  });
});