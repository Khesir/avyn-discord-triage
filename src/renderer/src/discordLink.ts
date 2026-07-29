/**
 * Builds the direct Discord link for a pulled post (PRD user story 13: "a
 * direct link back to the original Discord post ... to view attachments/
 * images or read the full thread natively in Discord"). Discord resolves
 * `https://discord.com/channels/{guildId}/{channelId}` links to either the
 * installed desktop client or the web client, landing on the given
 * channel — here, the forum post's own thread channel (`postId`).
 *
 * Takes just the two fields it needs (not the full `PulledPost`) so it stays
 * easy to call from anywhere a post's identity is known.
 */
export function buildDiscordPostUrl(post: { guildId: string; postId: string }): string {
  return `https://discord.com/channels/${post.guildId}/${post.postId}`;
}
