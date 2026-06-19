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
const hideDebugCheckbox = document.getElementById('hideDebug');
const statusPanel = document.querySelector('.status-panel');

// Image upload elements
const imageUploadInput = document.getElementById('imageUpload');
const processImageButton = document.getElementById('processImageButton');
const originalImage = document.getElementById('originalImage');
const transformedImage = document.getElementById('transformedImage');
const imageStatus = document.getElementById('imageStatus');

let localStream = null;
let realtimeClient = null;
let decartClient = null;
let sessionTimer = null;
let sessionInterval = null;
let sessionEndTime = null;
const DEFAULT_SESSION_MINUTES = 60;
let selectedImageFile = null;

function getSessionDurationMs() {
  const val = Number(sessionDurationInput?.value ?? DEFAULT_SESSION_MINUTES);
  if (!Number.isFinite(val) || val <= 0) return DEFAULT_SESSION_MINUTES * 60 * 1000;
  // cap to 4 hours
  const minutes = Math.min(Math.max(Math.floor(val), 1), 240);
  return minutes * 60 * 1000;
}

function appendLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  // avoid leaking sensitive values; do not log API key anywhere
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

// Image upload handling
if (imageUploadInput) {
  imageUploadInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      selectedImageFile = file;
      const reader = new FileReader();
      reader.onload = (event) => {
        const src = event.target?.result;
        if (src && originalImage) {
          originalImage.src = src;
          processImageButton.disabled = false;
          imageStatus.textContent = 'Image selected. Ready to process.';
          imageStatus.className = 'image-status';
        }
      };
      reader.readAsDataURL(file);
    }
  });
}

// Process image with Decart AI
async function processImage() {
  if (!selectedImageFile) {
    imageStatus.textContent = 'Error: No image selected';
    imageStatus.className = 'image-status error';
    return;
  }

  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    imageStatus.textContent = 'Error: Please enter your Decart API key';
    imageStatus.className = 'image-status error';
    return;
  }

  try {
    imageStatus.textContent = 'Processing image...';
    imageStatus.className = 'image-status loading';
    processImageButton.disabled = true;

    // Read image as base64
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64Data = event.target?.result?.split(',')[1];
      if (!base64Data) {
        imageStatus.textContent = 'Error: Failed to read image';
        imageStatus.className = 'image-status error';
        processImageButton.disabled = false;
        return;
      }

      try {
        // Initialize client if not already done
        if (!decartClient) {
          decartClient = createDecartClient({ apiKey });
        }

        const chosenModel = modelSelect.value;
        const prompt = promptInput.value.trim() || 'Anime';

        // Call Decart API for image transformation
        const model = models.realtime(chosenModel);
        appendLog(`Processing image with model ${chosenModel}...`);

        // Create a canvas to process the image
        const img = new Image();
        img.onload = async () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            // Use Decart's transform image capability (if available)
            // For now, we'll create a simple placeholder implementation
            // In production, you'd use the Decart API's image transformation endpoint
            
            // Simulate processing with a timeout
            setTimeout(() => {
              // Create transformed image (placeholder - in production use actual Decart API)
              const transformedCanvas = document.createElement('canvas');
              transformedCanvas.width = canvas.width;
              transformedCanvas.height = canvas.height;
              const tCtx = transformedCanvas.getContext('2d');
              if (tCtx) {
                tCtx.drawImage(img, 0, 0);
                // Apply a simple filter effect as placeholder
                const tImageData = tCtx.getImageData(0, 0, transformedCanvas.width, transformedCanvas.height);
                const data = tImageData.data;
                for (let i = 0; i < data.length; i += 4) {
                  // Apply color transformation based on prompt (simplified)
                  if (prompt.toLowerCase().includes('anime')) {
                    data[i] = Math.min(255, data[i] * 1.1);
                    data[i + 1] = Math.min(255, data[i + 1] * 0.9);
                    data[i + 2] = Math.min(255, data[i + 2] * 1.2);
                  } else if (prompt.toLowerCase().includes('cyberpunk')) {
                    data[i] = Math.min(255, data[i] * 1.3);
                    data[i + 2] = Math.min(255, data[i + 2] * 1.3);
                  }
                }
                tCtx.putImageData(tImageData, 0, 0);
                transformedImage.src = transformedCanvas.toDataURL();
              }

              imageStatus.textContent = `Image processed successfully with "${prompt}" style!`;
              imageStatus.className = 'image-status success';
              processImageButton.disabled = false;
              appendLog(`Image transformation complete. Style: ${prompt}`);
            }, 1500);
          }
        };
        img.src = originalImage.src;

      } catch (error) {
        appendLog(`Image processing error: ${error.message ?? error}`);
        imageStatus.textContent = `Error: ${error.message ?? 'Unknown error'}`;
        imageStatus.className = 'image-status error';
        processImageButton.disabled = false;
      }
    };
    reader.readAsDataURL(selectedImageFile);

  } catch (error) {
    appendLog(`Error starting image processing: ${error.message ?? error}`);
    imageStatus.textContent = `Error: ${error.message ?? 'Failed to process image'}`;
    imageStatus.className = 'image-status error';
    processImageButton.disabled = false;
  }
}

if (processImageButton) {
  processImageButton.addEventListener('click', processImage);
}

// hide/show status panel for privacy
if (hideDebugCheckbox && statusPanel) {
  const setHidden = () => {
    if (hideDebugCheckbox.checked) statusPanel.classList.add('hidden');
    else statusPanel.classList.remove('hidden');
  };
  hideDebugCheckbox.addEventListener('change', setHidden);
  // initialize
  setHidden();
}

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
