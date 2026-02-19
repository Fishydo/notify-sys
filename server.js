const express = require('express');
const path = require('path');
const crypto = require('crypto');
const webPush = require('web-push');

const app = express();
const port = process.env.PORT || 3000;

const HEALTHCHECK_URL = 'https://notify-sys.onrender.com';
const HEALTHCHECK_INTERVAL_MS = 60 * 1000;
const TEMP_MEDIA_TTL_MS = 2 * 60 * 1000;

const vapidKeys = webPush.generateVAPIDKeys();
webPush.setVapidDetails('mailto:admin@example.com', vapidKeys.publicKey, vapidKeys.privateKey);

app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const subscriptions = new Map();
const tempMedia = new Map();

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_error) {
    return false;
  }
}

function parseImageDataUrl(dataUrl) {
  const match = /^data:(image\/[\w.+-]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) {
    return null;
  }

  const contentType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], 'base64');
  return { contentType, buffer };
}

function createTempPath(req, mediaEntry) {
  const token = crypto.randomBytes(6).toString('hex');
  const pathToken = `/${token}/`;

  const timeoutId = setTimeout(() => {
    tempMedia.delete(token);
  }, TEMP_MEDIA_TTL_MS);

  tempMedia.set(token, { ...mediaEntry, timeoutId });
  return `${req.protocol}://${req.get('host')}${pathToken}`;
}

function randomSeedImageUrl() {
  return `https://picsum.photos/seed/${crypto.randomBytes(5).toString('hex')}/1200/700`;
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
  const { message, imageUrl, useRandomPath } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

  let finalImageUrl = '';
  const hasImage = typeof imageUrl === 'string' && imageUrl.length > 0;

  if (useRandomPath) {
    finalImageUrl = createTempPath(req, {
      type: 'redirect',
      target: randomSeedImageUrl(),
    });
  } else if (hasImage && isValidHttpUrl(imageUrl)) {
    finalImageUrl = createTempPath(req, {
      type: 'redirect',
      target: imageUrl,
    });
  } else if (hasImage && imageUrl.startsWith('data:image/')) {
    if (imageUrl.length > 2_000_000) {
      return res.status(400).json({ error: 'Uploaded image is too large.' });
    }

    const parsed = parseImageDataUrl(imageUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid uploaded image format.' });
    }

    finalImageUrl = createTempPath(req, {
      type: 'binary',
      contentType: parsed.contentType,
      buffer: parsed.buffer,
    });
  } else if (hasImage) {
    return res.status(400).json({ error: 'Image must be a valid URL or uploaded image.' });
  }

  const payload = JSON.stringify({
    title: 'New shared message',
    body: message.trim(),
    imageUrl: finalImageUrl,
    sentAt: new Date().toISOString(),
  });

  const subscriptionList = [...subscriptions.values()];
  const results = await Promise.allSettled(subscriptionList.map((s) => webPush.sendNotification(s, payload)));

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

  return res.json({ delivered, failed, totalSubscribers: subscriptions.size, imageUrl: finalImageUrl });
});

app.get('/:token/', (req, res, next) => {
  const token = req.params.token;
  const media = tempMedia.get(token);

  if (!media) {
    return next();
  }

  clearTimeout(media.timeoutId);
  tempMedia.delete(token);

  if (media.type === 'redirect') {
    return res.redirect(media.target);
  }

  res.setHeader('Content-Type', media.contentType);
  return res.send(media.buffer);
});

app.listen(port, () => {
  console.log(`Notification app running at http://localhost:${port}`);
});

pingHealthcheck();
setInterval(pingHealthcheck, HEALTHCHECK_INTERVAL_MS);
