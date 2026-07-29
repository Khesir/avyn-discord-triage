import { app, BrowserWindow, ipcMain, shell, utilityProcess } from 'electron';
import path from 'node:path';
import { SecretStore } from './store/secretStore';
import { ConfigStore } from './store/configStore';
import { safeStorageEncryptor } from './store/safeStorageEncryptor';
import { createSecretsHandlers } from './ipc/secretsHandlers';
import { createConfigHandlers } from './ipc/configHandlers';
import { createBotHandlers } from './ipc/botHandlers';
import { createShellHandlers } from './ipc/shellHandlers';
import { createWindowControlsHandlers } from './ipc/windowControlsHandlers';
import { createGitHubHandlers } from './ipc/githubHandlers';
import { createGitHubClient } from './github/githubClient';
import { getSecretsFilePath, getConfigFilePath } from './paths';
import { BotProcessManager } from './bot/botProcessManager';
import { BOT_LOG_CHANNEL, BOT_PULLED_POSTS_CHANNEL, BOT_STATUS_CHANNEL } from '../shared/ipcTypes';
import type { BotLogLine, BotStatusEvent, PulledPost } from '../shared/ipcTypes';

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 960,
    height: 700,
    show: false,
    // Frameless (010): the OS-native titlebar is replaced by the renderer's
    // own custom titlebar (see Titlebar.tsx), wired to real window behavior
    // via the window:minimize/maximize/close IPC channels below.
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  });

  window.once('ready-to-show', () => window.show());

  window.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}

/** Broadcasts a bot log line to every open renderer window's live console panel. */
function broadcastBotLog(line: BotLogLine): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(BOT_LOG_CHANNEL, line);
  }
}

/** Broadcasts a completed scan's pulled posts to every open renderer window's post list. */
function broadcastPulledPosts(posts: PulledPost[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(BOT_PULLED_POSTS_CHANNEL, posts);
  }
}

/** Broadcasts a bot connection-status change to every open renderer window's status indicator. */
function broadcastBotStatus(event: BotStatusEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(BOT_STATUS_CHANNEL, event);
  }
}

/**
 * Forks the bot's utility process with piped stdio (PRD: "forked with
 * stdio: 'pipe', exposing .stdout/.stderr as readable streams on the main
 * process"). Points at the botProcess entry built as its own bundle (see
 * electron.vite.config.ts) rather than main/index.ts's own app-lifecycle code.
 */
function forkBotProcess() {
  return utilityProcess.fork(path.join(__dirname, 'bot/botProcess.js'), [], { stdio: 'pipe' });
}

app.whenReady().then(() => {
  const secretStore = new SecretStore(getSecretsFilePath(), safeStorageEncryptor);
  const configStore = new ConfigStore(getConfigFilePath());

  // Bot process lifecycle is bound to the app's lifecycle (PRD: "the bot only runs while the Electron app itself
  // is running"). Starts as soon as a bot token is available — either already saved from a previous session
  // (below) or the moment onboarding saves one this session (see the secrets:save handler) — start() is
  // idempotent, so it's a no-op if the process is already running.
  const botProcessManager = new BotProcessManager({
    fork: forkBotProcess,
    onLog: broadcastBotLog,
    // Persist every scan's results before broadcasting them — without this, pulled posts only ever lived
    // in the renderer's React state and a refresh/restart silently lost the whole list even though the
    // posts were already marked 👀 on Discord (see ConfigStore.appendPulledPosts / ScanPanel's hydration).
    onPulledPosts: (posts) => {
      configStore.appendPulledPosts(posts);
      broadcastPulledPosts(posts);
    },
    onStatus: broadcastBotStatus
  });
  const discordBotToken = secretStore.get('discordBotToken');
  if (discordBotToken) {
    // Forwards the last-persisted presence (019) so BotService reapplies it once the client is
    // ready, rather than silently resetting to Discord's own default appearance on every launch.
    botProcessManager.start(discordBotToken, configStore.getBotPresence());
  }

  const secretsHandlers = createSecretsHandlers(secretStore);
  ipcMain.handle('secrets:get', () => secretsHandlers.get());
  ipcMain.handle('secrets:save', async (_event, payload) => {
    const result = await secretsHandlers.save(payload);
    // Onboarding just saved a Discord bot token — start the bot now rather than waiting for the next app
    // launch (start() is idempotent, so this is a no-op if it's already running from a previous session).
    botProcessManager.start(payload.discordBotToken.trim(), configStore.getBotPresence());
    return result;
  });

  const configHandlers = createConfigHandlers(configStore);
  ipcMain.handle('forumConfig:list', () => configHandlers.list());
  ipcMain.handle('forumConfig:add', (_event, mapping) => configHandlers.add(mapping));
  ipcMain.handle('forumConfig:remove', (_event, forumChannelId) => configHandlers.remove(forumChannelId));

  const shellHandlers = createShellHandlers(shell);
  ipcMain.handle('shell:openExternal', (_event, url) => shellHandlers.openExternal(url));

  // GitHub issue creation (008): direct REST API call using the stored PAT and the repo mapped to the
  // post's forumChannelId, no `gh` CLI (PRD: "shelling out to the gh CLI was evaluated and rejected").
  const githubClient = createGitHubClient();
  const githubHandlers = createGitHubHandlers(githubClient, configStore, secretStore);
  ipcMain.handle('github:createIssue', (_event, payload) => githubHandlers.createIssue(payload));

  const botHandlers = createBotHandlers(botProcessManager, configStore);
  ipcMain.handle('bot:scan', (_event, options) => botHandlers.scan(options));
  ipcMain.handle('bot:sendRemark', (_event, threadId, text) => botHandlers.sendRemark(threadId, text));
  ipcMain.handle('bot:setStatus', (_event, postId, starterMessageId, status) =>
    botHandlers.setStatus(postId, starterMessageId, status)
  );
  ipcMain.handle('bot:getStatus', () => botHandlers.getStatus());
  ipcMain.handle('bot:getPulledPosts', () => botHandlers.getPulledPosts());
  ipcMain.handle('bot:getForumNames', (_event, forumChannelIds) => botHandlers.getForumNames(forumChannelIds));
  ipcMain.handle('bot:setPresence', (_event, status, statusMessage) => botHandlers.setPresence(status, statusMessage));
  ipcMain.handle('bot:getPresence', () => botHandlers.getPresence());

  app.on('before-quit', () => {
    botProcessManager.stop();
  });

  const window = createWindow();

  // Custom titlebar's window controls (010) — the renderer's Titlebar
  // component invokes these to replace the OS-native titlebar's
  // minimize/maximize/close, now that the window is frameless.
  const windowControlsHandlers = createWindowControlsHandlers(window);
  ipcMain.handle('window:minimize', () => windowControlsHandlers.minimize());
  ipcMain.handle('window:maximize', () => windowControlsHandlers.toggleMaximize());
  ipcMain.handle('window:close', () => windowControlsHandlers.close());

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
