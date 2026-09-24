const RUNNER_URL = 'http://localhost:3000/agent-step';
const API_KEY = 'AQ.Ab8RN6JiYnPKKXSplihwmiSmfIgFbPlqNxy7mZOECj2FsuBn2A';

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

async function run() {
  console.log('1. Google browse kora hocche...');
  const nav = await step('navigate', { url: 'https://www.google.com' });
  console.log('Done: Google open!');

  console.log('2. Search query type kora hocche...');
  const typed = await step('type', { selector: 'textarea[name="q"]', text: 'OpenAI\n' });
  console.log('Done:', typed.log);

  console.log('3. Result er jonno 3s wait kora hocche...');
  const wait = await step('wait', { duration: 3000 });
  console.log('Done:', wait.log);
  console.log('Final screenshot length:', wait.screenshot.length);
  console.log('SUCCESS: Full browser action loop executed perfectly!');
}

run().catch(e => console.error('Loop Error:', e.message));
