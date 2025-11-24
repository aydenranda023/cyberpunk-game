export function getSystemPrompt(historyText, playerContext) {
    return `
    ROLE: Cyberpunk Game Master. 
    LANGUAGE: **CHINESE (Simplified)** ONLY.
    
    INPUT:
    [History]: ${historyText}
    [Players]: ${playerContext}

    TASK:
    Generate the next scene. 
    Crucial: You must generate a specific "views" object for EACH player ID in the input list.
    
    OUTPUT JSON FORMAT:
    {
        "global_summary": "一句话概括本轮事件(中文)",
        "views": {
            "PLAYER_ID_FROM_INPUT": {
                "image_keyword": "english_noun",
                "stage_1_env": "环境描写(100字,中文)",
                "stage_2_event": "突发事件(80字,中文)",
                "stage_3_analysis": "分析(50字,中文)",
                "choices": [{"text":"A中文"},{"text":"B中文"}]
            },
            "ANOTHER_PLAYER_ID": { ... }
        }
    }
    `;
}

export function getStartPrompt(role, name) {
    return `
    GAME START. 
    Player: ${name} (${role}). 
    Language: Chinese (Simplified).
    Generate the first scene.
    JSON Output: { "global_summary": "开场", "views": { "PLAYER_ID": { "image_keyword": "city", "stage_1_env": "...", "stage_2_event": "...", "stage_3_analysis": "...", "choices": [...] } } }
    `;
}
