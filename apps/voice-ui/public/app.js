// AI Co-Founder Voice UI
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

  // Persistent user identity (survives page reloads)
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
  let conversationId = null;
  let isListening = false;
  let isSpeaking = false;
  let recognition = null;
  let synthesis = window.speechSynthesis;
  let speechSupported = false;

  // Check for Web Speech API support
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

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
    // No speech support — hide mic button
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
      case "speaking":
        statusText.textContent = "Speaking...";
        break;
      case "error":
        // Status text set by caller
        break;
    }
  }

  // Start/stop listening
  function startListening() {
    if (!recognition || isListening) return;
    isListening = true;
    micBtn.classList.add("active");
    setState("listening");
    try {
      recognition.start();
    } catch (e) {
      // Already started
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

  // Send message to API
  async function sendMessage(text) {
    if (!text.trim()) return;

    addMessage("user", text);
    setState("thinking");

    try {
      const payload = {
        message: text,
        platform: "voice",
        userId: userId,
      };
      if (conversationId) {
        payload.conversationId = conversationId;
      }

      const res = await fetch(API_URL + "/voice/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Server returned " + res.status);
      }

      const data = await res.json();
      conversationId = data.conversationId;

      addMessage("agent", data.response, data.model, data.provider);

      // Speak the response
      speak(data.response);

      // Show provider info
      const parts = [];
      if (data.provider) parts.push(data.provider);
      if (data.model) parts.push(data.model);
      if (data.usage) {
        parts.push(data.usage.inputTokens + "→" + data.usage.outputTokens + " tokens");
      }
      providerInfo.textContent = parts.join(" · ");
    } catch (err) {
      console.error("API error:", err);
      setState("error");
      statusText.textContent = "Connection failed";
      addMessage("agent", "Something went wrong. Is the server running?");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  // Text-to-speech
  function speak(text) {
    if (!synthesis) {
      setState("idle");
      return;
    }

    // Cancel any ongoing speech
    synthesis.cancel();

    // Clean text for speech (remove markdown)
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

    // Prefer a natural-sounding voice
    const voices = synthesis.getVoices();
    const preferred = voices.find(
      (v) =>
        v.name.includes("Samantha") ||
        v.name.includes("Daniel") ||
        v.name.includes("Google UK English Male"),
    );
    if (preferred) {
      utterance.voice = preferred;
    }

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

  // Add message to conversation UI
  function addMessage(role, text, model, provider) {
    const div = document.createElement("div");
    div.className = "message " + role;
    div.textContent = text;

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
  }

  // Event listeners

  // Mic button — push to talk
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

  // Touch events for mobile
  micBtn.addEventListener("touchstart", function (e) {
    e.preventDefault();
    startListening();
  });

  micBtn.addEventListener("touchend", function (e) {
    e.preventDefault();
    stopListening();
  });

  // Spacebar — push to talk
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

  // Text input fallback
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

  // Stop speaking on click anywhere during speech
  document.addEventListener("click", function (e) {
    if (isSpeaking && e.target !== micBtn) {
      synthesis.cancel();
      isSpeaking = false;
      setState("idle");
    }
  });

  // Load voices (they're async in Chrome)
  if (synthesis) {
    synthesis.getVoices();
    synthesis.onvoiceschanged = function () {
      synthesis.getVoices();
    };
  }

  // Initial state
  setState("idle");
})();
