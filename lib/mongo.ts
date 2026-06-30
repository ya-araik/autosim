import { MongoClient, type Db } from "mongodb";

type MongoGlobal = typeof globalThis & {
  mongoClientPromise?: Promise<MongoClient>;
  mongoIndexesReady?: Promise<void>;
};

const globalForMongo = globalThis as MongoGlobal;

function getMongoUri() {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error("MONGODB_URI is not configured");
  }

  return uri;
}

export function getMongoClient() {
  if (!globalForMongo.mongoClientPromise) {
    globalForMongo.mongoClientPromise = new MongoClient(getMongoUri()).connect();
  }

  return globalForMongo.mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(process.env.MONGODB_DB || "autosim");
}

export async function ensureMongoIndexes() {
  if (!globalForMongo.mongoIndexesReady) {
    globalForMongo.mongoIndexesReady = (async () => {
      const db = await getDb();

      await Promise.all([
        db.collection("leads").createIndex({ leadNumber: 1 }, { unique: true }),
        db.collection("leads").createIndex({ status: 1 }),
        db.collection("leads").createIndex({ phone: 1 }),
        db.collection("lead_events").createIndex({ leadId: 1 })
      ]);
    })();
  }

  return globalForMongo.mongoIndexesReady;
}
