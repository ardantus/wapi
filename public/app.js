(async function () {
  const statusEl = document.getElementById('status');
  const chatsEl = document.getElementById('chats');
  const refreshBtn = document.getElementById('refreshChats');
  const clientSelect = document.getElementById('clientSelect');
  const addClientBtn = document.getElementById('addClient');
  const delClientBtn = document.getElementById('delClient');
  const qrImg = document.getElementById('qr');
  const eventsEl = document.getElementById('events');
  const chatTitle = document.getElementById('chatTitle');
  const chatInfo = document.getElementById('chatInfo');
  const messagesEl = document.getElementById('messages');
  const messageInput = document.getElementById('message');
  const sendBtn = document.getElementById('send');
  const sendMediaBtn = document.getElementById('sendMedia');
  const mediaFile = document.getElementById('mediaFile');
  const mediaInfo = document.getElementById('mediaInfo');
  const apiKeyDisplay = document.getElementById('apiKeyDisplay');
  const copyApiKeyBtn = document.getElementById('copyApiKey');
  const generateApiKeyBtn = document.getElementById('generateApiKey');
  const rotateApiKeyBtn = document.getElementById('rotateApiKey');
  const prevMessagesBtn = document.getElementById('prevMessages');
  const nextMessagesBtn = document.getElementById('nextMessages');
  const exportMessagesBtn = document.getElementById('exportMessages');
  const groupActions = document.getElementById('groupActions');
  const participantsInput = document.getElementById('participants');
  const participantsList = document.getElementById('participantsList');
  const searchChats = document.getElementById('searchChats');
  const chatSearchResult = document.getElementById('chatSearchResult');
  const searchMessages = document.getElementById('searchMessages');
  const messageSearchResult = document.getElementById('messageSearchResult');

  let chats = [];
  let allMessages = []; // store all loaded messages for search
  let selectedChat = null;
  // Restore last selected client from localStorage, default to 'default'
  let selectedClient = localStorage.getItem('lastSelectedClient') || 'default';
  let currentApiKey = '';
  const messageCache = {}; // { chatId: Set of message ids to avoid duplicates }
  const messageHistory = []; // message input history
  let messageHistoryIndex = -1;
  const profilePicCache = {}; // cache profile pictures per client: { clientId: { chatId: url } }

  // Media lazy loading functions
  async function checkAndLoadMedia(msgId, mediaType, placeholderId) {
    try {
      const res = await fetch(`/media/${encodeURIComponent(msgId)}/exists?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`);
      if (!res.ok) {
        // Server error, keep placeholder
        console.warn('Media exists check failed:', msgId, res.status);
        return;
      }
      const data = await res.json();
      if (data.exists) {
        // Media exists locally, load it immediately
        console.log('Media exists, loading:', msgId);
        loadMediaContent(msgId, mediaType, placeholderId);
      } else {
        console.log('Media does not exist, keeping placeholder:', msgId);
      }
      // If not exists, keep placeholder as-is (user can click to download)
    } catch (e) {
      // If check fails, keep placeholder
      console.warn('Failed to check media:', msgId, e);
    }
  }

  window.loadMediaOnDemand = async function (msgId, mediaType, placeholderId) {
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return;

    // Show loading state
    placeholder.innerHTML = '<div style="padding:20px;text-align:center;color:#666">⏳ Loading...</div>';

    // Try to download media first (this will trigger server-side download if not exists)
    try {
      const checkRes = await fetch(`/media/${encodeURIComponent(msgId)}/exists?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`);
      const checkData = await checkRes.json();

      if (!checkData.exists) {
        // Need to download from WhatsApp first
        // Just try to access the download endpoint, it will trigger download
        const downloadRes = await fetch(`/media/${encodeURIComponent(msgId)}/download?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`);
        if (!downloadRes.ok) {
          placeholder.innerHTML = '<div style="padding:12px;background:#ffe0e0;border-radius:4px;color:#c00">❌ Failed to load media</div>';
          return;
        }
      }

      // Now load the media content
      loadMediaContent(msgId, mediaType, placeholderId);
    } catch (e) {
      placeholder.innerHTML = '<div style="padding:12px;background:#ffe0e0;border-radius:4px;color:#c00">❌ Error: ' + e.message + '</div>';
    }
  };

  function loadMediaContent(msgId, mediaType, placeholderId) {
    const placeholder = document.getElementById(placeholderId);
    if (!placeholder) return;

    const mediaUrl = `/media/${encodeURIComponent(msgId)}/download?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`;

    if (mediaType === 'image') {
      const img = new Image();
      img.style.cssText = 'max-width:200px;max-height:200px;border-radius:4px';
      img.onload = () => {
        placeholder.innerHTML = '';
        placeholder.appendChild(img);
      };
      img.onerror = () => {
        // Restore placeholder on error
        placeholder.innerHTML = `<div style="width:200px;height:150px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed #ccc" onclick="loadMediaOnDemand('${msgId}', 'image', '${placeholderId}')">
          <span style="color:#999">🖼️ Click to load image</span>
        </div>`;
      };
      img.src = mediaUrl;
    } else if (mediaType === 'video') {
      placeholder.innerHTML = `<video style="max-width:200px;max-height:200px;border-radius:4px" controls><source src="${mediaUrl}"></video>`;
    } else if (mediaType === 'audio') {
      placeholder.innerHTML = `<audio style="width:100%;max-width:300px" controls><source src="${mediaUrl}"></audio>`;
    }
  }

  // Intersection Observer for scroll-based lazy loading
  let mediaObserver = null;
  const loadedMediaSet = new Set();

  function initMediaObserver() {
    if (mediaObserver) mediaObserver.disconnect();

    mediaObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const placeholder = entry.target;
          const msgId = placeholder.dataset.msgId;
          const mediaType = placeholder.dataset.mediaType;
          const placeholderId = placeholder.id;

          // Skip if already loaded
          if (loadedMediaSet.has(placeholderId)) return;
          loadedMediaSet.add(placeholderId);

          // Check and load media
          checkAndLoadMedia(msgId, mediaType, placeholderId);

          // Stop observing this element
          mediaObserver.unobserve(placeholder);
        }
      });
    }, {
      root: messagesEl,
      rootMargin: '50px',
      threshold: 0.1
    });
  }

  function observeMediaPlaceholders() {
    // Observe all media placeholders that haven't been loaded yet
    const placeholders = messagesEl.querySelectorAll('.media-lazy');
    placeholders.forEach(p => {
      if (!loadedMediaSet.has(p.id)) {
        mediaObserver.observe(p);
      }
    });
  }

  function logEvent(text) {
    eventsEl.textContent = new Date().toLocaleTimeString() + ' ' + text + '\n' + eventsEl.textContent;
  }

  async function updateQR() {
    // Check client status first, only show QR if not ready
    if (!currentApiKey) {
      // API key not available yet, skip QR update
      qrImg.style.display = 'none';
      return;
    }

    try {
      const res = await fetch(`/status?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`);
      if (!res.ok) {
        qrImg.style.display = 'none';
        return;
      }
      const data = await res.json();
      if (data.status === 'ready' || data.status === 'authenticated') {
        // Client already authenticated, hide QR
        qrImg.style.display = 'none';
      } else if (data.status === 'qr') {
        // Client has QR available
        qrImg.src = `/qr?client=${encodeURIComponent(selectedClient)}&ts=${Date.now()}`;
        qrImg.style.display = '';
      } else {
        // Other status (initializing, etc), hide QR
        qrImg.style.display = 'none';
      }
    } catch (e) {
      // On error, hide QR
      qrImg.style.display = 'none';
    }
  }

  function appendMessageToChat(msg) {
    // only append if we're viewing the correct chat and client
    if (!selectedChat || selectedChat.id !== msg.chatId) return;

    const cacheKey = selectedChat.id;
    const msgId = msg.id || `${msg.from}-${msg.timestamp}`;

    // avoid duplicate messages
    if (!messageCache[cacheKey]) messageCache[cacheKey] = new Set();
    if (messageCache[cacheKey].has(msgId)) return;
    messageCache[cacheKey].add(msgId);

    // create nicely formatted message element
    const msgData = { id: msgId, from: msg.from, body: msg.body, timestamp: msg.timestamp };
    allMessages.push(msgData);

    // Determine direction
    const isOutgoing = msg.from === 'outgoing' || msg.from === 'Me' || (msg.id && msg.id.fromMe);

    // Profile Pic logic
    const avatarUrl = isOutgoing
      ? 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/340px-Default_pfp.svg.png'
      : (selectedChat.profilePicUrl || 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/340px-Default_pfp.svg.png');

    const row = document.createElement('div');
    row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;

    const d = document.createElement('div');
    d.className = `message-item ${isOutgoing ? 'outgoing' : 'incoming'}`;

    // Build media element if message has media
    let mediaHtml = '';
    if (msg.hasMedia && msg.mediaType) {
      const mediaUrl = `/media/${msgId}/download?client=${selectedClient}&api_key=${currentApiKey}`;
      // Create placeholder that will be replaced with actual media or download button
      const placeholderId = `media-placeholder-${msgId.replace(/[^a-zA-Z0-9]/g, '_')}`;

      // Detect media type from MIME type (msg.mediaType is like "image/jpeg", "video/mp4", etc.)
      const mediaCategory = msg.mediaType.split('/')[0]; // Extract "image", "video", "audio", etc.

      if (mediaCategory === 'image') {
        mediaHtml = `<div id="${placeholderId}" class="media-lazy" data-msg-id="${msgId}" data-media-type="image" style="margin:8px 0">
          <div style="width:200px;height:150px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed #ccc" onclick="loadMediaOnDemand('${msgId}', 'image', '${placeholderId}')">
            <span style="color:#999">🖼️ Click to load image</span>
          </div>
        </div>`;
      } else if (mediaCategory === 'video') {
        mediaHtml = `<div id="${placeholderId}" class="media-lazy" data-msg-id="${msgId}" data-media-type="video" style="margin:8px 0">
          <div style="width:200px;height:150px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed #ccc" onclick="loadMediaOnDemand('${msgId}', 'video', '${placeholderId}')">
            <span style="color:#999">🎥 Click to load video</span>
          </div>
        </div>`;
      } else if (mediaCategory === 'audio') {
        mediaHtml = `<div id="${placeholderId}" class="media-lazy" data-msg-id="${msgId}" data-media-type="audio" style="margin:8px 0">
          <div style="padding:12px;background:#f0f0f0;border-radius:4px;cursor:pointer;border:2px dashed #ccc;max-width:300px" onclick="loadMediaOnDemand('${msgId}', 'audio', '${placeholderId}')">
            <span style="color:#999">🔊 Click to load audio</span>
          </div>
        </div>`;
      } else if (mediaCategory === 'application' || msg.mediaType.includes('document')) {
        mediaHtml = `<div style="margin:8px 0;padding:8px;background:#f0f0f0;border-radius:4px"><a href="${mediaUrl}" download style="color:#007bff;text-decoration:underline">📎 Download Document</a></div>`;
      }

      // Don't auto-load media, wait for scroll-based lazy loading
    }

    // Handle location messages
    let locationHtml = '';
    if (msg.isLocation) {
      locationHtml = `<div style="margin:8px 0;padding:8px;background:#e3f2fd;border-radius:4px">📍 Location</div>`;
    }

    // Handle contact cards
    let contactHtml = '';
    if (msg.isContact) {
      contactHtml = `<div style="margin:8px 0;padding:8px;background:#f3e5f5;border-radius:4px">👤 Contact Card</div>`;
    }

    // Handle stickers
    let stickerHtml = '';
    if (msg.isSticker && msg.hasMedia) {
      const mediaUrl = `/media/${msgId}/download?client=${selectedClient}&api_key=${currentApiKey}`;
      stickerHtml = `<img src="${mediaUrl}" style="max-width:100px;max-height:100px;margin:8px 0" onerror="this.style.display='none'">`;
    }

    d.innerHTML = `
      <div class="sender">${msg.from}</div>
      ${mediaHtml}
      ${locationHtml}
      ${contactHtml}
      ${stickerHtml}
      <div class="body">${escapeHtml(msg.body || '')}</div>
      <div class="time">${new Date((msg.timestamp || 0) * 1000).toLocaleString()}</div>
      <button class="react-btn" data-msgid="${msgId}" style="display:none;font-size:12px;margin-top:4px;padding:2px 8px;cursor:pointer">👍 React</button>
      <button class="reply-btn" onclick="prepareReply('${msgId}')" style="display:none;font-size:12px;margin-top:4px;padding:2px 8px;cursor:pointer;margin-left:5px">↩ Reply</button>
    `;

    // Construct DOM with Avatar
    const av = document.createElement('img');
    av.className = 'msg-avatar';
    av.src = avatarUrl;
    av.onerror = function () { this.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/340px-Default_pfp.svg.png' };

    if (isOutgoing) {
      row.appendChild(d);
      row.appendChild(av);
    } else {
      row.appendChild(av);
      row.appendChild(d);
    }

    messagesEl.appendChild(row);

    // Add reaction click handler
    const reactBtn = d.querySelector('.react-btn');
    if (reactBtn) {
      reactBtn.onclick = async () => {
        const emoji = prompt('Enter emoji to react (e.g. 👍, ❤️, 😂):', '👍');
        if (!emoji) return;
        try {
          const res = await fetch(`/message/${msgId}/react?client=${selectedClient}&api_key=${currentApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ emoji })
          });
          if (res.ok) {
            reactBtn.textContent = `${emoji} Reacted`;
            reactBtn.disabled = true;
          } else {
            alert('Failed to react: ' + (await res.json()).error);
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };
    }

    messagesEl.scrollTop = messagesEl.scrollHeight; // auto scroll to bottom

    // Start observing media placeholders for scroll-based lazy loading
    setTimeout(() => observeMediaPlaceholders(), 100);
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function connectSse() {
    const es = new EventSource('/events');
    es.onopen = () => logEvent('SSE connected');
    es.onerror = e => logEvent('SSE error');
    es.addEventListener('status', e => {
      const d = JSON.parse(e.data);
      // status event for client
      if (d.clientId === selectedClient) statusEl.textContent = d.payload && d.payload.status ? d.payload.status : d.status || '-';
    });
    // generic events carry { clientId, payload }
    ['qr', 'ready', 'message', 'message_create', 'group_join', 'group_leave', 'message_ack'].forEach(evt => {
      es.addEventListener(evt, e => {
        try {
          const raw = JSON.parse(e.data);
          const cid = raw.clientId;
          const payload = raw.payload;
          if (cid !== selectedClient) return; // ignore other clients
          if (evt === 'qr') { logEvent('QR received for ' + cid); qrImg.src = '/qr?client=' + cid + '&ts=' + Date.now(); qrImg.style.display = ''; }
          else if (evt === 'ready') { logEvent('Client ready ' + cid); qrImg.style.display = 'none'; }
          else if (evt === 'message' && payload) {
            logEvent('message from ' + payload.from);

            // Optimistic Chat List Reorder: Move active chat to top
            let chatUpdated = false;
            const chatIdx = chats.findIndex(c => c.id === payload.chatId);
            if (chatIdx > -1) {
              const c = chats.splice(chatIdx, 1)[0];
              c.timestamp = payload.timestamp || Math.floor(Date.now() / 1000);

              // Increment unread count if not current chat and message is not from me
              const isFromMe = payload.from === 'Me' || (payload.id && payload.id.fromMe);
              if (!isFromMe && (!selectedChat || selectedChat.id !== payload.chatId)) {
                c.unreadCount = (c.unreadCount || 0) + 1;
              }

              // Optionally update last message snippet here if c.lastMessage exists
              chats.unshift(c);
              chatUpdated = true;
              renderChats();
            } else {
              // New chat found - fetch full list to get metadata properly
              loadChats();
            }

            // auto-append message to chat if it matches selected chat
            if (selectedChat && payload.chatId === selectedChat.id) {
              appendMessageToChat(payload);
            }
          }
          else logEvent(evt + ' ' + JSON.stringify(payload));
        } catch (err) { console.error(err); }
      });
    });
  }

  async function loadChats() {
    const res = await fetch('/chats?client=' + encodeURIComponent(selectedClient) + '&api_key=' + currentApiKey);
    chats = await res.json();

    // Sort chats by timestamp descending (newest first)
    chats.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    // Restore cached profile pictures for this client
    if (!profilePicCache[selectedClient]) profilePicCache[selectedClient] = {};
    chats.forEach(c => {
      if (profilePicCache[selectedClient][c.id]) {
        c.profilePicUrl = profilePicCache[selectedClient][c.id];
      }
    });

    // Render chats immediately for fast UI response
    renderChats();

    // Fetch profile pictures in background (limit to avoid too many requests)
    // Only fetch if we don't already have the picture cached
    const picPromises = chats.slice(0, 20).map(async c => {
      if (profilePicCache[selectedClient][c.id]) return; // skip if already cached
      try {
        const picRes = await fetch(`/contact/${encodeURIComponent(c.id)}/picture?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`);
        if (picRes.ok) {
          const data = await picRes.json();
          // profilePicUrl can be null if contact has no picture
          if (data.profilePicUrl) {
            c.profilePicUrl = data.profilePicUrl;
            profilePicCache[selectedClient][c.id] = data.profilePicUrl; // cache it
            renderChats(); // re-render to show new pictures as they load
          } else {
            // Cache null to avoid re-fetching
            profilePicCache[selectedClient][c.id] = null;
          }
        }
      } catch (e) {
        // ignore errors, profile pic is optional
      }
    });
    // Don't await - let pictures load in background
    Promise.all(picPromises).catch(() => { });
  }

  function renderChats() {
    chatsEl.innerHTML = '';
    const query = searchChats.value.toLowerCase().trim();

    let filtered = chats;
    if (query) {
      filtered = chats.filter(c => (c.name || c.id).toLowerCase().includes(query));
    }

    chatSearchResult.textContent = query ? `Found ${filtered.length} of ${chats.length}` : '';

    filtered.forEach(c => {
      const d = document.createElement('div');
      d.className = 'chat-item'; // Updated class name to match CSS

      // Add profile picture if available
      let picHtml = '';
      if (c.profilePicUrl) {
        picHtml = `<div class="chat-avatar"><img src="${c.profilePicUrl}" onerror="this.style.display='none'"></div>`;
      } else {
        picHtml = `<div class="chat-avatar"><div style="width:100%;height:100%;background:#ddd"></div></div>`;
      }

      // Unread Badge
      let badgeHtml = '';
      if (c.unreadCount > 0) {
        badgeHtml = `<div class="unread-badge">${c.unreadCount}</div>`;
      }

      d.innerHTML = `
        ${picHtml}
        <div class="chat-info">
            <div class="chat-name">${escapeHtml(c.name || c.id)}</div>
            <div class="chat-preview">${escapeHtml(c.id)}</div>
        </div>
        ${badgeHtml}
      `;
      d.onclick = () => selectChat(c);
      if (selectedChat && selectedChat.id === c.id) d.classList.add('active');
      chatsEl.appendChild(d);
    });
  }

  function selectChat(c) {
    selectedChat = c;
    // Reset unread count
    c.unreadCount = 0;

    // persist last selected chat per client
    try {
      const key = 'lastSelectedChatByClient';
      const map = JSON.parse(localStorage.getItem(key) || '{}');
      map[selectedClient] = c.id;
      localStorage.setItem(key, JSON.stringify(map));
    } catch { }
    chatTitle.textContent = c.name || c.id;
    chatInfo.textContent = JSON.stringify(c, null, 2);
    groupActions.style.display = c.isGroup ? '' : 'none';

    // Add mute/unmute controls if not already present
    if (!document.getElementById('muteControls')) {
      const muteControls = document.createElement('div');
      muteControls.id = 'muteControls';
      muteControls.style.cssText = 'margin:10px 0;display:flex;gap:8px';
      muteControls.innerHTML = `
        <button id="muteChatBtn" style="padding:6px 12px;cursor:pointer">🔇 Mute Chat</button>
        <button id="unmuteChatBtn" style="padding:6px 12px;cursor:pointer">🔔 Unmute Chat</button>
        <input type="number" id="muteDuration" placeholder="Duration (seconds)" style="width:150px;padding:6px" value="3600">
      `;
      chatTitle.parentNode.insertBefore(muteControls, chatTitle.nextSibling);

      // Mute button handler
      document.getElementById('muteChatBtn').onclick = async () => {
        if (!selectedChat) return;
        const duration = parseInt(document.getElementById('muteDuration').value) || 0;
        try {
          const res = await fetch(`/chat/${encodeURIComponent(selectedChat.id)}/mute?client=${selectedClient}&api_key=${currentApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration })
          });
          const data = await res.json();
          if (res.ok) {
            alert(`Chat muted until: ${data.mutedUntil}`);
          } else {
            alert('Failed to mute: ' + data.error);
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };

      // Unmute button handler
      document.getElementById('unmuteChatBtn').onclick = async () => {
        if (!selectedChat) return;
        try {
          const res = await fetch(`/chat/${encodeURIComponent(selectedChat.id)}/unmute?client=${selectedClient}&api_key=${currentApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
          });
          const data = await res.json();
          if (res.ok) {
            alert('Chat unmuted');
          } else {
            alert('Failed to unmute: ' + data.error);
          }
        } catch (e) {
          alert('Error: ' + e.message);
        }
      };
    }

    // reset message cache for this chat to ensure fresh load
    messageCache[c.id] = new Set();
    allMessages = [];
    searchMessages.value = '';
    messageSearchResult.textContent = '';
    loadMessages();
    renderChats();
  }

  // Reply Indicator UI
  let replyingTo = null;
  const replyIndicator = document.createElement('div');
  replyIndicator.id = 'replyIndicator';
  replyIndicator.style.cssText = 'background:#f0f0f0;padding:8px;border-left:4px solid var(--primary-color);margin-bottom:8px;display:none;align-items:center;justify-content:space-between;border-radius:4px';
  messageInput.parentNode.insertBefore(replyIndicator, messageInput);

  function setReply(msg) {
    replyingTo = msg;
    replyIndicator.style.display = 'flex';
    replyIndicator.innerHTML = `
        <div style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;margin-right:10px">
            <div style="font-size:12px;color:var(--primary-color)">Replying to ${escapeHtml(msg.from)}</div>
            <div style="font-size:12px;color:#666">${escapeHtml(msg.body.substring(0, 50))}</div>
        </div>
        <button style="background:none;color:#999;font-size:16px;padding:0;cursor:pointer" onclick="cancelReply()">×</button>
      `;
    messageInput.focus();
  }

  window.cancelReply = function () { // Attach to window to be accessible from inline onclick
    replyingTo = null;
    replyIndicator.style.display = 'none';
  };

  // Add mentions input field (appears below message input)
  const mentionsContainer = document.createElement('div');
  mentionsContainer.id = 'mentionsContainer';
  mentionsContainer.style.cssText = 'margin-top:8px;display:none';
  mentionsContainer.innerHTML = `
    <label style="font-size:12px;color:#666">Mentions (comma-separated contact IDs):</label><br>
    <input type="text" id="mentionsInput" placeholder="e.g. 6281234@c.us, 6285678@c.us" style="width:100%;padding:4px;margin-top:4px">
  `;
  messageInput.parentNode.insertBefore(mentionsContainer, messageInput.nextSibling);

  // Toggle mentions input when @ is typed
  messageInput.addEventListener('input', () => {
    if (messageInput.value.includes('@')) {
      mentionsContainer.style.display = '';
    }
  });

  sendBtn.onclick = async () => {
    if (!selectedChat) return alert('Select a chat first');
    const text = messageInput.value.trim();
    if (!text) return;

    // add to history
    messageHistory.push(text);
    messageHistoryIndex = -1;

    // Get mentions if any
    const mentionsInput = document.getElementById('mentionsInput');
    const mentionsText = mentionsInput ? mentionsInput.value.trim() : '';
    const mentions = mentionsText ? mentionsText.split(',').map(m => m.trim()).filter(m => m) : [];
    localStorage.setItem('messageHistory', JSON.stringify(messageHistory));

    // Optimistic UI: Clear input immediately
    messageInput.value = '';
    if (mentionsInput) mentionsInput.value = '';
    mentionsContainer.style.display = 'none';

    // Handle Reply
    const currentReply = replyingTo;
    cancelReply(); // Reset GUI

    const body = { to: selectedChat.id, message: text, client: selectedClient, api_key: currentApiKey };
    if (mentions.length > 0) body.mentions = mentions;
    if (currentReply) body.quotedMessageId = currentReply.id;

    try {
      const r = await fetch('/send?client=' + encodeURIComponent(selectedClient) + '&api_key=' + currentApiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j.success) {
        logEvent('Sent ' + j.id);
        // Optimistic UI: Append message to chat view
        appendMessageToChat({
          id: j.id || 'temp-' + Date.now(),
          from: 'Me', // Placeholder, creates "You" feel
          body: text,
          timestamp: Math.floor(Date.now() / 1000),
          chatId: selectedChat.id,
          hasMedia: false
        });

        // Optimistic UI: Move chat to top
        const chatIdx = chats.findIndex(c => c.id === selectedChat.id);
        if (chatIdx > -1) {
          const c = chats.splice(chatIdx, 1)[0];
          c.timestamp = Math.floor(Date.now() / 1000); // update sort time
          chats.unshift(c);
          renderChats();
        }
      }
      else {
        logEvent('Send error ' + JSON.stringify(j));
        alert('Failed to send: ' + (j.error || 'Unknown error'));
        messageInput.value = text; // Restore text on error
      }
    } catch (e) {
      logEvent('Send error ' + e.message);
      alert('Error sending: ' + e.message);
      messageInput.value = text; // Restore text on error
    }
  };

  // Expose setReply to window so it can be called from button onclicks
  window.prepareReply = function (msgId) {
    const msg = allMessages.find(m => m.id === msgId);
    if (msg) {
      setReply(msg);
    } else {
      // Fallback or try to find in chats if not in allMessages (though allMessages should have it)
      console.warn('Message not found for reply:', msgId);
    }
  };

  // message input history navigation
  messageInput.onkeydown = (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (messageHistoryIndex < messageHistory.length - 1) {
        messageHistoryIndex++;
        messageInput.value = messageHistory[messageHistory.length - 1 - messageHistoryIndex];
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (messageHistoryIndex > 0) {
        messageHistoryIndex--;
        messageInput.value = messageHistory[messageHistory.length - 1 - messageHistoryIndex];
      } else {
        messageHistoryIndex = -1;
        messageInput.value = '';
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      // Optional: Send on Enter
      e.preventDefault();
      sendBtn.click();
    }
  };

  prevMessagesBtn.onclick = () => loadMessages();
  nextMessagesBtn.onclick = () => loadMessages();

  // Message search functionality
  searchMessages.oninput = () => {
    const query = searchMessages.value.toLowerCase().trim();
    messagesEl.innerHTML = '';

    let filtered = allMessages;
    if (query) {
      filtered = allMessages.filter(m =>
        m.body.toLowerCase().includes(query) || m.from.toLowerCase().includes(query)
      );
    }

    messageSearchResult.textContent = query ? `Found ${filtered.length} of ${allMessages.length}` : '';

    filtered.forEach(m => {
      const d = document.createElement('div');
      const highlight = query && m.body.toLowerCase().includes(query);
      d.className = 'message-item' + (highlight ? ' highlight' : '');
      d.innerHTML = `
        <div class="time">${new Date((m.timestamp || 0) * 1000).toLocaleString()}</div>
        <div class="sender">${m.from}</div>
        <div class="body">${escapeHtml(m.body)}</div>
      `;
      messagesEl.appendChild(d);
    });
  };

  // Export messages functionality
  exportMessagesBtn.onclick = () => {
    if (!selectedChat || allMessages.length === 0) {
      return alert('No messages to export');
    }

    const format = prompt('Export format: json, csv, or txt?', 'json')?.toLowerCase().trim();
    if (!format) return;

    let content = '';
    let filename = `${selectedChat.name || selectedChat.id}_messages`;

    if (format === 'json') {
      content = JSON.stringify(allMessages, null, 2);
      filename += '.json';
    } else if (format === 'csv') {
      // CSV header
      content = 'timestamp,from,message\n';
      allMessages.forEach(m => {
        const time = new Date((m.timestamp || 0) * 1000).toLocaleString().replace(/"/g, '""');
        const from = (m.from || '').replace(/"/g, '""');
        const body = (m.body || '').replace(/"/g, '""').replace(/\n/g, ' ');
        content += `"${time}","${from}","${body}"\n`;
      });
      filename += '.csv';
    } else if (format === 'txt') {
      allMessages.forEach(m => {
        content += `[${new Date((m.timestamp || 0) * 1000).toLocaleString()}] ${m.from}: ${m.body}\n`;
      });
      filename += '.txt';
    } else {
      return alert('Invalid format. Use json, csv, or txt');
    }

    // download file
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    logEvent('Exported ' + allMessages.length + ' messages as ' + filename);
  };

  mediaFile.onchange = () => {
    if (mediaFile.files.length > 0) {
      const file = mediaFile.files[0];
      mediaInfo.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`;
    }
  };

  sendMediaBtn.onclick = async () => {
    if (!selectedChat) return alert('Select a chat first');
    if (!mediaFile.files.length) return alert('Select a file first');

    const file = mediaFile.files[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const base64 = e.target.result.split(',')[1];
      const body = {
        to: selectedChat.id,
        filename: file.name,
        mimetype: file.type,
        data: base64,
        client: selectedClient,
        api_key: currentApiKey
      };
      const r = await fetch('/send-media?client=' + encodeURIComponent(selectedClient) + '&api_key=' + currentApiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const j = await r.json();
      if (j.success) {
        logEvent('Media sent ' + j.id);
        mediaFile.value = '';
        mediaInfo.textContent = '';
      } else logEvent('Send error ' + JSON.stringify(j));
    };
    reader.readAsDataURL(file);
  };

  document.getElementById('addParticipants').onclick = () => groupAction('add');
  document.getElementById('removeParticipants').onclick = () => groupAction('remove');
  document.getElementById('promoteParticipants').onclick = () => groupAction('promote');
  document.getElementById('demoteParticipants').onclick = () => groupAction('demote');
  document.getElementById('loadParticipants').onclick = loadParticipants;

  async function groupAction(action) {
    if (!selectedChat) return alert('Select group');
    const raw = participantsInput.value.trim();
    if (!raw) return alert('Add participants (comma separated)');
    const participants = raw.split(',').map(s => s.trim()).filter(Boolean);
    const res = await fetch('/group/' + action + '?client=' + encodeURIComponent(selectedClient) + '&api_key=' + currentApiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupId: selectedChat.id, participants, client: selectedClient, api_key: currentApiKey }) });
    const j = await res.json();
    if (j.success) logEvent(action + ' ok'); else logEvent(action + ' error ' + JSON.stringify(j));
  }

  async function loadParticipants() {
    if (!selectedChat) return alert('Select group');
    const res = await fetch('/group/' + encodeURIComponent(selectedChat.id) + '/participants?client=' + encodeURIComponent(selectedClient) + '&api_key=' + currentApiKey);
    const j = await res.json();
    participantsList.textContent = JSON.stringify(j, null, 2);
  }

  copyApiKeyBtn.onclick = () => {
    if (currentApiKey) {
      navigator.clipboard.writeText(currentApiKey);
      logEvent('✓ API key copied to clipboard');
    } else {
      alert('No API Key available. Please select a client first.');
    }
  };

  generateApiKeyBtn.onclick = async () => {
    if (!selectedClient) {
      alert('Please select or create a client first');
      return;
    }
    if (confirm('Delete current client and create new one with fresh API key?')) {
      try {
        // Delete old client
        await fetch('/clients/' + encodeURIComponent(selectedClient), { method: 'DELETE' });

        // Create new client with same ID
        const res = await fetch('/clients', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: selectedClient })
        });
        const data = await res.json();
        if (data.success) {
          currentApiKey = data.apiKey;
          apiKeyDisplay.value = currentApiKey;
          logEvent('✓ New API Key generated for ' + selectedClient);
          loadClients();
        } else {
          alert('Error: ' + (data.error || 'Unknown error'));
        }
      } catch (e) {
        alert('Error: ' + e.message);
      }
    }
  };

  rotateApiKeyBtn && (rotateApiKeyBtn.onclick = async () => {
    if (!selectedClient) return alert('Select a client first');
    try {
      const res = await fetch('/clients/' + encodeURIComponent(selectedClient) + '/rotate-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current_api_key: currentApiKey }) });
      const j = await res.json();
      if (j.success && j.apiKey) {
        currentApiKey = j.apiKey;
        apiKeyDisplay.value = currentApiKey;
        logEvent('✓ API key rotated for ' + selectedClient);
        loadClients();
      } else {
        alert('Rotate failed: ' + JSON.stringify(j));
      }
    } catch (e) { alert('Error: ' + e.message); }
  });

  // Clients management
  async function loadClients() {
    try {
      const r = await fetch('/clients');
      if (!r.ok) throw new Error('Failed to fetch clients: ' + r.status);
      const j = await r.json();
      const list = j.clients || [];
      clientSelect.innerHTML = '';
      list.forEach(c => {
        const o = document.createElement('option');
        o.value = c.id;
        o.textContent = c.id + ' (' + c.status + ', ' + c.uptime + 'ms, ' + c.memoryUsage + ')';
        clientSelect.appendChild(o);
      });
      if (!list.find(x => x.id === selectedClient) && list.length) selectedClient = list[0].id;
      clientSelect.value = selectedClient;

      // update api key
      const selectedClientObj = list.find(x => x.id === selectedClient);
      if (selectedClientObj && selectedClientObj.apiKey) {
        currentApiKey = selectedClientObj.apiKey;
        apiKeyDisplay.value = currentApiKey;
      } else {
        currentApiKey = '';
        apiKeyDisplay.value = '';
        logEvent('⚠️ API Key not available for ' + selectedClient);
      }

      // update qr image: only show if status is 'qr', hide if ready/authenticated
      if (selectedClientObj && (selectedClientObj.status === 'ready' || selectedClientObj.status === 'authenticated')) {
        qrImg.style.display = 'none';
      } else if (selectedClientObj && selectedClientObj.status === 'qr') {
        qrImg.src = '/qr?client=' + encodeURIComponent(selectedClient) + '&ts=' + Date.now();
        qrImg.style.display = '';
      } else {
        // For other statuses (initializing, etc), try to load QR but don't show if not available
        qrImg.src = '/qr?client=' + encodeURIComponent(selectedClient) + '&ts=' + Date.now();
        qrImg.onerror = () => { qrImg.style.display = 'none'; };
      }
      loadChats();
    } catch (e) {
      console.error('Error loading clients:', e);
      logEvent('Error loading clients: ' + e.message);
      // Fallback: If network error, maybe show retry button?
      chatsEl.innerHTML = `<div style="padding:20px;text-align:center;color:red">Failed to load clients.<br>${e.message}<br><button onclick="location.reload()">Retry</button></div>`;
    }
  }

  addClientBtn.onclick = async () => {
    const id = prompt('New client id (leave empty for autogenerated)') || undefined;
    const body = id ? { id } : {};
    const r = await fetch('/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json();
    if (j.success) {
      logEvent('Client created ' + j.id + ' (API key: ' + j.apiKey + ')');
      // auto-select the newly created client for a smoother UX
      selectedClient = j.id;
      await loadClients();
      // reset current view for the new client
      selectedChat = null;
      chatTitle.textContent = '-';
      chatInfo.textContent = '';
      messagesEl.innerHTML = '';
      groupActions.style.display = 'none';
    }
    else alert('Error creating client: ' + JSON.stringify(j));
  };

  delClientBtn.onclick = async () => {
    const id = clientSelect.value;
    if (!id) return;
    if (!confirm('Delete client ' + id + ' ?')) return;
    const r = await fetch('/clients/' + encodeURIComponent(id), { method: 'DELETE' });
    const j = await r.json();
    if (j.success) { logEvent('Client deleted ' + id); selectedClient = 'default'; await loadClients(); }
    else alert('Error deleting client: ' + JSON.stringify(j));
  };

  clientSelect.onchange = async () => {
    const prevClient = selectedClient;
    selectedClient = clientSelect.value;

    // Skip if same client selected
    if (prevClient === selectedClient) return;

    // Save selected client to localStorage
    localStorage.setItem('lastSelectedClient', selectedClient);

    // Clear current chat and messages to reflect client change immediately
    selectedChat = null;
    chatTitle.textContent = '-';
    chatInfo.textContent = '';
    messagesEl.innerHTML = '';
    groupActions.style.display = 'none';
    // reset caches related to previous client
    allMessages = [];
    Object.keys(messageCache).forEach(k => delete messageCache[k]);

    // Show loading indicator
    chatsEl.innerHTML = '<div style="padding:20px;text-align:center;color:#666">Loading chats...</div>';

    // Reload clients to refresh API key, status, QR and chats
    await loadClients();
    // Try to restore last selected chat for this client
    try {
      const key = 'lastSelectedChatByClient';
      const map = JSON.parse(localStorage.getItem(key) || '{}');
      const lastId = map[selectedClient];
      if (lastId) {
        const found = chats.find(c => c.id === lastId);
        if (found) selectChat(found);
      }
    } catch { }
  };

  async function loadMessages() {
    if (!selectedChat) return;
    const res = await fetch('/chats/' + encodeURIComponent(selectedChat.id) + '/messages?client=' + encodeURIComponent(selectedClient) + '&api_key=' + currentApiKey);
    const j = await res.json();
    const msgs = j.messages || [];
    messagesEl.innerHTML = '';

    // populate cache and store for search
    const cacheKey = selectedChat.id;
    if (!messageCache[cacheKey]) messageCache[cacheKey] = new Set();
    allMessages = [];

    msgs.forEach(m => {
      const msgId = m.id || `${m.from}-${m.timestamp}`;
      messageCache[cacheKey].add(msgId);

      const msgData = { id: msgId, from: m.from, body: m.body, timestamp: m.timestamp };
      allMessages.push(msgData);

      // Determine direction
      const isOutgoing = m.from === 'outgoing' || m.from === 'Me' || (m.id && m.id.fromMe);

      // Profile Pic logic
      const avatarUrl = isOutgoing
        ? 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/340px-Default_pfp.svg.png'
        : (selectedChat.profilePicUrl || 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/340px-Default_pfp.svg.png');

      const row = document.createElement('div');
      row.className = `message-row ${isOutgoing ? 'outgoing' : 'incoming'}`;

      const d = document.createElement('div');
      d.className = `message-item ${isOutgoing ? 'outgoing' : 'incoming'}`;

      // Build media element if message has media
      let mediaHtml = '';
      if (m.hasMedia && m.mediaType) {
        const mediaUrl = `/media/${msgId}/download?client=${selectedClient}&api_key=${currentApiKey}`;
        const placeholderId = `media-placeholder-${msgId.replace(/[^a-zA-Z0-9]/g, '_')}`;

        // Detect media type from MIME type (m.mediaType is like "image/jpeg", "video/mp4", etc.)
        const mediaCategory = m.mediaType.split('/')[0]; // Extract "image", "video", "audio", etc.

        if (mediaCategory === 'image') {
          mediaHtml = `<div id="${placeholderId}" class="media-lazy" data-msg-id="${msgId}" data-media-type="image" style="margin:8px 0">
            <div style="width:200px;height:150px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed #ccc" onclick="loadMediaOnDemand('${msgId}', 'image', '${placeholderId}')">
              <span style="color:#999">🖼️ Click to load image</span>
            </div>
          </div>`;
        } else if (mediaCategory === 'video') {
          mediaHtml = `<div id="${placeholderId}" class="media-lazy" data-msg-id="${msgId}" data-media-type="video" style="margin:8px 0">
            <div style="width:200px;height:150px;background:#f0f0f0;border-radius:4px;display:flex;align-items:center;justify-content:center;cursor:pointer;border:2px dashed #ccc" onclick="loadMediaOnDemand('${msgId}', 'video', '${placeholderId}')">
              <span style="color:#999">🎥 Click to load video</span>
            </div>
          </div>`;
        } else if (mediaCategory === 'audio') {
          mediaHtml = `<div id="${placeholderId}" class="media-lazy" data-msg-id="${msgId}" data-media-type="audio" style="margin:8px 0">
            <div style="padding:12px;background:#f0f0f0;border-radius:4px;cursor:pointer;border:2px dashed #ccc;max-width:300px" onclick="loadMediaOnDemand('${msgId}', 'audio', '${placeholderId}')">
              <span style="color:#999">🔊 Click to load audio</span>
            </div>
          </div>`;
        } else if (mediaCategory === 'application' || m.mediaType.includes('document')) {
          mediaHtml = `<div style="margin:8px 0;padding:8px;background:#f0f0f0;border-radius:4px"><a href="${mediaUrl}" download style="color:#007bff;text-decoration:underline">📎 Download Document</a></div>`;
        }

        // Don't auto-load media, wait for scroll-based lazy loading
      }

      // Handle location messages
      let locationHtml = '';
      if (m.isLocation) {
        locationHtml = `<div style="margin:8px 0;padding:8px;background:#e3f2fd;border-radius:4px">📍 Location</div>`;
      }

      // Handle contact cards
      let contactHtml = '';
      if (m.isContact) {
        contactHtml = `<div style="margin:8px 0;padding:8px;background:#f3e5f5;border-radius:4px">👤 Contact Card</div>`;
      }

      // Handle stickers
      let stickerHtml = '';
      if (m.isSticker && m.hasMedia) {
        const mediaUrl = `/media/${msgId}/download?client=${selectedClient}&api_key=${currentApiKey}`;
        stickerHtml = `<img src="${mediaUrl}" style="max-width:100px;max-height:100px;margin:8px 0" onerror="this.style.display='none'">`;
      }

      d.innerHTML = `
        <div class="sender">${m.from}</div>
        ${mediaHtml}
        ${locationHtml}
        ${contactHtml}
        ${stickerHtml}
        <div class="body">${escapeHtml(m.body || '')}</div>
        <div class="time">${new Date((m.timestamp || 0) * 1000).toLocaleString()}</div>
        <button class="reply-btn" onclick="prepareReply('${msgId}')" style="display:none;font-size:12px;margin-top:4px;padding:2px 8px;cursor:pointer;margin-left:5px">↩ Reply</button>
      `;

      // Construct DOM with Avatar
      const av = document.createElement('img');
      av.className = 'msg-avatar';
      av.src = avatarUrl;
      av.onerror = function () { this.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2c/Default_pfp.svg/340px-Default_pfp.svg.png' };

      if (isOutgoing) {
        row.appendChild(d);
        row.appendChild(av);
      } else {
        row.appendChild(av);
        row.appendChild(d);
      }

      messagesEl.appendChild(row);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;

    // Start observing media placeholders for scroll-based lazy loading
    setTimeout(() => observeMediaPlaceholders(), 100);
  }

  refreshBtn.onclick = () => {
    loadChats();
    loadMessages();
  };

  // Chat search
  searchChats.oninput = () => renderChats();

  // Load message history from localStorage
  const saved = localStorage.getItem('messageHistory');
  if (saved) {
    try { messageHistory.push(...JSON.parse(saved)); } catch (e) { }
  }

  // Group Actions: Mention All
  const loadPartBtn = document.getElementById('loadParticipants');
  if (loadPartBtn) {
    const mentionAllBtn = document.createElement('button');
    mentionAllBtn.innerHTML = '<i class="fas fa-at"></i> Mention All';
    mentionAllBtn.style.cssText = 'width:100%;margin-bottom:5px;background-color:#00a884;color:#fff';
    loadPartBtn.parentNode.insertBefore(mentionAllBtn, loadPartBtn);

    mentionAllBtn.onclick = async () => {
      if (!selectedChat || !selectedChat.isGroup) return alert('Not a group chat');
      try {
        const r = await fetch(`/group/${encodeURIComponent(selectedChat.id)}/participants?client=${encodeURIComponent(selectedClient)}&api_key=${currentApiKey}`);
        const j = await r.json();
        if (j.error) return alert(j.error);

        const parts = j.participants || [];
        // Construct mention string: @user1 @user2 ...
        // We use the ID (without @c.us) to make it cleaner if possible, or usually just @number
        const mentionText = parts.map(p => '@' + p.id.split('@')[0]).join(' ');

        messageInput.value = (messageInput.value ? messageInput.value + ' ' : '') + mentionText;
        messageInput.focus();
        // Trigger input event to update mentions UI if needed (though we just filled it)
      } catch (e) {
        alert('Error fetching participants: ' + e.message);
      }
    };
  }

  // init
  initMediaObserver(); // Initialize Intersection Observer for media lazy loading
  connectSse();
  await loadClients(); // This will handle QR display based on client status
  // After initial load, restore last selected chat for current client if present
  try {
    const key = 'lastSelectedChatByClient';
    const map = JSON.parse(localStorage.getItem(key) || '{}');
    const lastId = map[selectedClient];
    if (lastId) {
      const found = chats.find(c => c.id === lastId);
      if (found) selectChat(found);
    }
  } catch { }
  // loadChats already called from loadClients
})();
