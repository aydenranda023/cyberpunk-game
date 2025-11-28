import { GoogleGenerativeAI } from "@google/generative-ai";
import admin from 'firebase-admin';
import { GAME_MASTER_PROMPT } from './lib/prompt_bank.js';

if (!admin.apps.length) {
    try {
        const s = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
        if (s.private_key) s.private_key = s.private_key.replace(/\\n/g, '\n');
        admin.initializeApp({ credential: admin.credential.cert(s), databaseURL: process.env.FIREBASE_DB_URL });
    } catch (e) { }
}

const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: "gemini-2.5-flash-lite" });

export default async function handler(req, res) {
    if (!admin.apps.length) return res.status(500).json({ error: "DB" });
    const db = admin.database(), { action: A, roomId: R, userId: U, choiceText: C, userProfile: P } = req.body;
    const ref = db.ref('rooms/' + R);

    try {
        if (A === 'CREATE_ROOM') {
            const id = Math.floor(1000 + Math.random() * 9000).toString();
            await db.ref('rooms/' + id).set({ created_at: admin.database.ServerValue.TIMESTAMP, status: 'SOLO', turn: 0, last_scene_change: 0, players: {}, host_info: P || { name: '?', role: '?' } });
            return res.json({ roomId: id });
        }
        if (A === 'JOIN_ROOM') {
            if (!(await ref.once('value')).exists()) return res.status(404).json({ error: "No Room" });
            await ref.child('current_scene').set(ai.views);
            await ref.child('history').push(`[事件] ${ai.global_summary}`);

            const u = {}, u2 = {};
            for (const pid of pIds) {
                u[`players/${pid}/choice`] = null;
                const v = ai.views[pid];
                if (v?.hp_change) {
                    let hp = (d.players[pid].profile.public.hp || 100) + v.hp_change;
                    u2[`players/${pid}/profile/public/hp`] = hp = hp < 0 ? 0 : hp;
                    if (hp <= 0) { u2[`players/${pid}/dead`] = true; await ref.child(`current_scene/${pid}/is_dead`).set(true); }
                }
            }
            await ref.update(u); if (Object.keys(u2).length) await ref.update(u2);

            const u3 = { turn: curTurn + 1, hp_change_occurred: hpChanged };
            if (isChg) {
                u3.last_scene_change = curTurn + 1;
                u3.next_scene_change = (curTurn + 1) + 3 + Math.floor(Math.random() * 4);
            }
            await ref.update(u3);

            if (A === 'START_GAME') await ref.update({ status: 'PLAYING' });
            return res.json({ status: "NEW_TURN" });
        }
        return res.status(400).json({ error: "?" });
    } catch (e) { return res.status(500).json({ error: e.message }); }
}

async function run(db, rid, uid, sim, isPre, forceIsChg) {
    const d = (await db.ref('rooms/' + rid).once('value')).val(), pIds = Object.keys(d.players || {});
    const isChg = forceIsChg !== undefined ? forceIsChg : (((d.turn || 0) - (d.last_scene_change || 0) >= (3 + Math.floor(Math.random() * 4))) || (d.turn === 0));
    const hist = Object.values((await db.ref(`rooms/${rid}/history`).once('value')).val() || {}).slice(-3);
    let ctx = "";
    pIds.forEach(pid => {
        const p = d.players[pid], c = (isPre && pid === uid) ? sim : (p.choice || "进入");
        ctx += `ID(${pid}):${p.profile?.name}[${p.profile?.role}]\nState:${JSON.stringify(p.profile?.public)}\nSecret:${JSON.stringify(p.profile?.private)}\nAct:${c}\n\n`;
    });
    const pmt = GAME_MASTER_PROMPT.replace('{{HISTORY}}', hist.join("\n")).replace('{{IS_SCENE_CHANGE}}', isChg).replace('{{PLAYER_CONTEXT}}', ctx);
    try { return JSON.parse((await model.generateContent(pmt)).response.text().match(/\{[\s\S]*\}/)[0]); }
    catch (e) { return { global_summary: "Err", views: { [uid]: { stage_2_event: "Error...", choices: [{ text: "Retry" }, { text: "Wait" }] } } }; }
}
