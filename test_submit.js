const fs = require('fs');

async function checkLogin() {
  const r1 = await fetch('http://localhost:3000/agent-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'wait', params: { duration: 5000 } })
  });
  const data1 = await r1.json();
  
  if (data1.screenshot) {
    const base64Data = data1.screenshot.replace(/^data:image\/png;base64,/, "");
    fs.writeFileSync("login_result.png", base64Data, 'base64');
    console.log("Current page screenshot saved as: login_result.png");
  }
}
checkLogin();
