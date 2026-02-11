import { createClient } from '@supabase/supabase-js';
import { GoogleGenerativeAI } from "@google/generative-ai";
// 注意：我们需要稍后更新 prompt_bank.js 以匹配新的通用引擎，
// 但为了兼容性，这里暂时保留引用，代码逻辑里会做动态替换。
import { GAME_MASTER_PROMPT } from './lib/prompt_bank.js';

// 初始化 Supabase (使用 Service Role Key 以获得管理员权限)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash-lite" });

// 辅助函数：读取房间 JSON
async function getRoom(rid) {
    const { data, error } = await supabase.from('rooms').select('data').eq('id', rid).single();
    if (error && error.code !== 'PGRST116') console.error("GetRoom Error:", error);
    return data ? data.data : null;
}

// 辅助函数：保存房间 JSON
async function saveRoom(rid, roomData) {
    const { error } = await supabase.from('rooms').upsert({
        id: rid,
        data: roomData,
        updated_at: new Date().toISOString()
    });
    if (error) throw new Error("SaveRoom Error: " + error.message);
}

// 辅助函数：更新玩家 Current Room 指针
async function updateUserCurrentRoom(uid, rid) {
    // 读取现有 profile
    const { data } = await supabase.from('profiles').select('data').eq('id', uid).single();
    const profileData = data ? data.data : {};

    if (rid === null) {
        delete profileData.current_room;
    } else {
        profileData.current_room = rid;
    }

    await supabase.from('profiles').upsert({
        id: uid,
        data: profileData
    });
}

// 辅助函数：获取玩家当前的 Room ID
async function getUserCurrentRoom(uid) {
    const { data } = await supabase.from('profiles').select('data').eq('id', uid).single();
    return data?.data?.current_room || null;
}

export default async function handler(req, res) {
    // CORS 处理 (如果在本地调试需要)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const { action: A, roomId: R, userId: U, choiceText: C, userProfile: P, worldConfig: W } = req.body;

    try {
        // --- 1. 创建房间 (CREATE_ROOM) ---
        if (A === 'CREATE_ROOM') {
            const id = Math.floor(1000 + Math.random() * 9000).toString();

            // 默认世界观设定 (如果没有传入 worldConfig)
            const defaultWorld = {
                genre: "Cyberpunk",
                tone: "High Tech, Low Life, Neon, Rain",
                vocab: { hp: "HP", inv: "Inventory" }
            };

            const newRoomData = {
                created_at: Date.now(),
                status: 'SOLO',
                turn: 0,
                last_scene_change: 0,
                players: {},
                host_info: P || { name: '?', role: '?' },
                world_setting: W || defaultWorld // 注入世界观
            };

            await saveRoom(id, newRoomData);
            return res.json({ roomId: id });
        }

        // --- 2. 离开房间 (LEAVE_ROOM) ---
        if (A === 'LEAVE_ROOM') {
            const currentRid = await getUserCurrentRoom(U);
            if (currentRid) {
                const roomData = await getRoom(currentRid);
                if (roomData && roomData.players) {
                    delete roomData.players[U];
                    // 如果房间空了，删除房间 (Supabase Delete)
                    if (Object.keys(roomData.players).length === 0) {
                        await supabase.from('rooms').delete().eq('id', currentRid);
                    } else {
                        await saveRoom(currentRid, roomData);
                    }
                }
                await updateUserCurrentRoom(U, null);
            }
            return res.json({ success: true });
        }

        // --- 3. 加入房间 (JOIN_ROOM) ---
        if (A === 'JOIN_ROOM') {
            let roomData = await getRoom(R);
            if (!roomData) return res.status(404).json({ error: "No Room" });

            // 清理旧房间状态
            const oldRid = await getUserCurrentRoom(U);
            if (oldRid && oldRid !== R) {
                const oldRoom = await getRoom(oldRid);
                if (oldRoom && oldRoom.players) {
                    delete oldRoom.players[U];
                    if (Object.keys(oldRoom.players).length === 0) {
                        await supabase.from('rooms').delete().eq('id', oldRid);
                    } else {
                        await saveRoom(oldRid, oldRoom);
                    }
                }
            }

            // 加入新房间
            if (!roomData.players) roomData.players = {};
            roomData.players[U] = {
                joined: true,
                choice: null,
                profile: P
            };

            await saveRoom(R, roomData);
            await updateUserCurrentRoom(U, R);
            return res.json({ success: true, status: roomData.status });
        }

        // --- 4. 预加载 (PRELOAD_TURN) ---
        // 注意：预加载逻辑比较消耗 Token，如果以后想省钱可以暂时关掉
        if (A === 'PRELOAD_TURN') {
            const roomData = await getRoom(R);
            if (!roomData) return res.json({ error: "No Room" });

            const cs = roomData.current_scene?.[U]?.choices;
            if (!cs) return res.json({ msg: "No choices" });

            // 确定性换场逻辑
            const curTurn = roomData.turn || 0;
            const nextTurn = curTurn + 1;
            const nextChg = roomData.next_scene_change || (curTurn + 5);
            const isNextChg = (nextTurn >= nextChg);

            // 并行生成 A/B 选项的结果
            const [rA, rB] = await Promise.all(cs.map(c => run(roomData, R, U, c.text, true, isNextChg)));

            if (!isNextChg) {
                [rA, rB].forEach(r => {
                    Object.values(r.views).forEach(v => { v.stage_1_env = null; v.location = null; });
                });
            }

            // 存入 prebuffer (内存修改 -> 存库)
            if (!roomData.prebuffer) roomData.prebuffer = {};
            roomData.prebuffer[U] = { [cs[0].text]: rA, [cs[1].text]: rB };

            await saveRoom(R, roomData);
            return res.json({ status: "PRELOADED" });
        }

        // --- 5. 游戏主循环 (START_GAME / MAKE_MOVE) ---
        if (A === 'START_GAME' || A === 'MAKE_MOVE') {
            let d = await getRoom(R);
            if (!d) return res.status(404).json({ error: "Room not found" });

            const curTurn = d.turn || 0;

            // 1. 确定性换场逻辑
            let nextChg = d.next_scene_change;
            if (!nextChg) {
                nextChg = curTurn + 2 + Math.floor(Math.random() * 3);
                d.next_scene_change = nextChg;
                // 这里先不存，等最后一起存
            }
            const isChg = (curTurn >= nextChg) || (curTurn === 0);

            if (A === 'MAKE_MOVE') {
                // 检查是否有预加载数据
                const pre = d.prebuffer?.[U]?.[C];

                if (pre) {
                    // --- 命中预加载 ---
                    let hpChanged = d.hp_change_occurred || false;
                    const preIsChg = !!Object.values(pre.views)[0].stage_1_env;
                    if (preIsChg) hpChanged = false;

                    const isLastChance = (curTurn + 1 >= nextChg - 1);
                    let forceHp = false;
                    if (!hpChanged && !preIsChg && isLastChance) forceHp = true;

                    // 应用 HP 逻辑
                    Object.values(pre.views).forEach(v => {
                        if (v.hp_change) {
                            if (hpChanged) v.hp_change = 0;
                            else hpChanged = true;
                        } else if (forceHp) {
                            const val = Math.random() > 0.3 ? -10 : 5;
                            v.hp_change = val;
                            v.stage_2_event += val < 0 ? " [受到意外伤害]" : " [获得喘息]";
                            hpChanged = true;
                        }
                    });

                    // 更新状态
                    d.current_scene = pre.views;
                    if (!d.history) d.history = [];
                    d.history.push(`[事件] ${pre.global_summary}`);
                    d.players[U].choice = null;
                    if (d.prebuffer) delete d.prebuffer[U]; // 消耗掉预加载

                    // 结算 HP
                    const pIds = Object.keys(d.players);
                    for (const pid of pIds) {
                        const v = pre.views[pid];
                        if (v?.hp_change) {
                            let hp = (d.players[pid].profile.public.hp || 100) + v.hp_change;
                            d.players[pid].profile.public.hp = hp < 0 ? 0 : hp;
                            if (hp <= 0) {
                                d.players[pid].dead = true;
                                if (d.current_scene[pid]) d.current_scene[pid].is_dead = true;
                            }
                        }
                    }

                    // 推进回合
                    d.turn = curTurn + 1;
                    d.hp_change_occurred = hpChanged;
                    if (preIsChg) {
                        d.last_scene_change = curTurn + 1;
                        d.next_scene_change = (curTurn + 1) + 2 + Math.floor(Math.random() * 3);
                    }

                    await saveRoom(R, d);
                    return res.json({ status: "NEW_TURN" });
                }

                // 未命中预加载，记录选择
                d.players[U].choice = C;
                // 先保存选择状态，防止并发问题（虽然这里是乐观锁，但也够用了）
                await saveRoom(R, d);
            }

            // 检查是否所有人都提交了选择
            const pIds = Object.keys(d.players || {});
            const allReady = pIds.every(pid => d.players[pid].choice || d.players[pid].dead); // 死人不需要选择

            if (A === 'MAKE_MOVE' && !allReady) return res.json({ status: "WAITING" });

            // --- 2. 实时生成内容 (Generate Content) ---
            const ai = await run(d, R, U, null, false, isChg);

            // --- 3. HP 逻辑裁决 ---
            let hpChanged = d.hp_change_occurred || false;
            if (isChg) hpChanged = false;

            if (!isChg) {
                // 如果不是换场，清除 Location 和 Environment 描写，避免重复
                Object.values(ai.views).forEach(v => { v.stage_1_env = null; v.location = null; });
            }

            const isLastChance = (curTurn + 1 >= nextChg - 1);
            let forceHp = false;
            if (!hpChanged && !isChg && isLastChance) forceHp = true;

            Object.values(ai.views).forEach(v => {
                if (v.hp_change) {
                    if (hpChanged) v.hp_change = 0;
                    else hpChanged = true;
                } else if (forceHp) {
                    const val = Math.random() > 0.3 ? -10 : 5;
                    v.hp_change = val;
                    v.stage_2_event += val < 0 ? " [受到意外伤害]" : " [获得喘息]";
                    hpChanged = true;
                }
            });

            // 更新状态
            d.current_scene = ai.views;
            if (!d.history) d.history = [];
            d.history.push(`[事件] ${ai.global_summary}`);

            for (const pid of pIds) {
                d.players[pid].choice = null;
                const v = ai.views[pid];
                if (v?.hp_change) {
                    let hp = (d.players[pid].profile.public.hp || 100) + v.hp_change;
                    d.players[pid].profile.public.hp = hp < 0 ? 0 : hp;
                    if (hp <= 0) {
                        d.players[pid].dead = true;
                        if (d.current_scene[pid]) d.current_scene[pid].is_dead = true;
                    }
                }
            }

            d.turn = curTurn + 1;
            d.hp_change_occurred = hpChanged;
            if (isChg) {
                d.last_scene_change = curTurn + 1;
                d.next_scene_change = (curTurn + 1) + 2 + Math.floor(Math.random() * 3);
            }

            if (A === 'START_GAME') d.status = 'PLAYING';

            await saveRoom(R, d);
            return res.json({ status: "NEW_TURN" });
        }

        return res.status(400).json({ error: "Unknown Action" });

    } catch (e) {
        console.error("API Error:", e);
        return res.status(500).json({ error: e.message });
    }
}

// 核心 AI 逻辑
async function run(roomData, rid, uid, simChoice, isPre, forceIsChg) {
    const pIds = Object.keys(roomData.players || {});

    // 逻辑判定：是否换场
    const isChg = forceIsChg !== undefined
        ? forceIsChg
        : (((roomData.turn || 0) - (roomData.last_scene_change || 0) >= (2 + Math.floor(Math.random() * 3))) || (roomData.turn === 0));

    // 获取历史
    const hist = (roomData.history || []).slice(-3);

    // 构建玩家上下文
    let ctx = "";
    pIds.forEach(pid => {
        const p = roomData.players[pid];
        // 如果是预加载(isPre)，且是当前用户(uid)，使用模拟的选择(simChoice)
        // 否则使用实际存储的选择
        const c = (isPre && pid === uid) ? simChoice : (p.choice || "进入区域");
        ctx += `ID(${pid}):${p.profile?.name}[${p.profile?.role}]\nState:${JSON.stringify(p.profile?.public)}\nAct:${c}\n\n`;
    });

    // --- 动态 Prompt 构建 (核心修改) ---
    // 读取房间的世界观设定，如果没有则使用默认赛博朋克设定
    const w = roomData.world_setting || {
        genre: "Cyberpunk",
        tone: "Neon, Rain, High Tech Low Life",
        vocab: { hp: "HP" }
    };

    // 替换 Prompt 中的占位符
    // 注意：这里假设 GAME_MASTER_PROMPT 将来会被替换成通用模板
    // 为了暂时兼容旧的 Prompt (它没有 {{GENRE}} 等占位符)，我们只是简单替换必要字段
    // 当你更新 prompt_bank.js 后，这里的替换逻辑会真正生效
    let pmt = GAME_MASTER_PROMPT
        .replace('{{HISTORY}}', hist.join("\n"))
        .replace('{{IS_SCENE_CHANGE}}', isChg)
        .replace('{{PLAYER_CONTEXT}}', ctx);

    // 如果 Prompt 里包含新的占位符，进行替换 (为未来做准备)
    pmt = pmt
        .replace('{{GENRE}}', w.genre)
        .replace('{{TONE}}', w.tone)
        .replace('{{VOCAB_HP}}', w.vocab?.hp || "HP");

    try {
        console.log(`[Gemini] Generating with model: gemini-2.5-flash-lite`);
        console.log(`[Gemini] Key loaded: ${process.env.GEMINI_API_KEY ? 'Yes (Starts with ' + process.env.GEMINI_API_KEY.substring(0, 4) + ')' : 'NO'}`);

        const result = await model.generateContent(pmt);
        const text = result.response.text();
        console.log(`[Gemini] Raw response length: ${text.length}`);
        // console.log(`[Gemini] Raw response:`, text); // Uncomment if needed
        // 提取 JSON
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error("No JSON found in AI response");

        const raw = JSON.parse(jsonMatch[0]);

        // 清洗 Key (防止 AI 幻觉生成错误的 UID Key)
        const cleanViews = {};
        Object.keys(raw.views || {}).forEach(k => {
            const cleanKey = pIds.find(pid => k.includes(pid)) || k;
            cleanViews[cleanKey] = raw.views[k];
        });
        raw.views = cleanViews;

        return raw;
    } catch (e) {
        console.error("Gemini Error:", e);
        // 降级处理
        return {
            global_summary: "系统错误: 数据流中断",
            views: { [uid]: { stage_2_event: `神经连接不稳定: ${e.message}`, choices: [{ text: "重试" }, { text: "等待" }] } }
        };
    }
}