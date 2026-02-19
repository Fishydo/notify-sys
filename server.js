const express = require('express');
const path = require('path');
const webPush = require('web-push');

const app = express();
const port = process.env.PORT || 3000;

const vapidKeys = webPush.generateVAPIDKeys();
webPush.setVapidDetails(
  'mailto:admin@example.com',
  vapidKeys.publicKey,
  vapidKeys.privateKey,
);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const subscriptions = new Map();


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

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Message is required.' });
  }

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
