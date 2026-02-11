// public/js/firebase.js (原文件名保留，内容替换)

// 初始化
let supabase;
let currentUser = null;

export const initFirebase = (cfg) => {
    // cfg 传入 { supabaseUrl, supabaseKey }
    supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
};

export const getUser = () => currentUser;

// 匿名登录
export const signInAnonymously = async () => {
    // Supabase 的匿名登录稍微复杂点，通常直接用 signUP 假装一个，或者干脆只存 localStorage
    // 为了简化，我们这里直接生成一个随机 ID 存本地，假装是登录了
    let uid = localStorage.getItem('anon_uid');
    if (!uid) {
        uid = 'user_' + Math.random().toString(36).substr(2, 9);
        localStorage.setItem('anon_uid', uid);
    }
    currentUser = { uid: uid };
    return currentUser;
};

// --- 用户档案读写 ---

export const loadUserProfile = async (uid) => {
    const { data, error } = await supabase
        .from('profiles')
        .select('data')
        .eq('id', uid)
        .maybeSingle();
    if (error || !data) return null;
    return { profile: data.data }; // 保持原来的返回结构
};

export const saveUserProfile = async (uid, p) => {
    // Upsert: 有则改，无则加
    await supabase.from('profiles').upsert({ id: uid, data: p });
};

export const removeUserProfile = async (uid) => {
    await supabase.from('profiles').delete().eq('id', uid);
};

// --- 房间监听逻辑 (核心) ---

// 监听房间列表
export const listenToRooms = (cb) => {
    // 1. 先拉取一次快照
    supabase.from('rooms').select('*').order('updated_at', { ascending: false }).limit(10)
        .then(({ data }) => {
            const roomsMap = {};
            data?.forEach(row => roomsMap[row.id] = row.data);
            cb(roomsMap);
        });

    // 2. 订阅变更
    supabase.channel('public:rooms')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms' }, (payload) => {
            // 当有房间变化时，重新拉取列表（偷懒做法，或者手动合并 payload）
            supabase.from('rooms').select('*').order('updated_at', { ascending: false }).limit(10)
                .then(({ data }) => {
                    const roomsMap = {};
                    data?.forEach(row => roomsMap[row.id] = row.data);
                    cb(roomsMap);
                });
        })
        .subscribe();
};

// 监听特定房间的 Players
export const listenToRoomPlayers = (rid, cb) => {
    // 这里的逻辑有点变，我们订阅整个 Room 的 data，然后在回调里解析 players
    // Supabase 不能像 Firebase 那样只监听子节点 (rooms/id/players)
    // 所以我们监听整个 Row
    subscribeToRoom(rid, (roomData) => {
        if (roomData && roomData.players) {
            cb(Object.keys(roomData.players).length);
        } else {
            cb(0);
        }
    });
};

// 监听特定房间的 Scene
export const listenToRoomScene = (rid, cb) => {
    subscribeToRoom(rid, (roomData) => {
        if (roomData && roomData.current_scene) {
            cb(roomData.current_scene);
        }
    });
};

// 监听特定房间的 Status
export const listenToRoomStatus = (rid, cb) => {
    subscribeToRoom(rid, (roomData) => {
        if (roomData && roomData.status) {
            cb(roomData.status);
        }
    });
};

// 辅助：单例订阅模式 (支持多个监听者)
let currentRoomSub = null;
let currentRoomId = null;
let roomListeners = [];

const subscribeToRoom = (rid, callback) => {
    // 1. 如果ID变了，清理旧的
    if (currentRoomId && currentRoomId !== rid) {
        console.log(`[Supabase] Switching room from ${currentRoomId} to ${rid}`);
        if (currentRoomSub) supabase.removeChannel(currentRoomSub);
        currentRoomSub = null;
        roomListeners = [];
    }

    currentRoomId = rid;
    roomListeners.push(callback);

    // 2. 如果已经订阅，直接触发一次当前缓存数据 (如果有)
    // (这里简化处理，依赖 Realtime 推送，或者可以在这里加个 cache)

    // 3. 如果没订阅，发起订阅
    if (!currentRoomSub) {
        console.log(`[Supabase] Subscribing to room:${rid}...`);

        // 3.1 Initial Fetch
        supabase.from('rooms').select('data').eq('id', rid).maybeSingle()
            .then(({ data }) => {
                if (data) {
                    // Notify all listeners
                    roomListeners.forEach(cb => cb(data.data));
                }
            });

        // 3.2 Realtime Subscription
        const channel = supabase.channel(`room:${rid}`)
            .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${rid}` }, (payload) => {
                console.log("[Supabase] Realtime update received");
                // Notify all listeners
                roomListeners.forEach(cb => cb(payload.new.data));
            })
            .subscribe((status) => {
                console.log(`[Supabase] Channel status: ${status}`);
                if (status === 'SUBSCRIBED') {
                    // console.log("[Supabase] Successfully connected to Realtime.");
                } else if (status === 'CLOSED' || status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
                    console.warn(`[Supabase] Channel disconnected (${status}). Attempting to reconnect in 2s...`);
                    // Clean up current subscription reference so next call creates a new one
                    if (currentRoomSub === channel) {
                        currentRoomSub = null;
                        supabase.removeChannel(channel);
                    }
                    // Auto-reconnect after delay
                    setTimeout(() => {
                        if (currentRoomId === rid) { // Only reconnect if user hasn't switched rooms
                            console.log("[Supabase] Reconnecting...");
                            subscribeToRoom(rid, () => { }); // Callback ignored here as it's already in roomListeners
                        }
                    }, 2000);
                }
            });

        currentRoomSub = channel;
    }
};