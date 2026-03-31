// AI Co-Founder Voice UI — Real-time Audio Pipeline
(function () {
  "use strict";

  const API_URL = window.location.origin;

  // ── DOM Elements ──
  const ring = document.getElementById("ring");
  const statusText = document.getElementById("status-text");
  const conversation = document.getElementById("conversation");
  const micBtn = document.getElementById("mic-btn");
  const micIcon = document.getElementById("mic-icon");
  const stopIcon = document.getElementById("stop-icon");
  const textInput = document.getElementById("text-input");
  const sendBtn = document.getElementById("send-btn");
  const providerInfo = document.getElementById("provider-info");
  const waveformCanvas = document.getElementById("waveform");
  const userTranscript = document.getElementById("user-transcript");
  const agentTranscript = document.getElementById("agent-transcript");
  const canvasCtx = waveformCanvas.getContext("2d");

  // ── Persistent User ID ──
  function getUserId() {
    var id = localStorage.getItem("voice-ui-user-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("voice-ui-user-id", id);
    }
    return id;
  }
  var userId = getUserId();

  // ── State Machine ──
  // States: idle | listening | processing | speaking
  var currentState = "idle";
  var conversationId = localStorage.getItem("voice-ui-conversation-id");

  // Audio pipeline state
  var audioContext = null;
  var mediaStream = null;
  var mediaRecorder = null;
  var recordedChunks = [];
  var analyserNode = null;
  var animationFrameId = null;
  var currentAudio = null;
  var playbackSource = null;
  var playbackAnalyser = null;

  // Capability detection
  var ttsAvailable = false;
  var transcribeAvailable = false;
  var browserSpeechSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  // VAD parameters
  var VAD_THRESHOLD = 0.015;
  var VAD_SILENCE_TIMEOUT = 1500; // ms of silence before auto-stop
  var vadSilenceTimer = null;
  var vadHasSpoken = false;

  // ── Capability Checks ──
  async function checkCapabilities() {
    // Check TTS
    try {
      var res = await fetch(API_URL + "/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "." }),
      });
      ttsAvailable = res.ok;
    } catch (e) {
      ttsAvailable = false;
    }

    // Check transcription
    try {
      var res2 = await fetch(API_URL + "/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": "audio/webm" },
        body: new Uint8Array(10),
      });
      // 501 means not configured, 400 means configured but bad input (expected)
      transcribeAvailable = res2.status !== 501;
    } catch (e) {
      transcribeAvailable = false;
    }
  }
  checkCapabilities();

  // ── Audio Context Initialization ──
  function ensureAudioContext() {
    if (!audioContext || audioContext.state === "closed") {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === "suspended") {
      audioContext.resume();
    }
    return audioContext;
  }

  // ── State Management ──
  function setState(newState) {
    var prevState = currentState;
    currentState = newState;

    // Update ring
    ring.className = newState === "processing" ? "thinking" : newState;

    // Update status text
    statusText.className = newState;
    switch (newState) {
      case "idle":
        statusText.textContent = "Ready";
        break;
      case "listening":
        statusText.textContent = "Listening...";
        break;
      case "processing":
        statusText.textContent = "Processing...";
        break;
      case "speaking":
        statusText.textContent = "Speaking...";
        break;
    }

    // Update mic button
    micBtn.setAttribute("data-state", newState);
    if (newState === "listening") {
      micIcon.classList.add("hidden");
      stopIcon.classList.remove("hidden");
    } else {
      micIcon.classList.remove("hidden");
      stopIcon.classList.add("hidden");
    }

    // Disable send button during processing/speaking
    sendBtn.disabled = newState === "processing" || newState === "speaking";
    textInput.disabled = newState === "processing" || newState === "speaking";

    // Waveform visibility
    if (newState === "listening" || newState === "speaking") {
      waveformCanvas.classList.add("active");
    } else {
      waveformCanvas.classList.remove("active");
      clearWaveform();
    }
  }

  // ── Waveform Visualization ──
  function clearWaveform() {
    if (animationFrameId) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
    canvasCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
  }

  function drawWaveform(analyser, color) {
    if (!analyser) return;

    var bufferLength = analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);

    function draw() {
      if (currentState !== "listening" && currentState !== "speaking") {
        clearWaveform();
        return;
      }

      animationFrameId = requestAnimationFrame(draw);
      analyser.getByteTimeDomainData(dataArray);

      var width = waveformCanvas.width;
      var height = waveformCanvas.height;
      var centerX = width / 2;
      var centerY = height / 2;
      var radius = 70; // Slightly larger than ring

      canvasCtx.clearRect(0, 0, width, height);

      // Draw circular waveform around the ring
      var sliceAngle = (2 * Math.PI) / bufferLength;

      canvasCtx.beginPath();
      canvasCtx.strokeStyle = color;
      canvasCtx.lineWidth = 2;

      for (var i = 0; i < bufferLength; i++) {
        var v = dataArray[i] / 128.0;
        var amplitude = (v - 1.0) * 30;
        var r = radius + amplitude;
        var angle = i * sliceAngle - Math.PI / 2;
        var x = centerX + r * Math.cos(angle);
        var y = centerY + r * Math.sin(angle);

        if (i === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
      }

      canvasCtx.closePath();
      canvasCtx.stroke();

      // Draw a subtle glow version
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = color.replace("1)", "0.2)");
      canvasCtx.lineWidth = 6;

      for (var j = 0; j < bufferLength; j++) {
        var v2 = dataArray[j] / 128.0;
        var amp2 = (v2 - 1.0) * 30;
        var r2 = radius + amp2;
        var angle2 = j * sliceAngle - Math.PI / 2;
        var x2 = centerX + r2 * Math.cos(angle2);
        var y2 = centerY + r2 * Math.sin(angle2);

        if (j === 0) {
          canvasCtx.moveTo(x2, y2);
        } else {
          canvasCtx.lineTo(x2, y2);
        }
      }

      canvasCtx.closePath();
      canvasCtx.stroke();
    }

    draw();
  }

  // ── Voice Activity Detection ──
  function computeEnergy(analyser) {
    var dataArray = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(dataArray);
    var sum = 0;
    for (var i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    return Math.sqrt(sum / dataArray.length);
  }

  function startVADMonitor() {
    vadHasSpoken = false;
    vadSilenceTimer = null;

    function monitor() {
      if (currentState !== "listening" || !analyserNode) return;

      var energy = computeEnergy(analyserNode);

      if (energy > VAD_THRESHOLD) {
        vadHasSpoken = true;
        if (vadSilenceTimer) {
          clearTimeout(vadSilenceTimer);
          vadSilenceTimer = null;
        }
      } else if (vadHasSpoken && !vadSilenceTimer) {
        // User stopped speaking, start silence timer
        vadSilenceTimer = setTimeout(function () {
          if (currentState === "listening") {
            stopListening();
          }
        }, VAD_SILENCE_TIMEOUT);
      }

      requestAnimationFrame(monitor);
    }

    monitor();
  }

  // ── Recording (MediaRecorder + Web Audio API) ──
  async function startListening() {
    if (currentState !== "idle") return;

    // Stop any current playback
    stopSpeaking();

    // Clear transcripts
    hideTranscript(userTranscript);
    hideTranscript(agentTranscript);

    try {
      ensureAudioContext();

      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 16000,
        },
      });

      // Set up analyser for visualization + VAD
      var source = audioContext.createMediaStreamSource(mediaStream);
      analyserNode = audioContext.createAnalyser();
      analyserNode.fftSize = 2048;
      analyserNode.smoothingTimeConstant = 0.8;
      source.connect(analyserNode);

      // Set up MediaRecorder
      var mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm")
          ? "audio/webm"
          : "audio/ogg";

      recordedChunks = [];
      mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mimeType });

      mediaRecorder.ondataavailable = function (e) {
        if (e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      mediaRecorder.onstop = function () {
        handleRecordingComplete();
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setState("listening");

      // Start waveform visualization
      drawWaveform(analyserNode, "rgba(124, 58, 237, 1)");

      // Start VAD monitoring
      startVADMonitor();
    } catch (err) {
      console.error("Microphone access error:", err);
      showError("Microphone access denied");
    }
  }

  function stopListening() {
    if (currentState !== "listening") return;

    if (vadSilenceTimer) {
      clearTimeout(vadSilenceTimer);
      vadSilenceTimer = null;
    }

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }

    // Stop mic stream
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); });
      mediaStream = null;
    }

    analyserNode = null;
    clearWaveform();
    setState("processing");
  }

  async function handleRecordingComplete() {
    if (recordedChunks.length === 0) {
      setState("idle");
      return;
    }

    var audioBlob = new Blob(recordedChunks, {
      type: mediaRecorder ? mediaRecorder.mimeType : "audio/webm",
    });
    recordedChunks = [];

    // Skip very short recordings (likely accidental taps)
    if (audioBlob.size < 1000) {
      setState("idle");
      return;
    }

    // Try server-side transcription first, fall back to browser speech recognition
    if (transcribeAvailable) {
      await transcribeAndSend(audioBlob);
    } else if (browserSpeechSupported) {
      // Fall back: use browser speech recognition on next tap
      // For now, show a hint
      showError("Transcription unavailable. Use text input.");
      setState("idle");
    } else {
      showError("No transcription available. Use text input.");
      setState("idle");
    }
  }

  async function transcribeAndSend(audioBlob) {
    setState("processing");
    showTranscript(userTranscript, "Transcribing...");

    try {
      var res = await fetch(API_URL + "/voice/transcribe", {
        method: "POST",
        headers: { "Content-Type": audioBlob.type || "audio/webm" },
        body: audioBlob,
      });

      if (!res.ok) {
        var err = await res.json().catch(function () { return {}; });
        throw new Error(err.message || "Transcription failed");
      }

      var result = await res.json();
      var text = (result.text || "").trim();

      if (!text) {
        showTranscript(userTranscript, "(no speech detected)");
        setTimeout(function () {
          hideTranscript(userTranscript);
          setState("idle");
        }, 1500);
        return;
      }

      showTranscript(userTranscript, text);
      await sendMessage(text);
    } catch (err) {
      console.error("Transcription error:", err);
      showError(err.message || "Transcription failed");
      setState("idle");
    }
  }

  // ── Text Sending (Streaming SSE) ──
  async function sendMessage(text) {
    if (!text.trim()) return;

    addMessage("user", text);
    setState("processing");

    try {
      var payload = {
        message: text,
        userId: userId,
      };
      if (conversationId) {
        payload.conversationId = conversationId;
      }

      var res = await fetch(API_URL + "/voice/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Server returned " + res.status);
      }

      // Parse SSE stream
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = "";
      var fullResponse = "";
      var messageDiv = null;
      var model = "";
      var provider = "";

      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;

        buffer += decoder.decode(chunk.value, { stream: true });
        var lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i];
          if (!line.startsWith("data: ")) continue;

          try {
            var event = JSON.parse(line.slice(6));

            switch (event.type) {
              case "thinking":
                statusText.textContent = "Thinking...";
                break;

              case "text_delta":
                if (!messageDiv) {
                  messageDiv = addMessage("agent", "");
                  ring.className = "streaming";
                  statusText.textContent = "Responding...";
                }
                fullResponse += event.data.delta || "";
                messageDiv.firstChild.textContent = fullResponse;
                showTranscript(agentTranscript, fullResponse.slice(-200));
                conversation.scrollTop = conversation.scrollHeight;
                break;

              case "tool_call":
                if (!messageDiv) {
                  messageDiv = addMessage("agent", "");
                }
                statusText.textContent = "Using " + (event.data.name || "tool") + "...";
                break;

              case "done":
                if (event.data) {
                  conversationId = event.data.conversationId || conversationId;
                  model = event.data.model || "";
                  provider = event.data.provider || "";

                  if (conversationId) {
                    localStorage.setItem("voice-ui-conversation-id", conversationId);
                  }

                  var parts = [];
                  if (provider) parts.push(provider);
                  if (model) parts.push(model);
                  if (event.data.usage) {
                    parts.push(
                      event.data.usage.inputTokens + " > " + event.data.usage.outputTokens + " tok"
                    );
                  }
                  providerInfo.textContent = parts.join(" · ");
                }
                break;

              case "error":
                console.error("Stream error:", event.data);
                break;
            }
          } catch (e) {
            // Ignore malformed JSON
          }
        }
      }

      // Speak the response
      if (fullResponse) {
        await speak(fullResponse);
      } else {
        setState("idle");
      }
    } catch (err) {
      console.error("API error:", err);
      showError("Connection failed");
      addMessage("agent", "Something went wrong. Is the server running?");
      setTimeout(function () { setState("idle"); }, 3000);
    }
  }

  // ── TTS Playback ──
  async function speak(text) {
    if (ttsAvailable) {
      await speakElevenLabs(text);
    } else {
      speakBrowser(text);
    }
  }

  async function speakElevenLabs(text) {
    setState("speaking");

    try {
      var res = await fetch(API_URL + "/voice/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      });

      if (!res.ok) {
        speakBrowser(text);
        return;
      }

      var arrayBuffer = await res.arrayBuffer();
      ensureAudioContext();

      // Decode and play with Web Audio API for visualization
      var audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

      playbackSource = audioContext.createBufferSource();
      playbackSource.buffer = audioBuffer;

      playbackAnalyser = audioContext.createAnalyser();
      playbackAnalyser.fftSize = 2048;
      playbackAnalyser.smoothingTimeConstant = 0.85;

      playbackSource.connect(playbackAnalyser);
      playbackAnalyser.connect(audioContext.destination);

      playbackSource.onended = function () {
        playbackSource = null;
        playbackAnalyser = null;
        clearWaveform();
        hideTranscript(agentTranscript);
        setState("idle");
      };

      playbackSource.start(0);

      // Visualize playback
      drawWaveform(playbackAnalyser, "rgba(34, 197, 94, 1)");
    } catch (err) {
      console.error("ElevenLabs playback error:", err);
      speakBrowser(text);
    }
  }

  function speakBrowser(text) {
    var synthesis = window.speechSynthesis;
    if (!synthesis) {
      setState("idle");
      return;
    }

    synthesis.cancel();

    var cleanText = text
      .replace(/```[\s\S]*?```/g, " (code block) ")
      .replace(/[*_#`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();

    if (!cleanText) {
      setState("idle");
      return;
    }

    var utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

    var voices = synthesis.getVoices();
    var preferred = voices.find(function (v) {
      return (
        v.name.includes("Samantha") ||
        v.name.includes("Daniel") ||
        v.name.includes("Google UK English Male")
      );
    });
    if (preferred) utterance.voice = preferred;

    utterance.onstart = function () {
      setState("speaking");
    };

    utterance.onend = function () {
      hideTranscript(agentTranscript);
      setState("idle");
    };

    utterance.onerror = function () {
      setState("idle");
    };

    synthesis.speak(utterance);
  }

  function stopSpeaking() {
    if (playbackSource) {
      try { playbackSource.stop(); } catch (e) { /* already stopped */ }
      playbackSource = null;
      playbackAnalyser = null;
    }

    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    clearWaveform();
  }

  // ── UI Helpers ──
  function showTranscript(el, text) {
    el.textContent = text;
    el.classList.remove("hidden");
  }

  function hideTranscript(el) {
    el.classList.add("hidden");
  }

  function showError(msg) {
    ring.className = "error";
    statusText.textContent = msg;
    statusText.className = "error";
    setTimeout(function () {
      if (currentState !== "listening" && currentState !== "processing" && currentState !== "speaking") {
        setState("idle");
      }
    }, 3000);
  }

  function addMessage(role, text) {
    var div = document.createElement("div");
    div.className = "message " + role;

    var content = document.createElement("span");
    content.textContent = text;
    div.appendChild(content);

    conversation.appendChild(div);
    conversation.scrollTop = conversation.scrollHeight;
    return div;
  }

  // ── Event Listeners ──

  // Mic button: tap to start, tap again to stop
  micBtn.addEventListener("click", function (e) {
    e.preventDefault();
    if (currentState === "idle") {
      startListening();
    } else if (currentState === "listening") {
      stopListening();
    } else if (currentState === "speaking") {
      stopSpeaking();
      setState("idle");
    }
  });

  // Prevent context menu on long press (mobile)
  micBtn.addEventListener("contextmenu", function (e) {
    e.preventDefault();
  });

  // Spacebar: hold to speak
  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && e.target === document.body && !e.repeat) {
      e.preventDefault();
      if (currentState === "idle") {
        startListening();
      }
    }
    if (e.key === "Escape") {
      if (currentState === "listening") {
        // Cancel recording without sending
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
          recordedChunks = []; // Clear so onstop doesn't send
          mediaRecorder.stop();
        }
        if (mediaStream) {
          mediaStream.getTracks().forEach(function (t) { t.stop(); });
          mediaStream = null;
        }
        analyserNode = null;
        clearWaveform();
        setState("idle");
      } else if (currentState === "speaking") {
        stopSpeaking();
        setState("idle");
      }
    }
  });

  document.addEventListener("keyup", function (e) {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      if (currentState === "listening") {
        stopListening();
      }
    }
  });

  // Text input
  sendBtn.addEventListener("click", function () {
    var text = textInput.value.trim();
    if (text && currentState === "idle") {
      textInput.value = "";
      sendMessage(text);
    }
  });

  textInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      var text = textInput.value.trim();
      if (text && currentState === "idle") {
        textInput.value = "";
        sendMessage(text);
      }
    }
  });

  // Click anywhere while speaking to stop
  document.addEventListener("click", function (e) {
    if (currentState === "speaking" && e.target !== micBtn && !micBtn.contains(e.target)) {
      stopSpeaking();
      setState("idle");
    }
  });

  // Load browser voices
  if (window.speechSynthesis) {
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = function () {
      window.speechSynthesis.getVoices();
    };
  }

  // Initialize
  setState("idle");
})();
