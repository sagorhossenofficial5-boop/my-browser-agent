const fs = require('fs');

const RUNNER_URL = 'http://localhost:3000/agent-step';
const GEMINI_API_KEY = 'AQ.Ab8RN6JiYnPKKXSplihwmiSmfIgFbPlqNxy7mZOECj2FsuBn2A';

const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'));

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

async function askVisionWithRetry(prompt, cleanBase64, retries = 3) {
  const models = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-3.5-flash'];
  for (const m of models) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: 'image/png', data: cleanBase64 } }
              ]
            }]
          })
        });
        const data = await res.json();
        if (data.error && data.error.code === 503) {
          console.log(`⚠️ ${m} server busy (503). Retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }
        if (!data.candidates) throw new Error(JSON.stringify(data));
        const raw = data.candidates[0].content.parts[0].text.replace(/```json|```/gi, '').trim();
        return JSON.parse(raw);
      } catch (err) {
        if (attempt === retries) break;
      }
    }
  }
  throw new Error('All vision models currently busy. Please retry in a few seconds.');
}

async function loginToTarget(url) {
  console.log(`\n🚀 [NAVIGATING TO SITE]: ${url}`);
  let state = await step('navigate', { url });
  await step('wait', { duration: 2500 });

  for (let s = 1; s <= 6; s++) {
    console.log(`\n🔍 [Step ${s}] Vision AI inspecting page...`);
    const clean = state.screenshot.replace(/^data:image\/[a-z]+;base64,/, '');
    const prompt = `You are an automated login agent on ${url}.
Credentials:
Email: "${credentials.email}"
Password: "${credentials.password}"

Inspect screenshot:
1. If email field is empty, return action to type email.
2. If password field is visible/empty, return action to type password.
3. If filled, return action to click submit/sign in button.
4. If logged in (home/dashboard), return action "done".

Return raw JSON only:
{"thought":"...","action":"type"|"click"|"wait"|"done","params":{"selector":"CSS selector","text":"text to type","duration":2000}}`;

    const decision = await askVisionWithRetry(prompt, clean);
    console.log('💡 [Thought]:', decision.thought);
    console.log('🎯 [Action]:', decision.action, decision.params || '');

    if (decision.action === 'done') {
      console.log('\n🎉 [SUCCESS]: Logged in successfully!');
      return;
    }

    state = await step(decision.action, decision.params);
    await step('wait', { duration: 2000 });
  }
}

loginToTarget('https://github.com/login').catch(e => console.error('Login Agent Error:', e.message));
