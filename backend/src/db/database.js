const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');

let cachedClient = null;
let cachedDb = null;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, storedHash) {
  const [salt, key] = (storedHash || '').split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function connectDb() {
  if (cachedDb) return cachedDb;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI não configurada nas variáveis de ambiente.');
  }

  if (!cachedClient) {
    cachedClient = new MongoClient(uri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 8000,
    });
    await cachedClient.connect();
  }

  const dbName = process.env.MONGODB_DB || 'merchandising_pro';
  cachedDb = cachedClient.db(dbName);
  return cachedDb;
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

module.exports = {
  connectDb,
  col,
  nextId,
  nowStr,
  hashPassword,
  verifyPassword,
};
