const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { seedIfEmpty } = require('./db/seed');
const { runIncrementalMigrations } = require('./db/migrations');
const { getGridFSBucket } = require('./db/database');
const { uploadDir } = require('./middleware/upload');

const authRoutes = require('./routes/auth');
const storesRoutes = require('./routes/storesRoutes');
const visitWorkflowRoutes = require('./routes/visitWorkflowRoutes');
const merchandisingRoutes = require('./routes/merchandisingRoutes');
const commercialRoutes = require('./routes/commercialRoutes');

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL);

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

const allowedOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Permite requisições same-origin, curl/mobile sem Origin ou lista configurada
      if (!origin || allowedOrigins.length === 0) return callback(null, true);
      if (allowedOrigins.includes(origin) || (!IS_PROD && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))) {
        return callback(null, true);
      }
      return callback(new Error('Origem não autorizada pelo CORS.'));
    },
  })
);

app.use(express.json({ limit: '15mb' }));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.' },
});

app.use('/api/auth/login', loginLimiter);

const SAFE_UPLOAD_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

app.get('/uploads/:filename', async (req, res) => {
  const safeName = path.basename(req.params.filename);
  const ext = path.extname(safeName).toLowerCase();
  if (!SAFE_UPLOAD_EXTS.has(ext)) {
    return res.status(400).json({ error: 'Tipo de arquivo não permitido.' });
  }

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");

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
    ai_provider: process.env.GROQ_API_KEY
      ? 'Groq Vision'
      : process.env.GEMINI_API_KEY
      ? 'Gemini Vision'
      : 'Heurístico',
    timestamp: new Date().toISOString(),
  });
});

// Garantir conexão, seed inicial e migrations incrementais no MongoDB antes das rotas de API
app.use('/api', async (_req, res, next) => {
  try {
    await seedIfEmpty();
    await runIncrementalMigrations();
    next();
  } catch (err) {
    console.error('Erro ao inicializar MongoDB:', err.message);
    res.status(500).json({
      error: IS_PROD ? 'Erro ao conectar ao banco de dados.' : err.message || 'Erro ao conectar no MongoDB.',
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api', visitWorkflowRoutes);
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
  if (err instanceof multer.MulterError) {
    const msg =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'Arquivo muito grande. Tamanho máximo permitido: 10 MB.'
        : `Erro no upload do arquivo: ${err.message}`;
    return res.status(400).json({ error: msg });
  }
  const status = err.statusCode || err.status || 500;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: err.message || 'Requisição inválida.' });
  }
  res.status(500).json({
    error: IS_PROD ? 'Erro interno no servidor.' : err.message || 'Erro interno no servidor.',
  });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`MERCHANDISING PRO Backend rodando em http://localhost:${PORT}`);
  });
}

module.exports = app;
