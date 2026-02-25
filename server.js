import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件：解析 JSON 请求体和开启跨域
app.use(cors());
app.use(express.json());

// 静态文件托管（必须加上这一句，浏览器才能访问到 public 目录下的文件）
app.use(express.static('public'));

// 【核心数据结构】：基于 DAG 树状数据结构的多元宇宙状态机
// 内存数组用于存储所有的节点 (Node)，Phase 1 暂存本地内存中
let universeTree = [];

// 【根节点初始化】(仅供示例测试用)
// 游戏服务器启动时放入一个创世节点作为起点
const genesisNode = {
    node_id: "genesis_001",
    parent_id: null,
    universe_tag: "Cyberpunk",
    state_snapshot: {
        global_summary: "故事从夜之城的一个雨夜开始...",
        tension_level: 10,
        current_objective: "生存下去",
        key_facts: []
    },
    narrative_text: "霓虹灯闪烁，你站在阴暗的巷口，雨水刷洗着你破碎的义体...",
    player_status: {
        hp: 100,
        inventory: []
    }
};
universeTree.push(genesisNode);


// 核心算法：上下文溯源机制 (Context Retrieval)
// 根据传入的最末端 current_node_id，沿着 parent_id 向上查找最多 limit 个节点
function getHistoryChain(startNodeId, limit = 3) {
    let chain = [];
    let currentId = startNodeId;

    while (currentId && chain.length < limit) {
        // 在宇宙树中寻找对应的节点
        const node = universeTree.find(n => n.node_id === currentId);
        if (!node) break; // 找不到说明断链了或者到源头了

        // 插入到数组开头，保证最古老的在上，最新（当前）的在下
        chain.unshift(node);

        // 指针上移
        currentId = node.parent_id;
    }
    return chain;
}

// 【核心路由】：接收前端动作，调用 DeepSeek API 并解析返回的 JSON
app.post('/api/action', async (req, res) => {
    try {
        // 解构新的 payload 结构
        const { current_node_id, player_action, action_type = 'continue', target_universe } = req.body;

        if (!current_node_id || !player_action) {
            return res.status(400).json({ error: "缺少 current_node_id 或 player_action 参数" });
        }

        // 1. 获取当前操作锚点的节点状态 (最为最新世界状态)
        const currentNode = universeTree.find(n => n.node_id === current_node_id);
        if (!currentNode) {
            return res.status(404).json({ error: "未找到指定的起点节点(Universe Node)" });
        }

        // 2. 上下文溯源 (Context Retrieval) 提取最近 N 个回合作为纯净上下文
        const historyNodes = getHistoryChain(current_node_id, 3);
        const historyTextContext = historyNodes.map((n, idx) => {
            return `【历史回合 ${idx + 1} - 宇宙维度: ${n.universe_tag}】\n剧情描述: ${n.narrative_text}`;
        }).join('\n\n');

        // 3. 构建 System Prompt 和 User Prompt
        let systemPrompt = `你是一个掌控全局的地牢主宰 (DM)。
请根据玩家的动作，推进多元宇宙剧情，并强制严格返回符合以下结构的 JSON 格式数据：
{
  "director_notes": "DM的思考过程：分析当前局势和威胁...",
  "state_update": {
    "global_summary": "精简前情提要...",
    "tension_change": 20,
    "new_objective": "...",
    "new_facts": []
  },
  "views": {
    "narrative": "具体展现给玩家的剧情文本..."
  },
  "choices": [
    { "text": "必须要高度贴合当前情况的动态选项 A，字数简捷有力，例如：[拔枪反击]" },
    { "text": "必须要高度贴合当前情况的动态选项 B（代表不同的行动流派），例如：[寻找掩护并尝试黑入系统]" }
  ]
}
注意：每次生成的 choices 必须根据当前剧情变化，绝对不能重复旧的两个选项！`;

        // 根据不同的动作类型 (action_type) 注入特殊规则或修改目标 Tag
        let newUniverseTag = currentNode.universe_tag;
        let specialRules = "";

        if (action_type === 'jump') {
            if (!target_universe) {
                return res.status(400).json({ error: "执行 jump 必须提供 target_universe 参数" });
            }
            newUniverseTag = target_universe;
            specialRules = `\n\n【系统最高指令：维度跳跃触发！】
玩家试图从当前的 [${currentNode.universe_tag}] 宇宙，强行开启传送门跳跃到 [${target_universe}] 宇宙！
请在 \`views.narrative\` 中重点描写空间撕裂的感官冲击。必须保留玩家的残血和物品现状（从上下文中推断），但环境背景必须瞬间切换至目标宇宙 (${target_universe}) 的风格。`;
        }

        // 组装最终给 AI 的用户输入报文
        const userPrompt = `
======== 世界当前状态 ========
【当前环境】: ${currentNode.universe_tag}
【最近故事线记忆】：
${historyTextContext}
【DM备忘】：上回合结束时的紧张度是 ${currentNode.state_snapshot.tension_level}，玩家的目标是 ${currentNode.state_snapshot.current_objective}。

======== 玩家实时输入 ========
${specialRules}
[玩家动作]: ${player_action}

请严格输出 JSON！不需要输出包含 \`\`\`json\`\`\` 的代码块，直接输出 JSON 大括号结构！
`;

        // 4. 调用 DeepSeek API
        const response = await fetch('https://api.deepseek.com/chat/completions', {
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

        if (!response.ok) {
            const errorBody = await response.text();
            throw new Error(`DeepSeek API error: ${response.status} - ${errorBody}`);
        }

        const data = await response.json();

        // 提取 AI 生成的文本并解析为 JSON 对象
        const aiResponseText = data.choices[0].message.content;
        console.log("DeepSeek Raw Output:", aiResponseText);

        let aiParsedResult;
        try {
            aiParsedResult = JSON.parse(aiResponseText);
        } catch (e) {
            throw new Error("AI 返回的数据无法解析为合格的 JSON: " + aiResponseText);
        }

        // 5. 组装产生全新的节点 (Node)
        const newNodeId = `node_${Date.now()}`;

        // 【核心跳跃/分支逻辑】：只要新建节点的 parent_id 指向传进来的锚点，
        // 无论是顺流向下 (continue)，还是时间分叉回到过去 (branch)，或者跨维跳跃 (jump)
        // 就都完美契合了 DAG 树状追加原则！
        const newNode = {
            node_id: newNodeId,
            parent_id: current_node_id,
            universe_tag: newUniverseTag, // continue和branch继承旧tag，jump则已被修改为目标tag
            state_snapshot: {
                ...aiParsedResult.state_update,
                // 为了安全，强制继承并累加之前的数值（因为AI有时候会忘记计算累加）
                tension_level: Math.max(0, Math.min(100, currentNode.state_snapshot.tension_level + (aiParsedResult.state_update.tension_change || 0)))
            },
            narrative_text: aiParsedResult.views.narrative,
            choices: aiParsedResult.choices || [], // 【修复】必须把 AI 生成的动态选项保存进历史记录！
            player_status: {
                ...currentNode.player_status // Phase 2暂时简单继承玩家状态
            }
        };

        // 将新节点存入全局树中
        universeTree.push(newNode);

        // 6. 组装最终结果返回给前端
        res.status(200).json({
            success: true,
            node_created: newNode,
            ai_thoughts: aiParsedResult.director_notes
        });

    } catch (error) {
        console.error("处理动作期间发生错误:", error);
        res.status(500).json({
            success: false,
            error: "内部服务器错误或 JSON 解析失败",
            details: error.message
        });
    }
});


// 辅助路由：重置并清空宇宙树 (从零开始)
app.post('/api/debug/reset', (req, res) => {
    universeTree = [genesisNode];
    res.json({ success: true, message: "宇宙已重启" });
});

// 辅助路由：方便开发者在浏览器里直接查看 universeTree 的全貌
app.get('/api/debug/tree', (req, res) => {
    res.json({
        total_nodes: universeTree.length,
        tree_data: universeTree
    });
});


app.listen(PORT, () => {
    console.log(`===============================================`);
    console.log(` Neural Link (Phase 1 MVP) 宇宙引擎已启动 `);
    console.log(` 服务器运行在: http://localhost:${PORT}`);
    console.log(`===============================================`);
});
