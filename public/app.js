const enableButton = document.getElementById('enable');
const sendButton = document.getElementById('send');
const statusLabel = document.getElementById('status');
const messageInput = document.getElementById('message');
const imageSource = document.getElementById('imageSource');
const customUrlWrap = document.getElementById('customUrlWrap');
const customImageUrl = document.getElementById('customImageUrl');
const uploadWrap = document.getElementById('uploadWrap');
const uploadImage = document.getElementById('uploadImage');
const imagePreviewWrap = document.getElementById('imagePreviewWrap');
const imagePreview = document.getElementById('imagePreview');
const inbox = document.getElementById('inbox');

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

function addMessageToInbox(payload) {
  const li = document.createElement('li');
  li.className = 'inbox-item';
  li.innerHTML = `<div>${payload.body}</div><div class="time">${new Date(payload.sentAt || Date.now()).toLocaleTimeString()}</div>`;

  if (payload.imageUrl) {
    const img = document.createElement('img');
    img.src = payload.imageUrl;
    img.alt = 'Notification image';
    li.append(img);
  }

  inbox.prepend(li);
}

async function resolveImagePayload() {
  const selected = imageSource.value;

  if (selected === 'none') {
    return { imageUrl: '', useRandomPath: false };
  }

  if (selected === 'custom') {
    const value = customImageUrl.value.trim();
    if (!value) {
      return { imageUrl: '', useRandomPath: false };
    }
    if (!isValidHttpUrl(value)) {
      throw new Error('Custom URL must be a valid http/https URL.');
    }
    return { imageUrl: value, useRandomPath: false };
  }

  if (selected === 'upload') {
    const file = uploadImage.files && uploadImage.files[0];
    if (!file) {
      return { imageUrl: '', useRandomPath: false };
    }
    if (!file.type.startsWith('image/')) {
      throw new Error('Please upload an image file.');
    }
    return { imageUrl: await fileToDataUrl(file), useRandomPath: false };
  }

  if (selected === 'random') {
    return { imageUrl: '', useRandomPath: true };
  }

  return { imageUrl: '', useRandomPath: false };
}

async function updatePreview() {
  try {
    const selected = imageSource.value;
    if (selected === 'random') {
      imagePreviewWrap.style.display = 'none';
      imagePreview.removeAttribute('src');
      return;
    }

    const payload = await resolveImagePayload();
    if (!payload.imageUrl) {
      imagePreviewWrap.style.display = 'none';
      imagePreview.removeAttribute('src');
      return;
    }

    imagePreview.src = payload.imageUrl;
    imagePreviewWrap.style.display = 'block';
  } catch (_error) {
    imagePreviewWrap.style.display = 'none';
    imagePreview.removeAttribute('src');
  }
}

function refreshImageInputs() {
  const selected = imageSource.value;
  customUrlWrap.style.display = selected === 'custom' ? 'grid' : 'none';
  uploadWrap.style.display = selected === 'upload' ? 'grid' : 'none';
  updatePreview();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from(rawData, (char) => char.charCodeAt(0));
}

async function subscribeForPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    statusLabel.textContent = 'Push not supported in this browser.';
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    statusLabel.textContent = 'Notifications permission denied.';
    return;
  }

  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const keyResponse = await fetch('/vapidPublicKey');
  const { publicKey } = await keyResponse.json();

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await fetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(subscription),
  });

  statusLabel.textContent = 'Subscribed ✅';
}

async function sendMessage() {
  const message = messageInput.value.trim();
  if (!message) {
    return;
  }

  try {
    const { imageUrl, useRandomPath } = await resolveImagePayload();
    const response = await fetch('/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, imageUrl, useRandomPath }),
    });

    if (!response.ok) {
      addMessageToInbox({ body: 'Failed to send notification.' });
    }
  } catch (error) {
    addMessageToInbox({ body: error.message || 'Failed to prepare image.' });
  }
}

enableButton.addEventListener('click', subscribeForPush);
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});
imageSource.addEventListener('change', refreshImageInputs);
customImageUrl.addEventListener('input', updatePreview);
uploadImage.addEventListener('change', updatePreview);

navigator.serviceWorker.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'PUSH_MESSAGE') {
    addMessageToInbox(event.data.payload);
  }
});

refreshImageInputs();
