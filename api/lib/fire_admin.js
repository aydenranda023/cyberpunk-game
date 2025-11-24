import admin from 'firebase-admin';

let dbInstance = null;

export function getDb() {
    if (dbInstance) return dbInstance;

    if (!admin.apps.length) {
        try {
            const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
            const dbUrl = process.env.FIREBASE_DB_URL;
            
            if (!serviceAccountStr || !dbUrl) throw new Error("环境变量缺失");

            let serviceAccount = JSON.parse(serviceAccountStr);
            // 修复私钥换行符 (关键)
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: dbUrl
            });
        } catch (e) {
            console.error("Firebase Init Error:", e);
            throw e; // 抛出错误让 game.js 处理
        }
    }
    
    dbInstance = admin.database();
    return dbInstance;
}

export const ServerValue = admin.database.ServerValue;
