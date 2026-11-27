const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { MongoClient, GridFSBucket } = require('mongodb');

const scryptAsync = promisify(crypto.scrypt);

let cachedClient = null;
let cachedDb = null;
let cachedConnectPromise = null;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

async function hashPasswordAsync(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = (await scryptAsync(password, salt, 64)).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

async function verifyPasswordAsync(password, storedHash) {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = await scryptAsync(password, salt, 64);
  const keyBuf = Buffer.from(key, 'hex');
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

function nowStr() {
  return new Date().toISOString();
}

async function connectDb() {
  if (cachedDb) return cachedDb;
  if (cachedConnectPromise) return cachedConnectPromise;

  cachedConnectPromise = (async () => {
    let uri = (process.env.MONGODB_URI || '').trim().replace(/^["']|["']$/g, '');
    if (uri.startsWith('MONGODB_URI=')) {
      uri = uri.slice('MONGODB_URI='.length).trim().replace(/^["']|["']$/g, '');
    }
    if (!uri) {
      throw new Error('MONGODB_URI não configurada nas variáveis de ambiente.');
    }

    if (!cachedClient) {
      const client = new MongoClient(uri, {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 8000,
      });
      await client.connect();
      cachedClient = client;
    }

    const dbName = process.env.MONGODB_DB || 'merchandising_pro';
    cachedDb = cachedClient.db(dbName);
    return cachedDb;
  })().catch((err) => {
    cachedConnectPromise = null;
    cachedClient = null;
    cachedDb = null;
    throw err;
  });

  return cachedConnectPromise;
}

async function col(name) {
  const db = await connectDb();
  return db.collection(name);
}

async function nextId(name) {
  const counters = await col('counters');
  const result = await counters.findOneAndUpdate(
    { _id: name },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  return result.seq;
}

async function getGridFSBucket() {
  const db = await connectDb();
  return new GridFSBucket(db, { bucketName: 'uploads' });
}

module.exports = {
  connectDb,
  col,
  nextId,
  nowStr,
  hashPassword,
  hashPasswordAsync,
  verifyPassword,
  verifyPasswordAsync,
  getGridFSBucket,
};
