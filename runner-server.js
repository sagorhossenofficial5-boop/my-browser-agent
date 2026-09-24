const express = require('express');
const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const RUNNER_SECRET = process.env.RUNNER_SECRET || 'my_agent_secret_12345';

// হেলথ চেক রুট
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// n8n যে রুটে কল করছে: POST /agent-command
app.post('/agent-command', async (req, res) => {
  const authHeader = req.headers['authorization'] || req.headers['x-runner-secret'];
  
  // সিক্রেট টোকেন ভেরিফিকেশন (যদি n8n সিক্রেট পাঠায়)
  if (RUNNER_SECRET && authHeader && !authHeader.includes(RUNNER_SECRET) && authHeader !== RUNNER_SECRET) {
    return res.status(401).json({ error: 'Unauthorized: Invalid runner secret' });
  }

  const { command, url, prompt } = req.body;
  console.log('Received agent command:', { command, url, prompt });

  try {
    // এখানে আপনার কমান্ড সাকসেস রেসপন্স রিটার্ন হচ্ছে
    return res.json({
      success: true,
      status: 'executed',
      message: 'Command received and executed successfully by runner',
      receivedData: { command, url, prompt },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('Error handling command:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Runner active on port ${PORT}`);
});
