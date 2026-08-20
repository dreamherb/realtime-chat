const DB_NAME = "realtime-chat-outbox";
const STORE = "pending";
const DB_VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("NO_INDEXEDDB"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "clientMsgId" });
        store.createIndex("byUserRoom", ["userId", "roomId"], {
          unique: false,
        });
        store.createIndex("byUser", "userId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// IndexedDB 불가(사설 모드 등)면 메모리. 새로고침 유실은 그때 감수. PWA는 IDB가 본경로.
const memory = [];

function memoryPut(row) {
  const i = memory.findIndex((item) => item.clientMsgId === row.clientMsgId);
  if (i >= 0) memory[i] = row;
  else memory.push(row);
}

function memoryDelete(clientMsgId) {
  const i = memory.findIndex((item) => item.clientMsgId === clientMsgId);
  if (i >= 0) memory.splice(i, 1);
}

async function putPending(row) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    memoryPut(row);
  }
}

async function removePending(clientMsgId) {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(clientMsgId);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    memoryDelete(clientMsgId);
  }
}

async function listPendingForRoom(userId, roomId) {
  const uid = Number(userId);
  const rid = Number(roomId);
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("byUserRoom");
    const rows = await txDone(index.getAll([uid, rid]));
    db.close();
    return (rows || []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return memory
      .filter((row) => Number(row.userId) === uid && Number(row.roomId) === rid)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}

async function listPendingForUser(userId) {
  const uid = Number(userId);
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const index = tx.objectStore(STORE).index("byUser");
    const rows = await txDone(index.getAll(uid));
    db.close();
    return (rows || []).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return memory
      .filter((row) => Number(row.userId) === uid)
      .sort((a, b) => a.createdAt - b.createdAt);
  }
}

window.ChatOutbox = {
  putPending,
  removePending,
  listPendingForRoom,
  listPendingForUser,
};
