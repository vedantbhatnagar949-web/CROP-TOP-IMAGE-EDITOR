// Firebase configuration placeholder
const firebaseConfig = {
  apiKey: "AIzaSyB4Zj7vllXgO1iBFtg2ulfnjFxRVlmQr7A",
  authDomain: "crop--top.firebaseapp.com",
  projectId: "crop--top",
  storageBucket: "crop--top.firebasestorage.app",
  messagingSenderId: "401568724225",
  appId: "1:401568724225:web:5009199c1606f8ee135700",
  measurementId: "G-VKJMBZS4H0"
};

let app, auth, db;
let currentUser = null;

try {
  // Initialize Firebase if config is valid
  if (firebaseConfig.apiKey !== "YOUR_API_KEY") {
    app = firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();

    auth.onAuthStateChanged(user => {
      currentUser = user;
      const accountBadge = document.getElementById('accountBadge');
      const authPopup = document.getElementById('authPopup');
      
      if (user) {
        if (accountBadge) accountBadge.innerHTML = `<img src="${user.photoURL}" title="${user.displayName}">`;
        if (authPopup) authPopup.style.display = 'none';
        console.log("Logged in as:", user.displayName);
        // Load cloud projects and merge with local
        loadCloudProjects();
      } else {
        if (accountBadge) accountBadge.innerHTML = `<i class="fa-solid fa-user-circle"></i>`;
        console.log("User logged out");
      }
    });
  }
} catch (e) {
  console.warn("Firebase not properly configured:", e);
}

function signInWithGoogle() {
  if (!auth) {
    alert("Firebase is not configured! Please add your config to firebase.js");
    return;
  }
  const provider = new firebase.auth.GoogleAuthProvider();
  auth.signInWithPopup(provider).catch(err => {
    console.error("Sign in failed", err);
    alert("Sign in failed: " + err.message);
  });
}

function signOut() {
  if (auth) auth.signOut();
}

async function saveToCloud(project) {
  if (!db || !currentUser) return; // Only save to cloud if logged in
  try {
    // Firestore limit is 1MB per document. We might need to handle large images differently,
    // but for now, we'll try to save it as-is. In a production app, images go to Firebase Storage.
    await db.collection("users").doc(currentUser.uid).collection("projects").doc(project.id.toString()).set(project);
    console.log("Project saved to Cloud");
  } catch (error) {
    console.error("Error saving to cloud:", error);
    if (error.code === 'resource-exhausted') {
      console.warn("Project data too large for Firestore document (1MB limit). Consider Firebase Storage for image blobs.");
    }
  }
}

async function loadCloudProjects() {
  if (!db || !currentUser) return;
  try {
    const snapshot = await db.collection("users").doc(currentUser.uid).collection("projects").get();
    const cloudProjects = [];
    snapshot.forEach(doc => {
      cloudProjects.push(doc.data());
    });
    
    // Save these into IndexedDB so they are available offline
    if (window.CropTopDB) {
      for (const p of cloudProjects) {
        await window.CropTopDB.saveProject(p);
      }
      // Refresh UI if it's open
      if (typeof renderProjectsGrid === 'function') {
        renderProjectsGrid();
      }
    }
  } catch (error) {
    console.error("Error loading projects from cloud:", error);
  }
}

window.CropTopFirebase = {
  signInWithGoogle,
  signOut,
  saveToCloud,
  loadCloudProjects,
  get currentUser() { return currentUser; }
};
