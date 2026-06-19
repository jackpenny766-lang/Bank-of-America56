import { createDecartClient, models } from '@decartai/sdk';

const apiKeyInput = document.getElementById('apiKey');
const modelSelect = document.getElementById('modelSelect');
const promptInput = document.getElementById('promptInput');
const mirrorToggle = document.getElementById('mirrorToggle');
const connectButton = document.getElementById('connectButton');
const disconnectButton = document.getElementById('disconnectButton');
const sessionDurationInput = document.getElementById('sessionDurationInput');
const statusText = document.getElementById('statusText');
const qualityText = document.getElementById('qualityText');
const factorText = document.getElementById('factorText');
const logOutput = document.getElementById('logOutput');
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const sessionTimeSpan = document.getElementById('sessionTime');

let localStream = null;
let realtimeClient = null;
let decartClient = null;
let sessionTimer = null;
let sessionInterval = null;
let sessionEndTime = null;
const DEFAULT_SESSION_MINUTES = 60;

function getSessionDurationMs() {
  const val = Number(sessionDurationInput?.value ?? DEFAULT_SESSION_MINUTES);
  if (!Number.isFinite(val) || val <= 0) return DEFAULT_SESSION_MINUTES * 60 * 1000;
  // cap to 4 hours
  const minutes = Math.min(Math.max(Math.floor(val), 1), 240);
  return minutes * 60 * 1000;
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  logOutput.textContent += `[${timestamp}] ${message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function updateStatus(status) {
  statusText.textContent = status;
}

function updateQuality(report) {
  qualityText.textContent = report?.quality ?? 'n/a';
  factorText.textContent = report?.limitingFactor ?? 'n/a';
}

async function startLocalCamera(model) {
  if (localStream) {
    return localStream;
  }

  const constraints = {
    audio: true,
    video: {
      width: model?.width ?? 640,
      height: model?.height ?? 480,
      frameRate: model?.fps ?? { ideal: 24 }
    }
  };

  appendLog('Requesting camera and microphone permissions...');
  localStream = await navigator.mediaDevices.getUserMedia(constraints);
  localVideo.srcObject = localStream;
  return localStream;
}

async function stopLocalCamera() {
  if (!localStream) return;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  localVideo.srcObject = null;
}

async function connectRealtime() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    appendLog('Please enter your Decart API key.');
    return;
  }

  const chosenModel = modelSelect.value;
  const prompt = promptInput.value.trim() || 'Anime';
  const mirror = mirrorToggle.checked ? true : false;

  decartClient = createDecartClient({ apiKey });
  const model = models.realtime(chosenModel);

  try {
    connectButton.disabled = true;
    appendLog(`Preparing local camera for model ${chosenModel}...`);
    const stream = await startLocalCamera(model);

    appendLog('Checking connectivity...');
    const connectivity = await decartClient.realtime.checkConnectivity();
    appendLog(`Connectivity: ${connectivity.quality} (${connectivity.metrics.transport})`);

    appendLog('Connecting to Decart realtime session...');
    realtimeClient = await decartClient.realtime.connect(stream, {
      model,
      mirror,
      initialState: {
        prompt: {
          text: prompt,
          enhance: true
        }
      },
      onRemoteStream: (remoteStream) => {
        appendLog('Received transformed remote stream.');
        remoteVideo.srcObject = remoteStream;
      },
      onConnectionQuality: (report) => {
        updateQuality(report);
        appendLog(`Connection quality: ${report.quality} (${report.limitingFactor})`);
      }
    });

    realtimeClient.on('connectionChange', (state) => {
      appendLog(`Realtime connection state: ${state}`);
      updateStatus(state);
    });

    // Start session timer (configurable duration)
    try {
      const durationMs = getSessionDurationMs();
      sessionEndTime = Date.now() + durationMs;
      // update immediately and then every second
      updateSessionTime();
      sessionInterval = setInterval(updateSessionTime, 1000);
      sessionTimer = setTimeout(async () => {
        appendLog('Session reached configured duration; disconnecting automatically.');
        await disconnectRealtime();
      }, durationMs);
    } catch (e) {
      appendLog(`Failed to start session timer: ${e?.message ?? e}`);
    }

    connectButton.disabled = true;
    disconnectButton.disabled = false;
    appendLog('Realtime session is ready.');
  } catch (error) {
    appendLog(`Connection failed: ${error.message ?? error}`);
    await stopLocalCamera();
    connectButton.disabled = false;
    disconnectButton.disabled = true;
    updateStatus('error');
  }
}

async function disconnectRealtime() {
  if (realtimeClient) {
    appendLog('Disconnecting realtime session...');
    try {
      await realtimeClient.disconnect();
    } catch (error) {
      appendLog(`Error during disconnect: ${error.message ?? error}`);
    }
    realtimeClient = null;
  }
  if (remoteVideo.srcObject) {
    remoteVideo.srcObject = null;
  }
  // clear session timers
  if (sessionTimer) {
    clearTimeout(sessionTimer);
    sessionTimer = null;
  }
  if (sessionInterval) {
    clearInterval(sessionInterval);
    sessionInterval = null;
  }
  sessionEndTime = null;
  if (sessionTimeSpan) sessionTimeSpan.textContent = '00:00:00';
  await stopLocalCamera();
  connectButton.disabled = false;
  disconnectButton.disabled = true;
  updateStatus('idle');
  updateQuality(null);
  appendLog('Disconnected.');
}

connectButton.addEventListener('click', () => connectRealtime());
disconnectButton.addEventListener('click', () => disconnectRealtime());

window.addEventListener('beforeunload', async () => {
  await disconnectRealtime();
});

appendLog('Page loaded. Enter your API key and connect.');

function updateSessionTime() {
  if (!sessionEndTime) {
    if (sessionTimeSpan) sessionTimeSpan.textContent = '00:00:00';
    return;
  }
  const remaining = sessionEndTime - Date.now();
  if (remaining <= 0) {
    if (sessionTimeSpan) sessionTimeSpan.textContent = '00:00:00';
    return;
  }
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  if (sessionTimeSpan) sessionTimeSpan.textContent = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}
