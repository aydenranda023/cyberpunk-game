// 这里的 prompt 专门用于生成 "罗生门" 多视角剧情
export function getMultiViewPrompt(historyList, playerContext) {
    return `
    你是一个赛博朋克文字游戏的主持人 (Game Master)。
    
    【绝对规则】
    1. **必须使用中文 (简体) 输出**。严禁使用英文描述剧情。
    2. 剧情风格：高科技、低生活、霓虹、暴力、哲学。
    3. **罗生门视角**：必须为 output 中的每个玩家 ID 生成独立的视角描述（第二人称“你”）。
    
    【输入信息】
    [历史概要]: ${historyList}
    [玩家列表与行动]:
    ${playerContext}

    【输出要求 JSON】
    {
        "global_summary": "一句话概括本轮发生的事件（用于存入历史，中文）",
        "views": {
            "玩家ID_1": {
                "image_keyword": "Extraction of a specific visual noun (English)",
                "stage_1_env": "环境描写(中文, 100字)",
                "stage_2_event": "突发事件(中文, 80字)",
                "stage_3_analysis": "分析与后果(中文, 50字)",
                "choices": [{"text":"选项A(中文)"},{"text":"选项B(中文)"}]
            },
            "玩家ID_2": { ...同上... }
        }
    }
    `;
}

export function getStartPrompt(role, name) {
    return `GAME START. Player is a ${role} named ${name}. Generate the first scene in Chinese (Simplified). Return standard JSON format with 'views' structure containing this single player.`;
}
