import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fetch from 'node-fetch'; // Ensure fetch is available in Node

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

/**
 * PHASE 2 CORE DATA STRUCTURES
 */
let universeTree = [];
let eventLinesRegistry = {};

let initPromise = null;

async function generateGenesisNode() {
    try {
        console.log("Generating dynamic genesis node...");
        const systemPrompt = `你是一个高维叙事创世神。请构思一个极具张力的随机赛博朋克/科幻故事开局，并从中抽象出3个关键的基础事件线实体（建议包含1个人物，1个地点，1个物品或势力）。
请严格返回以下 JSON 格式：
{
  "narrative_text": "极具画面感的初始故事片段，包含环境文字和当前主要矛盾（50-100字）...",
  "event_lines": [
    {
      "name": "CHARACTER // [角色名]", 
      "color": "var(--track-char)", 
      "initial_state": "该实体当前的简短状态(5-10字)"
    },
    {
      "name": "LOCATION // [地点名]", 
      "color": "var(--track-loc)", 
      "initial_state": "当前状态"
    },
    {
      "name": "ITEM // [物品或势力名]", 
      "color": "var(--track-item)", 
      "initial_state": "当前状态"
    }
  ]
}
注意：color 字段请尽可能使用 var(--track-char), var(--track-loc), var(--track-item) 等预设变量。`;

        const aiResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: "生成一个新的宇宙纪元起点。" }
                ],
                response_format: { type: 'json_object' }
            })
        });

        const data = await aiResponse.json();
        if (!data.choices || !data.choices[0]) {
            console.error("Unexpected AI response in generateGenesisNode:", JSON.stringify(data, null, 2));
            throw new Error("Invalid AI response format");
        }
        const aiResult = JSON.parse(data.choices[0].message.content);

        eventLinesRegistry = {};
        const tracksState = {};
        const involvedTracks = [];

        aiResult.event_lines.forEach((line, index) => {
            const trackId = `track_${index}_${Date.now()}`;
            eventLinesRegistry[trackId] = {
                name: line.name,
                color: line.color,
                latest_node_id: "genesis_000",
                current_state: line.initial_state
            };
            tracksState[trackId] = line.initial_state;
            involvedTracks.push(trackId);
        });

        const genesisNode = {
            node_id: "genesis_000",
            parent_ids: [],
            universe_tag: "Cyberpunk",
            involved_tracks: involvedTracks,
            state_snapshot: {
                tension_level: 10,
                tracks_state: tracksState
            },
            narrative_text: "【系统初始化：新纪元开启】\n\n" + aiResult.narrative_text,
            director_notes: "根据高维指令，自发诞生了新宇宙的初始约束条件。"
        };

        universeTree = [genesisNode];
        console.log("Genesis node generated successfully.");
    } catch (e) {
        console.error("Failed to generate dynamic genesis node, using fallback:", e);
        fallbackStaticGenesis();
    }
}

function fallbackStaticGenesis() {
    eventLinesRegistry = {
        "track_v": { name: "CHARACTER // 维（V）", color: "var(--track-char)", latest_node_id: "genesis_000", current_state: "刚刚脱离荒坂追捕" },
        "track_arasaka": { name: "LOCATION // 荒坂塔废墟", color: "var(--track-loc)", latest_node_id: "genesis_000", current_state: "底层封锁中" },
        "track_relic": { name: "ITEM // 损坏的 Relic", color: "var(--track-item)", latest_node_id: "genesis_000", current_state: "防火墙稳固" }
    };
    universeTree = [{
        node_id: "genesis_000",
        parent_ids: [],
        universe_tag: "Cyberpunk",
        involved_tracks: ["track_v", "track_arasaka", "track_relic"],
        state_snapshot: {
            tension_level: 10,
            tracks_state: {
                "track_v": "刚刚脱离荒坂追捕",
                "track_arasaka": "底层封锁中",
                "track_relic": "防火墙稳固"
            }
        },
        narrative_text: "系统初始化：神经链路已建立。故事从夜之城的一个雨夜开始。你手持那块致命的芯片，站在荒坂塔的阴影下。",
        director_notes: "Fallback static genesis."
    }];
}

async function ensureInitialized() {
    if (universeTree.length > 0) return;
    if (!initPromise) {
        initPromise = generateGenesisNode();
    }
    await initPromise;
    initPromise = null;
}

/**
 * CONTEXT RETRIEVAL (Phase 2 Multi-Parent Logic)
 */
function getMultiContext(parentNodeIds) {
    let contextParts = [];
    parentNodeIds.forEach(id => {
        const node = universeTree.find(n => n.node_id === id);
        if (node) {
            contextParts.push(`[来源节点 ${id} / 类型: ${node.universe_tag}]\n历史描述: ${node.narrative_text}`);
        }
    });
    return contextParts.join('\n\n');
}

/**
 * CORE API: SYNTHESIZE ACTION
 */
app.post('/api/action', async (req, res) => {
    try {
        const { parent_node_ids, player_action, involved_tracks } = req.body;

        if (!parent_node_ids || !Array.isArray(parent_node_ids) || parent_node_ids.length === 0) {
            return res.status(400).json({ error: "必须提供 parent_node_ids 数组" });
        }

        // 1. ANOMALY DETECTION (检测是否使用了历史节点)
        let anomalies = [];
        involved_tracks.forEach(trackId => {
            const registry = eventLinesRegistry[trackId];
            if (registry) {
                // 如果传入的父节点中不包含该轨道的 latest_node_id，说明在提取“过去”的状态
                if (!parent_node_ids.includes(registry.latest_node_id)) {
                    anomalies.push(`[${registry.name}]`);
                }
            }
        });

        const anomalyWarning = anomalies.length > 0
            ? `\n\n【时空异常警告】：以下元素提取自过去的时空状态，请在叙事中以“回忆”、“数据库记录”或“回响”的形式圆场：${anomalies.join(', ')}`
            : "";

        // 2. CONTEXT BUILDING
        const historyContext = getMultiContext(parent_node_ids);

        // 提取参与轨道的当前状态供 AI 参考
        let currentStatesContext = involved_tracks.map(tid => {
            return `- ${eventLinesRegistry[tid]?.name || tid}: ${eventLinesRegistry[tid]?.current_state || "未知"}`;
        }).join('\n');

        const systemPrompt = `你是一个高维叙事指挥家。
玩家将多个实体（事件线）拖入合成釜进行剧情推演。
请严格返回以下 JSON 格式：
{
  "director_notes": "思考如何缝合这些元素...",
  "narrative_text": "合成后的高品质剧情文本...",
  "event_lines_update": {
    "track_id_xxx": "该实体在该剧情后的新状态简述 (5-10字)",
    "track_id_yyy": "..."
  },
  "tension_change": 15
}
注意：narrative_text 应该侧重于这些元素碰撞后的化学反应。`;

        const userPrompt = `
======== 参与合成的元素状态 ========
${currentStatesContext}

======== 历史脉络上下文 ========
${historyContext}
${anomalyWarning}

======== 指挥家指令 (玩家动作) ========
${player_action || "让这些元素自行发生反应"}

请严格输出 JSON！直接输出大括号结构。
`;

        const aiResponse = await fetch('https://api.deepseek.com/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.DEEPSEEK_API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                response_format: { type: 'json_object' }
            })
        });

        const data = await aiResponse.json();
        const aiResult = JSON.parse(data.choices[0].message.content);

        // 3. CREATE NEW CONVERGENCE NODE
        const newNodeId = `node_${Date.now()}`;
        const prevTension = universeTree.find(n => n.node_id === parent_node_ids[0])?.state_snapshot?.tension_level || 0;

        const newNode = {
            node_id: newNodeId,
            parent_ids: parent_node_ids,
            universe_tag: "Convergence",
            involved_tracks: involved_tracks,
            state_snapshot: {
                tension_level: Math.max(0, Math.min(100, prevTension + (aiResult.tension_change || 5))),
                tracks_state: { ...aiResult.event_lines_update }
            },
            narrative_text: aiResult.narrative_text,
            director_notes: aiResult.director_notes
        };

        // 4. UPDATE REGISTRY (反向写回)
        involved_tracks.forEach(tid => {
            if (eventLinesRegistry[tid]) {
                eventLinesRegistry[tid].latest_node_id = newNodeId;
                if (aiResult.event_lines_update[tid]) {
                    eventLinesRegistry[tid].current_state = aiResult.event_lines_update[tid];
                }
            }
        });

        universeTree.push(newNode);

        res.status(200).json({
            success: true,
            node_created: newNode
        });

    } catch (e) {
        console.error(e);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * DEBUG ROUTES
 */
app.get('/api/debug/tree', async (req, res) => {
    await ensureInitialized();
    // Dynamically build the event tracks based on the current universe tree
    const tracksData = Object.keys(eventLinesRegistry).map(trackId => {
        const trackDef = eventLinesRegistry[trackId];
        // Find all nodes that involve this track
        const trackNodes = universeTree.filter(n => n.involved_tracks && n.involved_tracks.includes(trackId));

        return {
            id: trackId,
            name: trackDef.name,
            color: trackDef.color,
            nodes: trackNodes.map((n, index) => {
                let nodeTitle = n.state_snapshot?.tracks_state?.[trackId];
                if (!nodeTitle) {
                    if (index === 0) {
                        nodeTitle = trackDef.current_state;
                    } else {
                        // 寻找尽可能有意义的文本作为状态显示，截取前10个字
                        const fallbackText = n.director_notes || n.narrative_text || "状态演进";
                        nodeTitle = fallbackText.substring(0, 10) + "...";
                    }
                }
                return {
                    id: n.node_id,
                    title: nodeTitle,
                    // Generate a generic sequential timeX for layout purposes (can be improved later)
                    timeX: 10 + (index * 25)
                };
            })
        };
    });

    res.json({
        total_nodes: universeTree.length,
        tree_data: universeTree,
        registry: eventLinesRegistry,
        event_lines: tracksData
    });
});

app.post('/api/debug/reset', async (req, res) => {
    universeTree = []; // Clear tree
    eventLinesRegistry = {};
    await ensureInitialized(); // Generate new genesis
    res.json({ success: true, message: "宇宙已重置并重新生成了初始起点" });
});

app.listen(PORT, async () => {
    console.log(`Neural Link Phase 2 Engine running at http://localhost:${PORT}`);
    await ensureInitialized(); // Start generating initial node quietly in the background
});
