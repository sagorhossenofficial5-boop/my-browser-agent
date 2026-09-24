const API_KEY = process.env.GEMINI_API_KEY || "AQ.Ab8RN6Ll2g3bWoC2qFgn7uUXP6Lz_V27U-bsn1jZHuKb_XqkiQ";
const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;

const res = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] })
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
