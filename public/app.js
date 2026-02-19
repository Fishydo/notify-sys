const enableButton = document.getElementById('enable');
const sendButton = document.getElementById('send');
const statusLabel = document.getElementById('status');
const messageInput = document.getElementById('message');

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

}

enableButton.addEventListener('click', subscribeForPush);
sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    sendMessage();
  }
});
