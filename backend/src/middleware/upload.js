const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { getGridFSBucket } = require('../db/database');

const uploadDir = process.env.VERCEL
  ? '/tmp/merchandising_uploads'
  : path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function saveFileToGridFS(file) {
  if (!file || !file.path) return '';
  try {
    const bucket = await getGridFSBucket();
    await new Promise((resolve, reject) => {
      const readStream = fs.createReadStream(file.path);
      const uploadStream = bucket.openUploadStream(file.filename, {
        contentType: file.mimetype || 'image/jpeg',
      });
      readStream.pipe(uploadStream).on('finish', resolve).on('error', reject);
    });
  } catch (err) {
    console.error('GridFS upload error:', err.message);
  }
  return `/uploads/${file.filename}`;
}

module.exports = { upload, uploadDir, saveFileToGridFS };
