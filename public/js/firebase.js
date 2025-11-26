// Firebase Configuration (Hardcoded)
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_AUTH_DOMAIN",
    databaseURL: "YOUR_DATABASE_URL",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// Auto-Initialize
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}
const auth = firebase.auth();
const db = firebase.database();

// Set Persistence to LOCAL
auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

let user = null;

export async function signInAnonymously() {
    if (user) return user;
    const u = await auth.signInAnonymously();
    user = u.user;
    return user;
}

export async function getIdToken() {
    if (!auth.currentUser) return null;
    return await auth.currentUser.getIdToken(true);
}

export function getUser() {
    return auth.currentUser;
}

export function getDb() {
    return db;
}

export function loadUserProfile(uid) {
    return db.ref('users/' + uid).once('value').then(s => s.val());
}

export function saveUserProfile(uid, profile) {
    return db.ref('users/' + uid).set({ profile: profile });
}

export function removeUserProfile(uid) {
    return db.ref('users/' + uid).remove();
}

export function listenToRooms(callback) {
    return db.ref('rooms').limitToLast(10).on('value', s => callback(s.val()));
}

export function listenToRoomPlayers(rid, callback) {
    return db.ref(`rooms/${rid}/players`).on('value', s => callback(s.numChildren()));
}

export function listenToRoomScene(rid, callback) {
    return db.ref(`rooms/${rid}/current_scene`).on('value', s => callback(s.val()));
}
