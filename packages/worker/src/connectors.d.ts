export interface ConnectorEnv {
    INSTAGRAM_ACCESS_TOKEN?: string;
    TIKTOK_ACCESS_TOKEN?: string;
    YOUTUBE_ACCESS_TOKEN?: string;
    X_ACCESS_TOKEN?: string;
    FACEBOOK_ACCESS_TOKEN?: string;
    REDDIT_ACCESS_TOKEN?: string;
    THREADS_ACCESS_TOKEN?: string;
    DISCORD_BOT_TOKEN?: string;
    TELEGRAM_BOT_TOKEN?: string;
    SNAPCHAT_ACCESS_TOKEN?: string;
    FANVUE_MCP_TOKEN?: string;
    FANVUE_MODEL_ID?: string;
}
/** Register every real connector; a missing token is a valid (closed) state. */
export declare function registerConnectors(env?: ConnectorEnv): void;
//# sourceMappingURL=connectors.d.ts.map