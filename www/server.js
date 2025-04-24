// server.js
const express = require('express');
const path    = require('path');
const app     = express();

// Serve static assets from the 'dist' directory
app.use(express.static(path.join(__dirname, 'dist')));

// Explicit routes for HTML pages (without .html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});
app.get('/gallery', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'gallery.html'));
});
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'app.html'));
});

// SPA fallback: send index.html for client-side routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 4203;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
