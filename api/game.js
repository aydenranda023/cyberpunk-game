import { createClient } from '@supabase/supabase-js';
// import { GoogleGenerativeAI } from "@google/generative-ai"; // Removed
// 注意：我们需要稍后更新 prompt_bank.js 以匹配新的通用引擎，
// 但为了兼容性，这里暂时保留引用，代码逻辑里会做动态替换。
import { GAME_MASTER_PROMPT } from './lib/prompt_bank.js';

// 初始化 Supabase (使用 Service Role Key 以获得管理员权限)
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// DeepSeek API Helper
async function callDeepSeek(prompt) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error("Missing DEEPSEEK_API_KEY");

    console.log("[DeepSeek] Sending request...", prompt.substring(0, 50));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    try {
        const response = await fetch("https://api.deepseek.com/chat/completions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    { role: "system", content: "You are a creative cyberpunk game master. Output strictly in JSON." },
                    { role: "user", content: prompt }
                ],
                response_format: { type: "json_object" },
                temperature: 1.1
            }),
            signal: controller.signal
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[DeepSeek] API Error ${response.status}: ${errorText}`);
            throw new Error(`DeepSeek API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        console.log("[DeepSeek] Struct Response:", JSON.stringify(data).substring(0, 100));
        return data.choices[0].message.content;
    } catch (error) {
        clearTimeout(timeout);
        console.error("[DeepSeek] Fetch Failed:", error);
        throw error;
    }
}

// --- 辅助函数：鲁棒的 JSON 提取器 (Moved to top level) ---
function extractJSON(text) {
    text = text.replace(/```json/g, '').replace(/```/g, '');
    const start = text.indexOf('{');
    if (start === -1) return null;
    let balance = 0;
    let end = -1;
    for (let i = start; i < text.length; i++) {
        if (text[i] === '{') balance++;
        else if (text[i] === '}') balance--;
        if (balance === 0) { end = i + 1; break; }
    }
    return end !== -1 ? text.substring(start, end) : text.substring(start);
}

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

// --- 辅助函数：每日限流检查 ---
async function checkAndIncrementQuota() {
    const dateKey = new Date().toISOString().split('T')[0]; // "YYYY-MM-DD"

    // 1. 调用 RPC 原子增量
    const { data: count, error } = await supabase.rpc('increment_daily_usage', { date_str: dateKey });

    if (error) {
        console.error("Quota Check Error:", error);
        return true; // 数据库挂了暂时放行，或者你可以选择阻断
    }

    console.log(`[Quota] Today's Usage: ${count}/1000`);
    if (count > 1000) {
        throw new Error("QUOTA_EXCEEDED: Daily limit reached (1000/1000). Please try again tomorrow.");
    }
    return count;
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

            // 立即生成序章 (Chapter 0)
            let initialAI;
            try {
                initialAI = await runSingle(
                    { created_at: Date.now(), turn: 0, last_scene_change: 0, history: [], players: {}, world_setting: W || defaultWorld },
                    id,
                    'system',
                    '进入世界',
                    false,
                    true
                );
            } catch (err) {
                console.error("Initial AI Gen Failed:", err);
                initialAI = {
                    global_summary: "系统错误: 初始化数据流中断",
                    views: { 'system': { stage_1_env: `神经连接不稳定: ${err.message}`, location: "未知区域", choices: [] } }
                };
            }

            const newRoomData = {
                created_at: Date.now(),
                status: 'SOLO',
                turn: 0,
                last_scene_change: 0,
                next_scene_change: 2 + Math.floor(Math.random() * 3),
                players: {},
                host_info: P || { name: '?', role: '?' },
                world_setting: W || defaultWorld,
                current_scene: initialAI.views,
                history: [`[序章] ${initialAI.global_summary}`]
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

        // --- 4. 预加载 (PRELOAD_TURN) - 重构版 ---
        if (A === 'PRELOAD_TURN') {
            const roomData = await getRoom(R);
            if (!roomData) return res.json({ error: "No Room" });

            const cs = roomData.current_scene?.[U]?.choices;
            if (!cs || cs.length < 2) return res.json({ msg: "No choices" });

            // 检查配额
            await checkAndIncrementQuota();

            // 确定性换场逻辑
            const curTurn = roomData.turn || 0;
            const nextTurn = curTurn + 1;
            const nextChg = roomData.next_scene_change || (curTurn + 5);
            const isNextChg = (nextTurn >= nextChg);

            // 构建 Batch Prompt
            const choiceA = cs[0].text;
            const choiceB = cs[1].text;

            console.log(`[Batch] Preloading branches: ${choiceA} / ${choiceB}`);

            // 调用 AI (一次请求，双倍快乐)
            const batchResult = await runBatch(roomData, R, U, choiceA, choiceB, isNextChg);

            let rA = batchResult.branch_A;
            let rB = batchResult.branch_B;

            if (!isNextChg) {
                [rA, rB].forEach(r => {
                    Object.values(r.views).forEach(v => { v.stage_1_env = null; v.location = null; });
                });
            }

            // 存入 prebuffer
            if (!roomData.prebuffer) roomData.prebuffer = {};
            roomData.prebuffer[U] = { [choiceA]: rA, [choiceB]: rB };

            await saveRoom(R, roomData);
            return res.json({ status: "PRELOADED", usage: "1_credit_consumed" });
        }

        // --- 5. 游戏主循环 (START_GAME / MAKE_MOVE) ---
        if (A === 'START_GAME' || A === 'MAKE_MOVE') {
            let d = await getRoom(R);
            if (!d) return res.status(404).json({ error: "Room not found" });

            const curTurn = d.turn || 0;
            // ... (换场逻辑维持原样) ...
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
                    console.log("[Hit] Using preloaded data");
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
                            d.players[pid].profile.public.hp = Math.max(0, hp);
                            if (hp <= 0) {
                                d.players[pid].dead = true;
                                if (d.current_scene[pid]) d.current_scene[pid].is_dead = true;
                            }
                        }
                    }

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

            const pIds = Object.keys(d.players || {});
            const allReady = pIds.every(pid => d.players[pid].choice || d.players[pid].dead);
            if (A === 'MAKE_MOVE' && !allReady) return res.json({ status: "WAITING" });

            // --- 实时生成 (Generate Content) ---
            // 检查配额
            await checkAndIncrementQuota();

            const ai = await runSingle(d, R, U, null, false, isChg); // 复用下单次逻辑

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
                    d.players[pid].profile.public.hp = Math.max(0, hp);
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
        // 降级响应
        return res.json({
            error: e.message,
            global_summary: "系统通讯中断",
            views: { [U]: { stage_2_event: `通讯故障: ${e.message}`, choices: [{ text: "重试" }] } }
        });
    }
}

// --- 核心 AI 函数 (分拆为 Single 和 Batch) ---

// 1. Batch Mode (用于预加载)
async function runBatch(roomData, rid, uid, cA, cB, forceIsChg) {
    // 构造特殊的 Context，告诉 AI 有两个平行世界
    const w = roomData.world_setting || { genre: "Cyberpunk", vocab: { hp: "HP" } };
    const pIds = Object.keys(roomData.players);
    const hist = (roomData.history || []).slice(-3);

    // Batch Context: 我们只模拟当前用户(uid)的两种选择，其他玩家假设不动或者随机(这里简化为只考虑单人/当前玩家)
    // 多人模式下 Batch 很难做，目前仅支持单人视角的 Batch 预加载
    const p = roomData.players[uid];
    const ctxA = `ID(${uid}):${p.profile?.name}\nAct:${cA}`;
    const ctxB = `ID(${uid}):${p.profile?.name}\nAct:${cB}`;

    // 替换 Prompt
    let pmt = GAME_MASTER_PROMPT
        .replace('{{HISTORY}}', hist.join("\n"))
        .replace('{{IS_SCENE_CHANGE}}', forceIsChg)
        .replace('{{PLAYER_CONTEXT}}', `[分支A]:\n${ctxA}\n\n[分支B]:\n${ctxB}`) // 注入双份 Context
        .replace('{{IS_BATCH}}', 'true');

    // ... 通用替换 ...
    pmt = pmt.replace('{{GENRE}}', w.genre).replace('{{TONE}}', w.tone || "").replace('{{VOCAB_HP}}', w.vocab?.hp || "HP");

    try {
        console.log(`[DeepSeek] Generating batch...`);
        const text = await callDeepSeek(pmt);
        console.log(`[DeepSeek] Raw batch response length: ${text.length}`);

        const jsonStr = extractJSON(text);
        if (!jsonStr) throw new Error("No JSON found in AI batch response");
        const raw = JSON.parse(jsonStr);

        // 简单校验
        if (!raw.branch_A || !raw.branch_B) throw new Error("AI failed to generate branches");

        // 清洗 Key (防止 AI 幻觉生成错误的 UID Key)
        const cleanViewsA = {};
        Object.keys(raw.branch_A.views || {}).forEach(k => {
            const cleanKey = pIds.find(pid => k.includes(pid)) || k;
            cleanViewsA[cleanKey] = raw.branch_A.views[k];
        });
        raw.branch_A.views = cleanViewsA;

        const cleanViewsB = {};
        Object.keys(raw.branch_B.views || {}).forEach(k => {
            const cleanKey = pIds.find(pid => k.includes(pid)) || k;
            cleanViewsB[cleanKey] = raw.branch_B.views[k];
        });
        raw.branch_B.views = cleanViewsB;

        return raw;
    } catch (e) {
        console.error("Gemini Batch Error:", e);
        throw e; // Re-throw to be caught by handler's main try-catch
    }
}

// 2. Single Mode (用于实时生成)
async function runSingle(roomData, rid, uid, simChoice, isPre, forceIsChg) {
    const pIds = Object.keys(roomData.players || {});
    const hist = (roomData.history || []).slice(-3);
    // 逻辑判定：是否换场
    const isChg = forceIsChg !== undefined
        ? forceIsChg
        : (((roomData.turn || 0) - (roomData.last_scene_change || 0) >= (2 + Math.floor(Math.random() * 3))) || (roomData.turn === 0));

    let ctx = "";
    pIds.forEach(pid => {
        const p = roomData.players[pid];
        const c = (isPre && pid === uid) ? simChoice : (p.choice || "进入区域");
        ctx += `ID(${pid}):${p.profile?.name}[${p.profile?.role}]\nState:${JSON.stringify(p.profile?.public)}\nAct:${c}\n\n`;
    });

    // 动态裁剪 Prompt：如果是单模式，把 Batch 相关说明去掉，防止 AI 犯蠢输出双分支
    let basePrompt = GAME_MASTER_PROMPT;
    if (!isPre) {
        // 移除关于 [预加载模式] 的说明 (Line 8-14 in prompt_bank.js)
        basePrompt = basePrompt.replace(/8\. \[预加载模式\]:[\s\S]*?互不干扰\。/, "");
        // 移除关于 JSON 双分支的示例
        basePrompt = basePrompt.replace(/\/\/ 如果是双分支模式 \(IS_BATCH=true\):[\s\S]*?\}/, "");
    }

    let pmt = basePrompt
        .replace('{{HISTORY}}', hist.join("\n"))
        .replace('{{IS_SCENE_CHANGE}}', isChg)
        .replace('{{PLAYER_CONTEXT}}', ctx)
        .replace('{{IS_BATCH}}', 'false');

    // ... 通用替换 ...
    const w = roomData.world_setting || {
        genre: "Cyberpunk",
        tone: "Neon, Rain, High Tech Low Life",
        vocab: { hp: "HP" }
    };
    pmt = pmt.replace('{{GENRE}}', w.genre).replace('{{TONE}}', w.tone || "").replace('{{VOCAB_HP}}', w.vocab?.hp || "HP");



    // ... Inside runSingle ...
    try {
        console.log(`[DeepSeek] Generating single...`);
        const text = await callDeepSeek(pmt);
        console.log(`[DeepSeek] Raw single response length: ${text.length}`);
        console.log(`[DeepSeek] Raw response:`, text);

        const jsonStr = extractJSON(text);
        if (!jsonStr) {
            console.error("[DeepSeek] Invalid Response Preview:", text.substring(0, 500));
            throw new Error("No JSON found in AI single response");
        }

        // 尝试解析
        const raw = JSON.parse(jsonStr);


        // 清洗 Key (防止 AI 幻觉生成错误的 UID Key)
        const cleanViews = {};
        Object.keys(raw.views || {}).forEach(k => {
            const cleanKey = pIds.find(pid => k.includes(pid)) || k;
            cleanViews[cleanKey] = raw.views[k];
        });
        raw.views = cleanViews;

        return raw;
    } catch (e) {
        console.error("Gemini Single Error:", e);
        throw e; // Re-throw to be caught by handler's main try-catch
    }
}