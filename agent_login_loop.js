const fs = require('fs');

const RUNNER_URL = 'http://localhost:3000/agent-step';
const GEMINI_API_KEY = 'AQ.Ab8RN6JiYnPKKXSplihwmiSmfIgFbPlqNxy7mZOECj2FsuBn2A';

async function step(action, params) {
  const r = await fetch(RUNNER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params })
  });
  const data = await r.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

async function askVisionForLogin(siteUrl, email, password, screenshotBase64) {
  const clean = screenshotBase64.replace(/^data:image\/[a-z]+;base64,/, '');
  const prompt = `You are an autonomous browser agent on ${siteUrl}.
User wants to login with:
Email/Username: "${email}"
Password: "${password}"

Inspect the screenshot:
1. Find the input field for email/username, or the login/sign-in button if not on login page yet.
2. If email & password fields are visible, return the action to fill them or click submit.
3. If already logged in, return action: "done".

Return strictly raw JSON (no formatting):
{
  "thought": "what you see on screen",
  "action": "type" | "click" | "wait" | "done",
  "params": {
    "selector": "CSS selector to interact with",
    "text": "text to type if action is type",
    "duration": 2000
  }
}`;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/png', data: clean } }
        ]
      }]
    })
  });

  const data = await res.json();
  if (!data.candidates) throw new Error(JSON.stringify(data));
  const raw = data.candidates[0].content.parts[0].text.replace(/```json|```/gi, '').trim();
  return JSON.parse(raw);
}

async function autoLoginToSite(siteUrl, email, password) {
  console.log(`\n🚀 [NAVIGATING]: ${siteUrl}`);
  let currentState = await step('navigate', { url: siteUrl });
  await step('wait', { duration: 3000 });

  for (let i = 1; i <= 6; i++) {
    console.log(`\n🔍 [Step ${i}] Vision AI analyzing page for login...`);
    const decision = await askVisionForLogin(siteUrl, email, password, currentState.screenshot);
    console.log('💡 [AI Thought]:', decision.thought);
    console.log('🎯 [Action]:', decision.action, decision.params || '');

    if (decision.action === 'done') {
      console.log('\n🎉 [SUCCESS]: Logged in successfully or login screen submitted!');
      return;
    }

    currentState = await step(decision.action, decision.params);
    await step('wait', { duration: 2000 });
  }
}

const targetUrl = process.argv[2] || 'https://github.com/login';
const userEmail = process.argv[3] || 'testuser@example.com';
const userPass = process.argv[4] || 'SecretPassword123';

autoLoginToSite(targetUrl, userEmail, userPass).catch(err => console.error('Error:', err.message));
