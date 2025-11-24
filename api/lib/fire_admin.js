import admin from 'firebase-admin';

// 单例模式：保证数据库只连接一次，防止报错
let dbInstance = null;

export function getDb() {
    if (dbInstance) return dbInstance;

    if (!admin.apps.length) {
        try {
            const serviceAccountStr = process.env.FIREBASE_SERVICE_ACCOUNT;
            const dbUrl = process.env.FIREBASE_DB_URL;
            
            if (!serviceAccountStr || !dbUrl) throw new Error("环境变量缺失");

            let serviceAccount = JSON.parse(serviceAccountStr);
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                databaseURL: dbUrl
            });
            console.log("Firebase Admin 初始化成功");
        } catch (e) {
            console.error("Firebase 初始化失败:", e);
            throw e;
        }
    }
    
    dbInstance = admin.database();
    return dbInstance;
}

export const ServerValue = admin.database.ServerValue;
