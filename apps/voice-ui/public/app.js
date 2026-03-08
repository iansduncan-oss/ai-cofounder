// AI Co-Founder Voice UI — JARVIS Mode
(function () {
  "use strict";

  const API_URL = window.location.origin;

  // DOM elements
  const ring = document.getElementById("ring");
  const statusText = document.getElementById("status-text");
  const conversation = document.getElementById("conversation");
  const micBtn = document.getElementById("mic-btn");
  const textInput = document.getElementById("text-input");
  const sendBtn = document.getElementById("send-btn");
  const providerInfo = document.getElementById("provider-info");

  // Persistent user identity
  function getUserId() {
    let id = localStorage.getItem("voice-ui-user-id");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("voice-ui-user-id", id);
    }
    return id;
  }
  const userId = getUserId();

  // State
  let conversationId = localStorage.getItem("voice-ui-conversation-id");
  let isListening = false;
  let isSpeaking = false;
  let recognition = null;
  let synthesis = window.speechSynthesis;
  let speechSupported = false;
  let currentAudio = null;
  let ttsAvailable = false;

  // Check ElevenLabs TTS availability
  async function checkTTSAvailability() {
    try {
      const res = await fetch(API_URL + "/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "test" }),
      });
      ttsAvailable = res.ok;
    } catch {
      ttsAvailable = false;
    }
  }
  checkTTSAvailability();

  // Web Speech API setup
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (SpeechRecognition) {
    speechSupported = true;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = function (event) {
      const transcript = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");

      if (event.results[0].isFinal) {
        stopListening();
        sendMessage(transcript);
      }
    };

    recognition.onerror = function (event) {
      console.error("Speech recognition error:", event.error);
      stopListening();
      if (event.error !== "aborted") {
        setState("error");
        statusText.textContent = "Speech recognition error: " + event.error;
        setTimeout(() => setState("idle"), 2000);
      }
    };

    recognition.onend = function () {
      if (isListening) {
        stopListening();
      }
    };
  } else {
    micBtn.classList.add("hidden");
    statusText.textContent = "Type to chat (voice requires Chrome)";
  }

  // State management
  function setState(state) {
    ring.className = state;
    switch (state) {
      case "idle":
        statusText.textContent = "Ready";
        break;
      case "listening":
        statusText.textContent = "Listening...";
        break;
      case "thinking":
        statusText.textContent = "Thinking...";
        break;
      case "streaming":
        statusText.textContent = "Responding...";
        break;
      case "speaking":
        statusText.textContent = "Speaking...";
        break;
      case "error":
        break;
    }
  }

  function startListening() {
    if (!recognition || isListening) return;
    stopSpeaking();
    isListening = true;
    micBtn.classList.add("active");
    setState("listening");
    try {
      recognition.start();
    } catch (e) {
      stopListening();
    }
  }

  function stopListening() {
    isListening = false;
    micBtn.classList.remove("active");
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        // Already stopped
      }
    }
  }

  function stopSpeaking() {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (synthesis) {
      synthesis.cancel();
    }
    isSpeaking = false;
  }

  // ── Streaming message send ──
  async function sendMessage(text) {
    if (!text.trim()) return;

    addMessage("user", text);
    setState("thinking");

    try {
      const payload = {
        message: text,
        userId: userId,
      };
      if (conversationId) {
        payload.conversationId = conversationId;
      }

      // Use streaming endpoint
      const res = await fetch(API_URL + "/voice/chat/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Server returned " + res.status);
      }

      // Parse SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullResponse = "";
      let messageDiv = null;
      let model = "";
      let provider = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const event = JSON.parse(line.slice(6));

            switch (event.type) {
              case "thinking":
                setState("thinking");
                break;

              case "text_delta":
                if (!messageDiv) {
                  messageDiv = addMessage("agent", "");
                  setState("streaming");
                }
                fullResponse += event.data.delta || "";
                messageDiv.firstChild.textContent = fullResponse;
                conversation.scrollTop = conversation.scrollHeight;
                break;

              case "tool_call":
                if (!messageDiv) {
                  messageDiv = addMessage("agent", "");
                }
                // Show tool usage inline
                statusText.textContent =
                  "Using " + (event.data.name || "tool") + "...";
                break;

              case "done":
                if (event.data) {
                  conversationId = event.data.conversationId || conversationId;
                  model = event.data.model || "";
                  provider = event.data.provider || "";

                  // Persist conversation ID
                  if (conversationId) {
                    localStorage.setItem(
                      "voice-ui-conversation-id",
                      conversationId,
                    );
                  }

                  // Show provider info
                  const parts = [];
                  if (provider) parts.push(provider);
                  if (model) parts.push(model);
                  if (event.data.usage) {
                    parts.push(
                      event.data.usage.inputTokens +
                        "→" +
                        event.data.usage.outputTokens +
                        " tokens",
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
            // Ignore malformed JSON lines
          }
        }
      }

      // Speak the full response
      if (fullResponse) {
        speak(fullResponse);
      } else {
        setState("idle");
      }
    } catch (err) {
      console.error("API error:", err);
      setState("error");
      statusText.textContent = "Connection failed";
      addMessage("agent", "Something went wrong. Is the server running?");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  // ── TTS — try ElevenLabs, fall back to Web Speech API ──
  async function speak(text) {
    if (ttsAvailable) {
      await speakElevenLabs(text);
    } else {
      speakBrowser(text);
    }
  }

  async function speakElevenLabs(text) {
    setState("speaking");
    isSpeaking = true;

    try {
      const res = await fetch(API_URL + "/voice/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: text }),
      });

      if (!res.ok) {
        // Fall back to browser TTS
        speakBrowser(text);
        return;
      }

      const blob = await res.blob();
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      currentAudio = audio;

      audio.onended = function () {
        isSpeaking = false;
        currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        setState("idle");
      };

      audio.onerror = function () {
        isSpeaking = false;
        currentAudio = null;
        URL.revokeObjectURL(audioUrl);
        setState("idle");
      };

      await audio.play();
    } catch (err) {
      console.error("ElevenLabs TTS error:", err);
      isSpeaking = false;
      speakBrowser(text);
    }
  }

  function speakBrowser(text) {
    if (!synthesis) {
      setState("idle");
      return;
    }

    synthesis.cancel();

    const cleanText = text
      .replace(/```[\s\S]*?```/g, " (code block) ")
      .replace(/[*_#`~]/g, "")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .trim();

    if (!cleanText) {
      setState("idle");
      return;
    }

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 0.95;

    const voices = synthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.name.includes("Samantha") ||
        v.name.includes("Daniel") ||
        v.name.includes("Google UK English Male"),
    );
    if (preferred) utterance.voice = preferred;

    utterance.onstart = function () {
      isSpeaking = true;
      setState("speaking");
    };

    utterance.onend = function () {
      isSpeaking = false;
      setState("idle");
    };

    utterance.onerror = function () {
      isSpeaking = false;
      setState("idle");
    };

    synthesis.speak(utterance);
  }

  // Add message to conversation UI — returns the div for streaming updates
  function addMessage(role, text, model, provider) {
    const div = document.createElement("div");
    div.className = "message " + role;

    const content = document.createElement("span");
    content.textContent = text;
    div.appendChild(content);

    if (role === "agent" && (model || provider)) {
      const meta = document.createElement("div");
      meta.className = "meta";
      const parts = [];
      if (provider) parts.push(provider);
      if (model) parts.push(model);
      meta.textContent = parts.join(" · ");
      div.appendChild(meta);
    }

    conversation.appendChild(div);
    conversation.scrollTop = conversation.scrollHeight;
    return div;
  }

  // ── Event listeners ──

  micBtn.addEventListener("mousedown", function (e) {
    e.preventDefault();
    startListening();
  });

  micBtn.addEventListener("mouseup", function () {
    stopListening();
  });

  micBtn.addEventListener("mouseleave", function () {
    if (isListening) stopListening();
  });

  micBtn.addEventListener("touchstart", function (e) {
    e.preventDefault();
    startListening();
  });

  micBtn.addEventListener("touchend", function (e) {
    e.preventDefault();
    stopListening();
  });

  document.addEventListener("keydown", function (e) {
    if (e.code === "Space" && e.target === document.body && speechSupported) {
      e.preventDefault();
      if (!isListening) startListening();
    }
  });

  document.addEventListener("keyup", function (e) {
    if (e.code === "Space" && e.target === document.body) {
      e.preventDefault();
      stopListening();
    }
  });

  sendBtn.addEventListener("click", function () {
    const text = textInput.value.trim();
    if (text) {
      textInput.value = "";
      sendMessage(text);
    }
  });

  textInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      const text = textInput.value.trim();
      if (text) {
        textInput.value = "";
        sendMessage(text);
      }
    }
  });

  // Stop speaking on click
  document.addEventListener("click", function (e) {
    if (isSpeaking && e.target !== micBtn) {
      stopSpeaking();
      setState("idle");
    }
  });

  // Load voices
  if (synthesis) {
    synthesis.getVoices();
    synthesis.onvoiceschanged = function () {
      synthesis.getVoices();
    };
  }

  setState("idle");
})();
