#!/usr/bin/env node

/**
 * Slack MCP Server (TypeScript)
 * Security-hardened fork: DMs and group DMs are blocked
 *
 * Supports two authentication methods:
 * 1. Browser tokens: SLACK_MCP_XOXC_TOKEN + SLACK_MCP_XOXD_TOKEN
 * 2. User OAuth: SLACK_TOKEN (xoxp-*)
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";

// Types
interface Channel {
  id: string;
  name: string;
  is_private: boolean;
  is_im: boolean;
  is_mpim: boolean;
  topic?: string;
  purpose?: string;
  num_members?: number;
}

interface User {
  id: string;
  name: string;
  real_name: string;
}

// Environment - Support both browser tokens and OAuth
const XOXC_TOKEN = process.env.SLACK_MCP_XOXC_TOKEN;
const XOXD_TOKEN = process.env.SLACK_MCP_XOXD_TOKEN;
const XOXP_TOKEN = process.env.SLACK_TOKEN || process.env.SLACK_MCP_XOXP_TOKEN;

const ADD_MESSAGE_ENABLED = process.env.SLACK_MCP_ADD_MESSAGE_TOOL === "true" ||
                            process.env.SLACK_MCP_ADD_MESSAGE_TOOL === "1";
const ALLOWED_CHANNELS = process.env.SLACK_MCP_ADD_MESSAGE_TOOL?.startsWith("C")
  ? process.env.SLACK_MCP_ADD_MESSAGE_TOOL.split(",")
  : null;

// Determine auth method
let AUTH_TOKEN: string;
let AUTH_COOKIE: string | undefined;

if (XOXC_TOKEN && XOXD_TOKEN) {
  console.error("[Slack MCP] Using browser tokens (xoxc/xoxd)");
  AUTH_TOKEN = XOXC_TOKEN;
  AUTH_COOKIE = `d=${XOXD_TOKEN}`;
} else if (XOXP_TOKEN) {
  console.error("[Slack MCP] Using OAuth token (xoxp)");
  AUTH_TOKEN = XOXP_TOKEN;
} else {
  console.error("Error: Provide either SLACK_MCP_XOXC_TOKEN + SLACK_MCP_XOXD_TOKEN, or SLACK_TOKEN (xoxp-*)");
  process.exit(1);
}

class SlackMcpServer {
  private server: Server;
  private http: AxiosInstance;
  private channelsById: Map<string, Channel> = new Map();
  private channelsByName: Map<string, Channel> = new Map();
  private usersById: Map<string, User> = new Map();
  private usersByName: Map<string, User> = new Map();
  private workspace: string = "";

  constructor() {
    this.server = new Server(
      { name: "yespark-slack-mcp-server", version: "1.0.0" },
      { capabilities: { tools: {}, resources: {} } }
    );

    // Setup HTTP client for Slack API
    this.http = axios.create({
      baseURL: "https://slack.com/api",
      headers: {
        "Authorization": `Bearer ${AUTH_TOKEN}`,
        "Content-Type": "application/json; charset=utf-8",
        ...(AUTH_COOKIE ? { "Cookie": AUTH_COOKIE } : {}),
      },
    });

    this.setupToolHandlers();
    this.setupResourceHandlers();

    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };
  }

  // Slack API helper
  private async slackApi(method: string, params: Record<string, any> = {}): Promise<any> {
    const response = await this.http.post(method, params);
    if (!response.data.ok) {
      throw new Error(`Slack API error: ${response.data.error}`);
    }
    return response.data;
  }

  // ============ SECURITY ============

  private isBlockedChannel(channelId: string, channelName?: string): boolean {
    // Block DMs (@username or D...)
    if (channelName?.startsWith("@")) return true;
    if (channelId.startsWith("D")) return true;

    // Block group DMs (G... that are MPIMs)
    const channel = this.channelsById.get(channelId);
    if (channel?.is_im || channel?.is_mpim) return true;

    return false;
  }

  private resolveChannelId(input: string): string {
    // Security check for @username format
    if (input.startsWith("@")) {
      throw new Error("Direct messages (@username) are not accessible for security reasons");
    }

    // Block D... IDs (DMs)
    if (input.startsWith("D")) {
      throw new Error("Direct messages (D...) are not accessible for security reasons");
    }

    // Resolve #channel-name to ID
    if (input.startsWith("#")) {
      const channel = this.channelsByName.get(input);
      if (!channel) throw new Error(`Channel ${input} not found`);
      if (channel.is_im || channel.is_mpim) {
        throw new Error("Direct messages are not accessible for security reasons");
      }
      return channel.id;
    }

    // Validate channel ID
    const channel = this.channelsById.get(input);
    if (channel && (channel.is_im || channel.is_mpim)) {
      throw new Error("Direct messages are not accessible for security reasons");
    }

    return input;
  }

  // ============ CACHE ============

  private async loadCache(): Promise<void> {
    console.error("[Slack MCP] Loading channels and users cache...");

    // Get workspace info
    const authTest = await this.slackApi("auth.test");
    this.workspace = authTest.team || "workspace";

    // Load channels (public + private, NOT DMs)
    let cursor: string | undefined;
    do {
      const result = await this.slackApi("conversations.list", {
        types: "public_channel,private_channel",
        limit: 1000,
        cursor,
      });

      for (const ch of result.channels || []) {
        const channel: Channel = {
          id: ch.id,
          name: `#${ch.name}`,
          is_private: ch.is_private || false,
          is_im: ch.is_im || false,
          is_mpim: ch.is_mpim || false,
          topic: ch.topic?.value,
          purpose: ch.purpose?.value,
          num_members: ch.num_members,
        };
        this.channelsById.set(channel.id, channel);
        this.channelsByName.set(channel.name, channel);
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    // Load users
    cursor = undefined;
    do {
      const result = await this.slackApi("users.list", { limit: 1000, cursor });

      for (const u of result.members || []) {
        if (u.deleted || u.is_bot) continue;
        const user: User = {
          id: u.id,
          name: u.name,
          real_name: u.real_name || u.name,
        };
        this.usersById.set(user.id, user);
        this.usersByName.set(`@${user.name}`, user);
      }

      cursor = result.response_metadata?.next_cursor;
    } while (cursor);

    console.error(`[Slack MCP] Loaded ${this.channelsById.size} channels, ${this.usersById.size} users`);
  }

  private getUserName(userId: string): string {
    const user = this.usersById.get(userId);
    return user?.real_name || user?.name || userId;
  }

  // ============ TOOLS ============

  private setupToolHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: "channels_list",
          description: "List Slack channels. DMs and group DMs are NOT accessible.",
          inputSchema: {
            type: "object",
            properties: {
              types: {
                type: "string",
                description: "Channel types: public_channel, private_channel (comma-separated)",
                default: "public_channel,private_channel",
              },
              limit: { type: "number", description: "Max results (default 100)", default: 100 },
            },
          },
        },
        {
          name: "conversations_history",
          description: "Get messages from a channel. DMs are NOT accessible.",
          inputSchema: {
            type: "object",
            properties: {
              channel_id: {
                type: "string",
                description: "Channel ID (C...) or name (#general). DMs (@user) NOT supported.",
              },
              limit: { type: "number", description: "Number of messages (default 50)", default: 50 },
              cursor: { type: "string", description: "Pagination cursor" },
            },
            required: ["channel_id"],
          },
        },
        {
          name: "conversations_replies",
          description: "Get thread replies. DMs are NOT accessible.",
          inputSchema: {
            type: "object",
            properties: {
              channel_id: { type: "string", description: "Channel ID or name" },
              thread_ts: { type: "string", description: "Thread timestamp" },
              limit: { type: "number", default: 50 },
              cursor: { type: "string" },
            },
            required: ["channel_id", "thread_ts"],
          },
        },
        {
          name: "conversations_search",
          description: "Search messages in channels. DMs are NOT searchable.",
          inputSchema: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query" },
              channel: { type: "string", description: "Filter by channel ID or #name" },
              from_user: { type: "string", description: "Filter by user ID or @name" },
              limit: { type: "number", default: 20 },
            },
            required: ["query"],
          },
        },
        {
          name: "conversations_add_message",
          description: "Post a message to a channel (disabled by default). DMs NOT supported.",
          inputSchema: {
            type: "object",
            properties: {
              channel_id: { type: "string", description: "Channel ID or #name" },
              text: { type: "string", description: "Message text (markdown supported)" },
              thread_ts: { type: "string", description: "Reply to thread (optional)" },
            },
            required: ["channel_id", "text"],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "channels_list":
            return await this.handleChannelsList(args);
          case "conversations_history":
            return await this.handleConversationsHistory(args);
          case "conversations_replies":
            return await this.handleConversationsReplies(args);
          case "conversations_search":
            return await this.handleConversationsSearch(args);
          case "conversations_add_message":
            return await this.handleAddMessage(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
      }
    });
  }

  private async handleChannelsList(args: any): Promise<any> {
    const types = (args?.types || "public_channel,private_channel")
      .split(",")
      .filter((t: string) => t === "public_channel" || t === "private_channel")
      .join(",");

    const limit = Math.min(args?.limit || 100, 1000);

    const channels: any[] = [];
    for (const [, channel] of this.channelsById) {
      // Security: Skip DMs
      if (channel.is_im || channel.is_mpim) continue;

      // Filter by type
      if (types.includes("public_channel") && !channel.is_private) {
        channels.push(channel);
      } else if (types.includes("private_channel") && channel.is_private) {
        channels.push(channel);
      }

      if (channels.length >= limit) break;
    }

    // Format as CSV
    const csv = ["id,name,topic,purpose,members"]
      .concat(channels.map(c =>
        `${c.id},${c.name},"${(c.topic || "").replace(/"/g, '""')}","${(c.purpose || "").replace(/"/g, '""')}",${c.num_members || 0}`
      ))
      .join("\n");

    return { content: [{ type: "text", text: csv }] };
  }

  private async handleConversationsHistory(args: any): Promise<any> {
    const channelId = this.resolveChannelId(args.channel_id);
    const limit = Math.min(args?.limit || 50, 100);

    const result = await this.slackApi("conversations.history", {
      channel: channelId,
      limit,
      cursor: args?.cursor,
    });

    const messages = (result.messages || []).map((m: any) => ({
      ts: m.ts,
      user: this.getUserName(m.user || ""),
      text: m.text,
      thread_ts: m.thread_ts,
      reactions: m.reactions?.map((r: any) => `${r.name}:${r.count}`).join("|"),
      cursor: "",
    }));

    if (messages.length > 0 && result.has_more) {
      messages[messages.length - 1].cursor = result.response_metadata?.next_cursor || "";
    }

    // Format as CSV
    const csv = ["ts,user,text,thread_ts,reactions,cursor"]
      .concat(messages.map((m: any) =>
        `${m.ts},"${m.user}","${(m.text || "").replace(/"/g, '""')}",${m.thread_ts || ""},"${m.reactions || ""}",${m.cursor}`
      ))
      .join("\n");

    return { content: [{ type: "text", text: csv }] };
  }

  private async handleConversationsReplies(args: any): Promise<any> {
    const channelId = this.resolveChannelId(args.channel_id);
    const limit = Math.min(args?.limit || 50, 100);

    const result = await this.slackApi("conversations.replies", {
      channel: channelId,
      ts: args.thread_ts,
      limit,
      cursor: args?.cursor,
    });

    const messages = (result.messages || []).map((m: any) => ({
      ts: m.ts,
      user: this.getUserName(m.user || ""),
      text: m.text,
      cursor: "",
    }));

    if (messages.length > 0 && result.has_more) {
      messages[messages.length - 1].cursor = result.response_metadata?.next_cursor || "";
    }

    const csv = ["ts,user,text,cursor"]
      .concat(messages.map((m: any) =>
        `${m.ts},"${m.user}","${(m.text || "").replace(/"/g, '""')}",${m.cursor}`
      ))
      .join("\n");

    return { content: [{ type: "text", text: csv }] };
  }

  private async handleConversationsSearch(args: any): Promise<any> {
    let query = args.query;

    // Add channel filter
    if (args.channel) {
      const channelId = this.resolveChannelId(args.channel);
      const channel = this.channelsById.get(channelId);
      if (channel) {
        query += ` in:${channel.name.replace("#", "")}`;
      }
    }

    // Add user filter
    if (args.from_user) {
      const userName = args.from_user.startsWith("@")
        ? args.from_user.substring(1)
        : this.usersById.get(args.from_user)?.name || args.from_user;
      query += ` from:${userName}`;
    }

    const result = await this.slackApi("search.messages", {
      query,
      count: Math.min(args?.limit || 20, 100),
    });

    const matches = result.messages?.matches || [];
    const messages = matches.map((m: any) => ({
      ts: m.ts,
      channel: `#${m.channel?.name || "unknown"}`,
      user: m.user || m.username || "",
      text: m.text,
    }));

    const csv = ["ts,channel,user,text"]
      .concat(messages.map((m: any) =>
        `${m.ts},"${m.channel}","${m.user}","${(m.text || "").replace(/"/g, '""')}"`
      ))
      .join("\n");

    return { content: [{ type: "text", text: csv }] };
  }

  private async handleAddMessage(args: any): Promise<any> {
    // Security: Check if enabled
    if (!ADD_MESSAGE_ENABLED && !ALLOWED_CHANNELS) {
      throw new Error(
        "Message posting is disabled. Set SLACK_MCP_ADD_MESSAGE_TOOL=true or to a list of channel IDs."
      );
    }

    const channelId = this.resolveChannelId(args.channel_id);

    // Security: Check channel whitelist
    if (ALLOWED_CHANNELS && !ALLOWED_CHANNELS.includes(channelId)) {
      throw new Error(`Posting to channel ${channelId} is not allowed.`);
    }

    const result = await this.slackApi("chat.postMessage", {
      channel: channelId,
      text: args.text,
      thread_ts: args.thread_ts,
      mrkdwn: true,
    });

    return {
      content: [{ type: "text", text: `Message posted: ts=${result.ts}, channel=${result.channel}` }],
    };
  }

  // ============ RESOURCES ============

  private setupResourceHandlers(): void {
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: `slack://${this.workspace}/channels`,
          name: "Slack Channels Directory",
          mimeType: "text/csv",
          description: "List of all accessible channels (DMs excluded)",
        },
        {
          uri: `slack://${this.workspace}/users`,
          name: "Slack Users Directory",
          mimeType: "text/csv",
          description: "List of all workspace users",
        },
      ],
    }));

    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri.endsWith("/channels")) {
        const channels = Array.from(this.channelsById.values())
          .filter((c) => !c.is_im && !c.is_mpim);

        const csv = ["id,name,topic,purpose,members"]
          .concat(channels.map(c =>
            `${c.id},${c.name},"${(c.topic || "").replace(/"/g, '""')}","${(c.purpose || "").replace(/"/g, '""')}",${c.num_members || 0}`
          ))
          .join("\n");

        return { contents: [{ uri, mimeType: "text/csv", text: csv }] };
      }

      if (uri.endsWith("/users")) {
        const users = Array.from(this.usersById.values());
        const csv = ["id,name,real_name"]
          .concat(users.map(u => `${u.id},${u.name},"${u.real_name}"`))
          .join("\n");

        return { contents: [{ uri, mimeType: "text/csv", text: csv }] };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  // ============ START ============

  async start(): Promise<void> {
    await this.loadCache();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error(`[Slack MCP] Server started for workspace: ${this.workspace}`);
  }
}

// Main
const server = new SlackMcpServer();
server.start().catch((error) => {
  console.error("[Slack MCP] Fatal error:", error);
  process.exit(1);
});
