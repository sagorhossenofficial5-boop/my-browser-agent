// Preload that serializes /api/action requests before runner-server.js handles them.
// Render can load this without changing the existing start command.
const express = require('express');

const originalPost = express.application.post;
const queue = [];
let running = false;

async function drain() {
  if (running || queue.length === 0) return;
  running = true;
  const job = queue.shift();
  try {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };
      const originalEnd = job.res.end;
      job.res.end = function (...args) {
        try { return originalEnd.apply(this, args); }
        finally { finish(); }
      };
      const originalSend = job.res.send;
      const originalJson = job.res.json;
      job.res.send = function (...args) {
        try { return originalSend.apply(this, args); }
        finally { finish(); }
      };
      job.res.json = function (...args) {
        try { return originalJson.apply(this, args); }
        finally { finish(); }
      };
      try {
        Promise.resolve(job.handler(job.req, job.res, job.next)).catch((err) => {
          if (!job.res.headersSent) job.res.status(500).json({ success: false, error: err.message });
          finish();
        });
      } catch (err) {
        if (!job.res.headersSent) job.res.status(500).json({ success: false, error: err.message });
        finish();
      }
      setTimeout(finish, 120000);
    });
  } finally {
    running = false;
    setImmediate(drain);
  }
}

express.application.post = function (path, ...handlers) {
  if (path === '/api/action' && handlers.length) {
    const wrapped = function (req, res, next) {
      queue.push({ req, res, next, handler: handlers[handlers.length - 1] });
      drain();
    };
    // Always pass an iterable array to Express's original .post implementation.
    const middleware = handlers.length === 1
      ? [wrapped]
      : [...handlers.slice(0, -1), wrapped];
    return originalPost.call(this, path, ...middleware);
  }
  return originalPost.call(this, path, ...handlers);
};

console.log('🧵 Action queue preload enabled: /api/action requests are serialized.');
