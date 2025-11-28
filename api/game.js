import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';
import { GAME_MASTER_PROMPT } from './lib/prompt_bank.js';

if (!admin.apps.length) {
    try {
        const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
        if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
        admin.initializeApp({ credential: admin.credential.cert(sa), databaseURL: process.env.FIREBASE_DB_URL });
    } catch (e) { console.error("Firebase Init Error", e); }
}

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status(500).json({ error: "DB Fail" });
    const db = admin.database();
    const { action, roomId, userId, choiceText, userProfile } = req.body;

    try {
        if (action === 'CREATE_ROOM') {
            const id = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + id).set({
                created_at: admin.database.ServerValue.TIMESTAMP, status: 'SOLO', turn: 0, last_scene_change: 0, players: {},
                host_info: userProfile || { name: 'Unknown', role: 'Ghost' }
            });
            return res.json({ roomId: id });
        }

        if (action === 'JOIN_ROOM') {
            const ref = db.ref('rooms/' + roomId);
            if (!(await ref.once('value')).exists()) return res.status(404).json({ error: "No Room" });
            await ref.child('players/' + userId).update({ joined: true, choice: null, profile: userProfile });
            return res.json({ success: true });
        }

        if (action === 'PRELOAD_TURN') {
            const ref = db.ref('rooms/' + roomId);
            const data = (await ref.once('value')).val();
            const choices = data?.current_scene?.[userId]?.choices;
            if (!choices) return res.json({ msg: "No choices" });

            const [resA, resB] = await Promise.all(choices.map(c => runGameLogic(db, roomId, userId, c.text, true)));
            await ref.child(`prebuffer/${userId}`).set({ [choices[0].text]: resA, [choices[1].text]: resB });
            return res.json({ status: "PRELOADED" });
        }

        if (action === 'START_GAME' || action === 'MAKE_MOVE') {
            const ref = db.ref('rooms/' + roomId);
            if (action === 'MAKE_MOVE') {
                const preSnap = await ref.child(`prebuffer/${userId}/${choiceText}`).once('value');
                if (preSnap.exists()) {
                    const preData = preSnap.val();
                    await ref.child('current_scene').set(preData.views);
                    await ref.child('history').push(`[事件] ${preData.global_summary}`);
                    await ref.child(`players/${userId}`).update({ choice: null });
                    await ref.child(`prebuffer/${userId}`).remove();
                    await ref.child('turn').transaction(t => (t || 0) + 1);
                    return res.json({ status: "NEW_TURN" });
                }
                await ref.child(`players/${userId}`).update({ choice: choiceText });
            }

            const data = (await ref.once('value')).val();
            const pIds = Object.keys(data.players || {});
            if (action === 'MAKE_MOVE' && !pIds.every(pid => data.players[pid].choice)) return res.json({ status: "WAITING" });

            const aiJson = await runGameLogic(db, roomId, userId, null, false);
            await ref.child('current_scene').set(aiJson.views);
            await ref.child('history').push(`[事件] ${aiJson.global_summary}`);

            const updates = {};
            for (const pid of pIds) {
                updates[`players/${pid}/choice`] = null;
                const view = aiJson.views[pid];
                if (view?.hp_change) {
                    let hp = (data.players[pid].profile.public.hp || 100) + view.hp_change;
                    if (hp < 0) hp = 0;
                    updates[`players/${pid}/profile/public/hp`] = hp;
                    if (hp <= 0) {
                        updates[`players/${pid}/dead`] = true;
                        await ref.child(`current_scene/${pid}/is_dead`).set(true);
                    }
                }
            }
            await ref.update(updates);

            const newTurn = (data.turn || 0) + 1;
            const updates2 = { turn: newTurn };
            if (Object.values(aiJson.views)[0]?.stage_1_env) updates2.last_scene_change = newTurn;
            await ref.update(updates2);

            if (action === 'START_GAME') await ref.update({ status: 'PLAYING' });
            return res.json({ status: "NEW_TURN" });
        }
        return res.status(400).json({ error: "Unknown Action" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function runGameLogic(db, roomId, userId, simChoice, isPreload) {
    const data = (await db.ref('rooms/' + roomId).once('value')).val();
    const pIds = Object.keys(data.players || {});
    const isSceneChange = ((data.turn || 0) - (data.last_scene_change || 0) >= (3 + Math.floor(Math.random() * 4))) || (data.turn === 0);
    const history = Object.values((await db.ref(`rooms/${roomId}/history`).once('value')).val() || {}).slice(-3);

    let ctx = "";
    pIds.forEach(pid => {
        const p = data.players[pid];
        const c = (isPreload && pid === userId) ? simChoice : (p.choice || "进入游戏");
        ctx += `ID(${pid}):${p.profile?.name}[${p.profile?.role}]\nState:${JSON.stringify(p.profile?.public)}\nSecret:${JSON.stringify(p.profile?.private)}\nAct:${c}\n\n`;
    });

    const prompt = GAME_MASTER_PROMPT
        .replace('{{HISTORY}}', history.join("\n"))
        .replace('{{IS_SCENE_CHANGE}}', isSceneChange)
        .replace('{{PLAYER_CONTEXT}}', ctx)
        .replace(/{{PREV_CHOICE}}/g, simChoice || "上轮行动");

    try {
        const txt = (await model.generateContent(prompt)).response.text();
        return JSON.parse(txt.match(/\{[\s\S]*\}/)[0]);
    } catch (e) {
        return { global_summary: "Error", views: { [userId]: { stage_2_event: "Connection Lost...", choices: [{ text: "Retry" }, { text: "Wait" }] } } };
    }
}
