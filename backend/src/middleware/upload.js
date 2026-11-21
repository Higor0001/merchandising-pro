const path = require('node:path');
const fs = require('node:fs');
const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { getGridFSBucket } = require('../db/database');

const uploadDir = process.env.VERCEL
  ? '/tmp/merchandising_uploads'
  : path.join(__dirname, '..', '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function isCloudinaryConfigured() {
  return Boolean(
    process.env.CLOUDINARY_URL ||
      (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET)
  );
}

if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
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

  // 1. Prioridade: Cloudinary (CDN permanente) se configurado
  if (isCloudinaryConfigured()) {
    try {
      const res = await cloudinary.uploader.upload(file.path, {
        folder: 'merchandising-pro',
        resource_type: 'image',
      });
      if (res?.secure_url) return res.secure_url;
    } catch (err) {
      console.error('Cloudinary upload error (usando GridFS como fallback):', err.message);
    }
  }

  // 2. Fallback: MongoDB GridFS
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
