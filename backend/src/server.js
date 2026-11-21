const express = require('express');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const { seedIfEmpty } = require('./db/seed');
const { getGridFSBucket } = require('./db/database');
const { uploadDir } = require('./middleware/upload');

const authRoutes = require('./routes/auth');
const storesRoutes = require('./routes/storesRoutes');
const merchandisingRoutes = require('./routes/merchandisingRoutes');
const commercialRoutes = require('./routes/commercialRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.get('/uploads/:filename', async (req, res) => {
  const safeName = path.basename(req.params.filename);
  const localPath = path.join(uploadDir, safeName);
  if (fs.existsSync(localPath)) {
    return res.sendFile(localPath);
  }
  try {
    const bucket = await getGridFSBucket();
    const files = await bucket.find({ filename: safeName }).limit(1).toArray();
    if (!files.length) {
      return res.status(404).json({ error: 'Imagem não encontrada.' });
    }
    res.setHeader('Content-Type', files[0].contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    bucket.openDownloadStream(files[0]._id).pipe(res);
  } catch {
    res.status(404).json({ error: 'Imagem não encontrada.' });
  }
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    app: 'MERCHANDISING PRO API',
    database: process.env.MONGODB_URI ? 'MongoDB configurado' : 'MONGODB_URI ausente',
    timestamp: new Date().toISOString(),
  });
});

// Garantir conexão e seed inicial no MongoDB antes das rotas de API
app.use('/api', async (_req, res, next) => {
  try {
    await seedIfEmpty();
    next();
  } catch (err) {
    res.status(500).json({ error: err.message || 'Erro ao conectar no MongoDB.' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', storesRoutes);
app.use('/api', merchandisingRoutes);
app.use('/api', commercialRoutes);

// Serve frontend build locally when not running on Vercel Services
const distDir = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (!process.env.VERCEL && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    const indexFile = path.join(distDir, 'index.html');
    if (fs.existsSync(indexFile)) {
      return res.sendFile(indexFile);
    }
    next();
  });
}

// Global error handler
app.use((err, _req, res, _next) => {
  console.error('API Error:', err);
  res.status(500).json({ error: err.message || 'Erro interno no servidor.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MERCHANDISING PRO Backend rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
