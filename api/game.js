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
            await ref.child('players/' + U).update({ joined: true, choice: null, profile: P });
            return res.json({ success: true });
        }
        if (A === 'PRELOAD_TURN') {
            const d = (await ref.once('value')).val(), cs = d?.current_scene?.[U]?.choices;
            if (!cs) return res.json({ msg: "No choices" });
            const [rA, rB] = await Promise.all(cs.map(c => run(db, R, U, c.text, true)));
            await ref.child(`prebuffer/${U}`).set({ [cs[0].text]: rA, [cs[1].text]: rB });
            return res.json({ status: "PRELOADED" });
        }
        if (A === 'START_GAME' || A === 'MAKE_MOVE') {
            if (A === 'MAKE_MOVE') {
                const pre = (await ref.child(`prebuffer/${U}/${C}`).once('value')).val();
                if (pre) {
                    await ref.child('current_scene').set(pre.views);
                    await ref.child('history').push(`[事件] ${pre.global_summary}`);
                    await ref.child(`players/${U}`).update({ choice: null });
                    await ref.child(`prebuffer/${U}`).remove();

                    // Update HP occurred flag from prebuffer if needed? 
                    // Prebuffer doesn't store room state updates like hp_change_occurred.
                    // We need to check the preloaded views for HP changes.
                    const d = (await ref.once('value')).val();
                    let hpChanged = d.hp_change_occurred || false;
                    const isChg = ((d.turn || 0) - (d.last_scene_change || 0) >= (3 + Math.floor(Math.random() * 4))) || (d.turn === 0); // Recalculating here might be risky if it differs from preload assumption, but preload views are fixed.
                    // Actually, if preload has env, it WAS a scene change.
                    const preIsChg = !!Object.values(pre.views)[0].stage_1_env;
                    if (preIsChg) hpChanged = false;

                    Object.values(pre.views).forEach(v => { if (v.hp_change) hpChanged = true; });

                    const nt = (d.turn || 0) + 1, u3 = { turn: nt, hp_change_occurred: hpChanged };
                    if (preIsChg) u3.last_scene_change = nt;

                    await ref.child('turn').transaction(t => (t || 0) + 1); // This transaction might conflict with u3 update? 
                    // Better to include turn in u3 and use update.
                    await ref.update(u3);

                    return res.json({ status: "NEW_TURN" });
                }
                await ref.child(`players/${U}`).update({ choice: C });
            }
            const d = (await ref.once('value')).val(), pIds = Object.keys(d.players || {});
            if (A === 'MAKE_MOVE' && !pIds.every(pid => d.players[pid].choice)) return res.json({ status: "WAITING" });

            const isChg = ((d.turn || 0) - (d.last_scene_change || 0) >= (3 + Math.floor(Math.random() * 4))) || (d.turn === 0);
            const ai = await run(db, R, U, null, false, isChg);

            let hpChanged = d.hp_change_occurred || false;
            if (isChg) hpChanged = false;

            if (!isChg) {
                Object.values(ai.views).forEach(v => { v.stage_1_env = null; v.location = null; });
            }

            Object.values(ai.views).forEach(v => {
                if (v.hp_change) {
                    if (hpChanged) v.hp_change = 0;
                    else hpChanged = true;
                }
            });

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

            const nt = (d.turn || 0) + 1, u3 = { turn: nt, hp_change_occurred: hpChanged };
            if (isChg) u3.last_scene_change = nt;
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
