const authSection = document.getElementById('authSection');
const appSection = document.getElementById('appSection');
const authMessage = document.getElementById('authMessage');
const roomInfo = document.getElementById('roomInfo');
const currentUser = document.getElementById('currentUser');

const loginForm = document.getElementById('loginForm');
const registerForm = document.getElementById('registerForm');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const setVideoBtn = document.getElementById('setVideoBtn');
const chatForm = document.getElementById('chatForm');

const roomCodeInput = document.getElementById('roomCode');
const videoUrlInput = document.getElementById('videoUrl');
const videoPlayer = document.getElementById('videoPlayer');
const chatInput = document.getElementById('chatInput');
const chatMessages = document.getElementById('chatMessages');

let token = localStorage.getItem('token') || '';
let currentRoom = '';
let polling = null;
let lastEventTime = 0;
let suppressEvents = false;

function addChatLine(text) {
  const line = document.createElement('p');
  line.textContent = text;
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function api(path, method = 'GET', body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro na requisição');
  return data;
}

function applyState(state) {
  if (!videoPlayer.src || !state) return;
  suppressEvents = true;

  if (Math.abs(videoPlayer.currentTime - state.currentTime) > 1) {
    videoPlayer.currentTime = state.currentTime;
  }

  if (state.isPlaying && videoPlayer.paused) videoPlayer.play().catch(() => {});
  if (!state.isPlaying && !videoPlayer.paused) videoPlayer.pause();

  setTimeout(() => {
    suppressEvents = false;
  }, 150);
}

async function emitPlayerState() {
  if (!currentRoom || suppressEvents) return;
  await api(`/api/room/${currentRoom}/player`, 'POST', {
    currentTime: videoPlayer.currentTime,
    isPlaying: !videoPlayer.paused,
  }).catch(() => {});
}

async function loadRoomState() {
  const state = await api(`/api/room/${currentRoom}/state`);
  roomInfo.textContent = `Na sala: ${state.roomCode}`;
  if (state.videoUrl) {
    videoPlayer.src = state.videoUrl;
    videoUrlInput.value = state.videoUrl;
  }
  applyState(state.playerState);
}

function startPollingEvents() {
  if (polling) clearInterval(polling);
  polling = setInterval(async () => {
    if (!currentRoom) return;
    try {
      const data = await api(`/api/room/${currentRoom}/events?since=${lastEventTime}`);
      lastEventTime = data.now;
      data.events.forEach((event) => {
        if (event.type === 'chat-message') {
          addChatLine(`${event.data.username}: ${event.data.text}`);
        }
        if (event.type === 'video-updated') {
          videoPlayer.src = event.data.videoUrl;
          videoUrlInput.value = event.data.videoUrl;
          addChatLine(`📺 Vídeo atualizado por ${event.data.by}.`);
        }
        if (event.type === 'player-sync') {
          applyState(event.data);
        }
      });
    } catch {
      // ignore transient failures
    }
  }, 1000);
}

async function initSession() {
  if (!token) return;

  try {
    const me = await api('/api/me');
    currentUser.textContent = me.username;
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    roomInfo.textContent = 'Conectado. Entre em uma sala.';
  } catch {
    token = '';
    localStorage.removeItem('token');
  }
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUser').value;
  const password = document.getElementById('loginPass').value;

  try {
    const data = await api('/api/login', 'POST', { username, password });
    token = data.token;
    localStorage.setItem('token', token);
    currentUser.textContent = data.username;
    authSection.classList.add('hidden');
    appSection.classList.remove('hidden');
    authMessage.textContent = 'Login realizado com sucesso!';
  } catch (err) {
    authMessage.textContent = err.message;
  }
});

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('registerUser').value;
  const password = document.getElementById('registerPass').value;

  try {
    const data = await api('/api/register', 'POST', { username, password });
    authMessage.textContent = data.message;
  } catch (err) {
    authMessage.textContent = err.message;
  }
});

joinRoomBtn.addEventListener('click', async () => {
  const roomCode = roomCodeInput.value.trim().toUpperCase();
  if (!roomCode) return;
  currentRoom = roomCode;
  lastEventTime = 0;
  chatMessages.innerHTML = '';
  await loadRoomState();
  startPollingEvents();
  addChatLine(`ℹ️ Você entrou na sala ${currentRoom}.`);
});

setVideoBtn.addEventListener('click', async () => {
  if (!currentRoom) return;
  const videoUrl = videoUrlInput.value.trim();
  await api(`/api/room/${currentRoom}/video`, 'POST', { videoUrl });
});

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentRoom) return;
  const text = chatInput.value.trim();
  if (!text) return;
  await api(`/api/room/${currentRoom}/chat`, 'POST', { text });
  chatInput.value = '';
});

['play', 'pause', 'seeked'].forEach((eventName) => {
  videoPlayer.addEventListener(eventName, emitPlayerState);
});

initSession();
