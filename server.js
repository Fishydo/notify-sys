const express = require('express');
const path = require('path');
const webPush = require('web-push');

const app = express();
const port = process.env.PORT || 3000;

const HEALTHCHECK_URL = 'https://notify-sys.onrender.com';
const HEALTHCHECK_INTERVAL_MS = 60 * 1000;

const vapidKeys = webPush.generateVAPIDKeys();
webPush.setVapidDetails(
  'mailto:admin@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const subscriptions = new Map();

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function isValidImageDataUrl(value) {
  return typeof value === 'string' && value.startsWith('data:image/');
}

async function pingHealthcheck() {
  try {
    const response = await fetch(HEALTHCHECK_URL, { method: 'GET' });
    console.log(`[healthcheck] pinged ${HEALTHCHECK_URL} (${response.status})`);
  } catch (error) {
    console.error(`[healthcheck] ping failed: ${error.message}`);
  }
}

app.get('/vapidPublicKey', (_req, res) => {
  res.json({ publicKey: vapidKeys.publicKey });
});

app.post('/subscribe', (req, res) => {
  const subscription = req.body;

  if (!subscription || !subscription.endpoint) {
    return res.status(400).json({ error: 'Invalid subscription payload.' });
  }

  subscriptions.set(subscription.endpoint, subscription);
  return res.status(201).json({ success: true, totalSubscribers: subscriptions.size });
});

app.post('/notify', async (req, res) => {
  const { message, imageUrl } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  const hasImage = typeof imageUrl === 'string' && imageUrl.length > 0;
  const validHttpImage = hasImage && isValidHttpUrl(imageUrl);
  const validDataImage = hasImage && isValidImageDataUrl(imageUrl);

  if (hasImage && !validHttpImage && !validDataImage) {
    return res.status(400).json({ error: 'Image must be a valid http/https URL or uploaded image.' });
  }

  if (validDataImage && imageUrl.length > 2_000_000) {
    return res.status(400).json({ error: 'Uploaded image is too large.' });
  }

  const payload = JSON.stringify({
    title: 'New shared message',
    body: message.trim(),
    imageUrl: imageUrl || '',
    sentAt: new Date().toISOString(),
  });

  const subscriptionList = [...subscriptions.values()];
  const results = await Promise.allSettled(
    subscriptionList.map((subscription) => webPush.sendNotification(subscription, payload)),
  );

  let delivered = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      delivered += 1;
      return;
    }

    failed += 1;
    const statusCode = result.reason && result.reason.statusCode;
    if (statusCode === 404 || statusCode === 410) {
      subscriptions.delete(subscriptionList[index].endpoint);
    }
  });

  return res.json({ delivered, failed, totalSubscribers: subscriptions.size });
});

app.listen(port, () => {
  console.log(`Notification app running at http://localhost:${port}`);
});

pingHealthcheck();
setInterval(pingHealthcheck, HEALTHCHECK_INTERVAL_MS);
