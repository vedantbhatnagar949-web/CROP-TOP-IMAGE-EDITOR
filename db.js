const DB_NAME = 'CropTopDB';
const DB_VERSION = 1;
const STORE_NAME = 'projects';

let db;

function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event) => {
      console.error("Database error: ", event.target.errorCode);
      reject(event.target.errorCode);
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

function saveProject(projectData) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    
    // Auto-update timestamp
    projectData.timestamp = Date.now();
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(projectData);

    request.onsuccess = () => resolve(projectData);
    request.onerror = (e) => reject(e.target.error);
  });
}

function loadProject(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

function getAllProjects() {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = (e) => {
      // Sort by newest first
      const projects = e.target.result.sort((a, b) => b.timestamp - a.timestamp);
      resolve(projects);
    };
    request.onerror = (e) => reject(e.target.error);
  });
}

function deleteProject(id) {
  return new Promise((resolve, reject) => {
    if (!db) return reject("DB not initialized");
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = (e) => reject(e.target.error);
  });
}

window.CropTopDB = {
  initDB,
  saveProject,
  loadProject,
  getAllProjects,
  deleteProject
};
