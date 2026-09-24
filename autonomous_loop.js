async function step(action, params) {
  const res = await fetch('http://localhost:3000/agent-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, params })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error);
  return data;
}

async function run() {
  console.log("1. Navigating...");
  const n = await step('navigate', { url: 'https://www.google.com' });
  console.log("Done:", n.log);

  console.log("2. Waiting 2s...");
  const w = await step('wait', { duration: 2000 });
  console.log("Done:", w.log);

  console.log("3. Screenshot size:", w.screenshot.length);
}

run().catch(e => console.error("Caught Error:", e.message));
