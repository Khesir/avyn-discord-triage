import { describe, expect, it } from 'vitest';
import { buildDiscordPostUrl } from './discordLink';

/**
 * Verifies the direct-link format (PRD user story 13 / issue 005:
 * `https://discord.com/channels/{guildId}/{postId}`) is built from the
 * specific post's own guildId/postId — not hardcoded to one server/forum.
 */
describe('buildDiscordPostUrl', () => {
  it('builds a discord.com channels link from the post guildId and postId', () => {
    const url = buildDiscordPostUrl({ guildId: 'guild-1', postId: 'thread-1' });

    expect(url).toBe('https://discord.com/channels/guild-1/thread-1');
  });

  it('builds a different link for a different post on a different server', () => {
    const url = buildDiscordPostUrl({ guildId: 'guild-2', postId: 'thread-2' });

    expect(url).toBe('https://discord.com/channels/guild-2/thread-2');
  });
});
