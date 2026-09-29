const express = require('express');
const puppeteer = require('puppeteer');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.PORT || 3000);
const RUNNER_SECRET = process.env.RUNNER_SECRET || '';
const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://127.0.0.1:${PORT}`;

let agentBrowser = null;
let agentPage = null;
let browserLock = Promise.resolve();

function authorized(req) {
  if (!RUNNER_SECRET) return true;
  return (req.headers['x-runner-secret'] || '') === RUNNER_SECRET;
}

async function withBrowserLock(fn) {
  const previous = browserLock;
  let release;
  browserLock = new Promise(resolve => { release = resolve; });
  await previous.catch(() => {});
  try { return await fn(); } finally { release(); }
}

async function ensureAgentBrowser(url) {
  if (!agentBrowser || !agentBrowser.connected || !agentPage || agentPage.isClosed()) {
    const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath();
    agentBrowser = await puppeteer.launch({
      headless: 'new',
      executablePath: chromePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--no-first-run',
        '--no-default-browser-check'
      ],
      timeout: 60000
    });
    agentPage = await agentBrowser.newPage();
    await agentPage.setViewport({ width: 1280, height: 800 });
    agentBrowser.on('disconnected', () => { agentBrowser = null; agentPage = null; });

    // Always start on a real page so /live and /snapshot are never blank.
    await agentPage.goto('https://google.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
  }

  if (url) {
    await agentPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  }
  return agentPage;
}

async function getLiveFrame() {
  return withBrowserLock(async () => {
    const page = await ensureAgentBrowser();
    const shot = await page.screenshot({ type: 'jpeg', quality: 60 });
    return { shot, url: page.url(), title: await page.title().catch(() => '') };
  });
}

const LIVE_HTML = `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser Agent Live</title>
<style>
body{margin:0;background:#111;color:#eee;font-family:system-ui,sans-serif}
.bar{padding:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#181818;position:sticky;top:0;z-index:2}
.pill{padding:6px 10px;border-radius:999px;background:#292929;max-width:45vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ok{color:#65e08a}.frame{display:block;width:min(1280px,100%);height:auto;margin:0 auto;background:#000;min-height:300px;object-fit:contain}
input{flex:1;min-width:220px;padding:9px;border-radius:6px;border:1px solid #444;background:#222;color:#fff}
button{padding:9px 14px;border:0;border-radius:6px;cursor:pointer}.wrap{max-width:1280px;margin:auto}.hint{padding:8px 12px;color:#aaa;font-size:13px}
</style>
</head>
<body>
<div class="bar">
<b>🤖 Browser Agent Live</b>
<span id="status" class="pill ok">Connecting…</span>
<span id="url" class="pill">Loading…</span>
<form id="goto" style="display:flex;gap:6px;flex:1"><input id="target" placeholder="https://example.com"><button>Go</button></form>
<button id="shot">📸 Open Snapshot</button>
</div>
<div class="wrap"><img id="screen" class="frame" alt="Live browser snapshot"><div class="hint">Render-hosted browser view. The image refreshes automatically every second.</div></div>
<script>
const screen=document.getElementById('screen');
const status=document.getElementById('status');
const url=document.getElementById('url');
async function refresh(){
  try{
    screen.src='/snapshot?t='+Date.now();
    const r=await fetch('/browser-status?t='+Date.now(),{cache:'no-store'});
    const d=await r.json();
    url.textContent=d.url||'Starting browser…';
    status.textContent=d.ready?'🟢 Live':'🟠 Starting…';
  }catch(e){status.textContent='🟠 Reconnecting…';}
}
refresh();
setInterval(refresh,1000);
document.getElementById('goto').onsubmit=async e=>{
  e.preventDefault();
  const target=document.getElementById('target').value.trim();
  if(!/^https?:\\/\\//i.test(target))return alert('Enter a full http(s) URL');
  const r=await fetch('/live/goto',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:target})});
  const d=await r.json();
  if(!d.success)alert(d.error||'Navigation failed');
  else refresh();
};
document.getElementById('shot').onclick=()=>window.open('/snapshot?t='+Date.now(),'_blank');
</script>
</body>
</html>`;

app.get('/', (req, res) => res.redirect('/live'));
app.get('/live', (req, res) => res.type('html').send(LIVE_HTML));
app.get('/health', (req, res) => res.status(200).send('Bot & Agent are running 24/7'));

app.get('/snapshot', async (req, res) => {
  try {
    const frame = await getLiveFrame();
    res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate', 'Pragma': 'no-cache', 'Expires': '0' });
    res.send(frame.shot);
  } catch (err) {
    res.status(500).type('text').send(`Snapshot failed: ${err.message}`);
  }
});

app.get('/browser-status', async (req, res) => {
  try {
    const page = await withBrowserLock(() => ensureAgentBrowser());
    res.set('Cache-Control', 'no-store');
    res.json({ ready: true, url: page.url(), title: await page.title().catch(() => '') });
  } catch (err) {
    res.status(500).json({ ready: false, error: err.message });
  }
});

app.post('/live/goto', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ success:false, error:'Unauthorized' });
  const { url } = req.body || {};
  if (!/^https?:\/\//i.test(String(url || ''))) return res.status(400).json({success:false,error:'A full http(s) URL is required'});
  try {
    const page = await withBrowserLock(() => ensureAgentBrowser(url));
    res.json({success:true,url:page.url(),title:await page.title().catch(()=> '')});
  } catch (e) { res.status(500).json({success:false,error:e.message}); }
});

app.post('/agent-command', async (req, res) => {
  if (!authorized(req)) return res.status(401).json({ success:false, error:'Unauthorized: Invalid runner secret' });
  try {
    const result = await withBrowserLock(async () => {
      const body = req.body || {};
      const page = await ensureAgentBrowser(body.url || (body.command && body.command.startsWith('http') ? body.command : undefined));
      const logs = [`[${new Date().toISOString()}] Current URL: ${page.url()}`];
      for (const act of (Array.isArray(body.actions) ? body.actions : [])) {
        const type = act.type || act.action;
        logs.push(`[${new Date().toISOString()}] Executing action: ${type}`);
        if (type === 'click' && act.selector) { await page.waitForSelector(act.selector,{timeout:10000}); await page.click(act.selector); }
        else if (type === 'type' && act.selector && act.text != null) { await page.waitForSelector(act.selector,{timeout:10000}); await page.click(act.selector); await page.type(act.selector,String(act.text)); }
        else if (type === 'wait') await new Promise(r=>setTimeout(r,Number(act.duration||act.ms||3000)));
      }
      if (body.prompt) await page.evaluate(text=>{const el=document.querySelector('textarea,input[type="text"]');if(el){el.focus();el.value=text;el.dispatchEvent(new Event('input',{bubbles:true}));}},body.prompt);
      const shot=await page.screenshot({type:'png'}); logs.push(`[${new Date().toISOString()}] Screenshot captured successfully`);
      return {execution_logs:logs,screenshot:`data:image/png;base64,${shot.toString('base64')}`};
    });
    res.json({success:true,status:'executed',message:'Actions completed successfully',...result});
  } catch(err) { res.status(500).json({success:false,status:'failed',error:err.message,execution_logs:[`[${new Date().toISOString()}] Execution error: ${err.message}`]}); }
});

async function startTelegramBot(token) {
  if (!token) { console.log('No TELEGRAM_BOT_TOKEN provided, skipping bot start.'); return; }
  console.log('🤖 Starting native Telegram bot polling...');
  let offset=0;

  async function telegramRequest(method, body) {
    const res=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.ok) throw new Error(data.description||`Telegram API ${method} failed (${res.status})`);
    return data;
  }

  async function sendMessage(chatId,text) {
    try{await telegramRequest('sendMessage',{chat_id:chatId,text});}
    catch(e){console.error('Failed to send telegram message:',e.message);}
  }

  async function sendPhoto(chatId,buffer,caption='') {
    try{
      const form=new FormData();
      form.append('chat_id',String(chatId));
      if(caption)form.append('caption',caption);
      form.append('photo',new Blob([buffer],{type:'image/jpeg'}),'browser.jpg');
      const res=await fetch(`https://api.telegram.org/bot${token}/sendPhoto`,{method:'POST',body:form});
      const data=await res.json().catch(()=>({}));
      if(!res.ok||!data.ok)throw new Error(data.description||`Telegram sendPhoto failed (${res.status})`);
    }catch(e){console.error('Failed to send telegram photo:',e.message);}
  }

  // Remove any webhook/pending-update state before getUpdates polling starts.
  try {
    await telegramRequest('deleteWebhook', { drop_pending_updates: true });
    console.log('🤖 Telegram webhook cleared; native polling can start.');
  } catch (e) {
    console.error('Telegram deleteWebhook error:', e.message);
  }

  async function handleMessage(msg) {
    if(!msg||!msg.text)return;
    const original=msg.text.trim();
    const text=original.toLowerCase();
    const chatId=msg.chat.id;

    if(text==='screen'||text==='/screen'){
      await sendMessage(chatId,'📸 Taking live browser screenshot...');
      try{const r=await getLiveFrame();await sendPhoto(chatId,r.shot,`📸 ${r.url}`);}
      catch(e){await sendMessage(chatId,`❌ Screenshot failed: ${e.message}`);}
      return;
    }

    if(text.startsWith('goto ')||text.startsWith('/goto ')){
      const target=original.replace(/^\/?goto\s+/i,'').trim();
      if(!/^https?:\/\//i.test(target)){await sendMessage(chatId,'❌ Use: /goto https://example.com');return;}
      try{
        const r=await withBrowserLock(async()=>{const p=await ensureAgentBrowser(target);return{url:p.url(),shot:await p.screenshot({type:'jpeg',quality:60})};});
        await sendMessage(chatId,`🌐 Navigated to: ${r.url}`);
        await sendPhoto(chatId,r.shot,'🌐 Current browser page');
      }catch(e){await sendMessage(chatId,`❌ Navigation failed: ${e.message}`);}
      return;
    }

    if(text==='login'||text==='/login'){
      await sendMessage(chatId,'🔐 Login automation is not wired into this native bot yet. Use the controlled browser-agent workflow for authenticated actions.');
      return;
    }

    if(text.startsWith('/start')||text==='start'||text==='hi'||text==='hello') await sendMessage(chatId,'🤖 Agent online. Commands: /screen, /goto <url>, /status');
    else if(text.startsWith('/status')||text==='status'||text.startsWith('/health')||text==='health') await sendMessage(chatId,'✅ Render agent operational. Live browser: /live');
    else await sendMessage(chatId,`Received: "${original}". Try /screen, /goto https://example.com, /status.`);
  }

  async function poll(){
    try{
      const res=await fetch(`https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=30`);
      const data=await res.json().catch(()=>({}));
      if(data.ok&&Array.isArray(data.result)){
        for(const update of data.result){offset=update.update_id+1;await handleMessage(update.message);}
      }else if(!data.ok){
        const description=data.description||'Unknown Telegram API error';
        console.error('Telegram API polling error:',description);
        if(/conflict/i.test(description)){
          console.error('Telegram 409 Conflict detected; waiting 10 seconds before retrying.');
          await new Promise(r=>setTimeout(r,10000));
        }
      }
    }catch(e){
      console.error('Telegram polling error:',e.message);
      if(/conflict/i.test(e.message)) await new Promise(r=>setTimeout(r,10000));
      else await new Promise(r=>setTimeout(r,5000));
    }
    setImmediate(poll);
  }

  poll();
  console.log('🤖 Telegram Bot successfully initialized and polling for messages!');
}

function startBackgroundWorker(){
  const intervalMs=Number(process.env.WORKER_INTERVAL_MS||300000);
  setInterval(async()=>{try{const response=await fetch(`${SELF_URL}/health`);console.log(`Worker heartbeat: ${response.status}`);}catch(err){console.error('Worker heartbeat failed:',err.message);}},intervalMs).unref();
  console.log(`Background worker heartbeat scheduled every ${intervalMs}ms.`);
}

app.listen(PORT,'0.0.0.0',()=>{
  console.log(`Runner listening on port ${PORT}`);
  startTelegramBot(process.env.TELEGRAM_BOT_TOKEN);
  startBackgroundWorker();
});
