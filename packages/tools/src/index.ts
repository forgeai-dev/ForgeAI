export { BaseTool } from './base.js';
export type { ToolParameter, ToolDefinition, ToolResult } from './base.js';

export { ToolRegistry, createToolRegistry } from './registry.js';

export { WebBrowserTool } from './tools/web-browser.js';
export { FileManagerTool } from './tools/file-manager.js';
export { CronSchedulerTool } from './tools/cron-scheduler.js';
export type { TaskCallback } from './tools/cron-scheduler.js';
export { CodeRunnerTool } from './tools/code-runner.js';
export { KnowledgeBaseTool } from './tools/knowledge-base.js';
export { PuppeteerBrowserTool } from './tools/puppeteer-browser.js';
export { ShellExecTool } from './tools/shell-exec.js';
export { DesktopAutomationTool } from './tools/desktop-automation.js';
export { ImageGeneratorTool } from './tools/image-generator.js';
export { WebSearchTool } from './tools/web-search.js';
export { SessionsListTool, SessionsHistoryTool, SessionsSendTool, setAgentManagerRef } from './tools/session-tools.js';
export { SandboxManager, createSandboxManager } from './sandbox-manager.js';
export type { SandboxConfig, SandboxResult } from './sandbox-manager.js';
export { GitHubIntegration, createGitHubIntegration } from './integrations/github-integration.js';
export type { GitHubConfig, GitHubIssue, GitHubPR } from './integrations/github-integration.js';
export { RSSFeedManager, createRSSFeedManager } from './integrations/rss-feed.js';
export type { RSSFeed, RSSItem } from './integrations/rss-feed.js';
export { GmailIntegration, createGmailIntegration } from './integrations/gmail-integration.js';
export type { GmailConfig, GmailMessage, GmailSendOptions, GmailSearchOptions } from './integrations/gmail-integration.js';
export { CalendarIntegration, createCalendarIntegration } from './integrations/calendar-integration.js';
export type { CalendarConfig, CalendarEvent, CreateEventOptions, CalendarListEntry } from './integrations/calendar-integration.js';
export { NotionIntegration, createNotionIntegration } from './integrations/notion-integration.js';
export type { NotionConfig, NotionPage, NotionDatabase, NotionBlock, NotionSearchResult } from './integrations/notion-integration.js';
export { HomeAssistantIntegration, createHomeAssistantIntegration } from './integrations/homeassistant-integration.js';
export type { HomeAssistantConfig, HAEntity, HAScene } from './integrations/homeassistant-integration.js';
export { SmartHomeTool, setHomeAssistantRef, getHomeAssistantRef } from './tools/smart-home.js';

import { ToolRegistry } from './registry.js';
import { WebBrowserTool } from './tools/web-browser.js';
import { FileManagerTool } from './tools/file-manager.js';
import { CronSchedulerTool } from './tools/cron-scheduler.js';
import { CodeRunnerTool } from './tools/code-runner.js';
import { KnowledgeBaseTool } from './tools/knowledge-base.js';
import { PuppeteerBrowserTool } from './tools/puppeteer-browser.js';
import { ShellExecTool } from './tools/shell-exec.js';
import { DesktopAutomationTool } from './tools/desktop-automation.js';
import { ImageGeneratorTool } from './tools/image-generator.js';
import { WebSearchTool } from './tools/web-search.js';
import { SessionsListTool, SessionsHistoryTool, SessionsSendTool } from './tools/session-tools.js';
import { SmartHomeTool } from './tools/smart-home.js';
import type { AuditLogger } from '@forgeai/security';

export function createDefaultToolRegistry(auditLogger?: AuditLogger): ToolRegistry {
  const registry = new ToolRegistry(auditLogger);

  registry.register(new WebBrowserTool());
  registry.register(new FileManagerTool());
  registry.register(new CronSchedulerTool());
  registry.register(new CodeRunnerTool());
  registry.register(new KnowledgeBaseTool());
  registry.register(new PuppeteerBrowserTool());
  registry.register(new ShellExecTool());
  registry.register(new DesktopAutomationTool());
  registry.register(new ImageGeneratorTool());
  registry.register(new WebSearchTool());
  registry.register(new SessionsListTool());
  registry.register(new SessionsHistoryTool());
  registry.register(new SessionsSendTool());
  registry.register(new SmartHomeTool());

  return registry;
}
