const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { initSchema } = require('./db/database');
const { seedIfEmpty } = require('./db/seed');
const { uploadDir } = require('./middleware/upload');

const authRoutes = require('./routes/auth');
const storesRoutes = require('./routes/storesRoutes');
const merchandisingRoutes = require('./routes/merchandisingRoutes');
const commercialRoutes = require('./routes/commercialRoutes');

initSchema();
seedIfEmpty();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/uploads', express.static(uploadDir));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', app: 'MERCHANDISING PRO API', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api', storesRoutes);
app.use('/api', merchandisingRoutes);
app.use('/api', commercialRoutes);

// Serve frontend build if available
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
app.use(express.static(distDir));
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
  const indexFile = path.join(distDir, 'index.html');
  if (require('node:fs').existsSync(indexFile)) {
    return res.sendFile(indexFile);
  }
  next();
});

app.listen(PORT, () => {
  console.log(`MERCHANDISING PRO Backend rodando em http://localhost:${PORT}`);
});
