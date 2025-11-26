let db, auth, user;

export function initFirebase(config) {
    firebase.initializeApp(config);
    auth = firebase.auth();
    db = firebase.database();
}

export function getAuth() { return auth; }
export function getDb() { return db; }
export function getUser() { return user; }

export function signInAnonymously() {
    return auth.signInAnonymously().then(u => {
        user = u.user;
        return user;
    });
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
