import Client from '@structures/client';
import Event from '@structures/event';
import config from '@../config.json';
import { Guild } from 'discord.js';

class GuildJoin extends Event<'guildCreate'> {
	constructor(
		public client: Client
	) {
		super('guildCreate', client);
	}

	async handler(guild: Guild): Promise<void> {
		if (!guild.members.me.permissions.has('Administrator')) return;
		if (this.client.completedGuilds.includes(guild.id)) return;
		if (guild.memberCount <= config.memberThreshold) return;

		if (config.skipFullGuild) {
			const botIds = config.bots.map(b => b.botId);
			const contains = [];

			for (const bot of botIds) {
				const member = await guild.members.fetch(bot).catch(() => null);
				if (member) contains.push(bot);
			}

			if (botIds.every(bot => contains.includes(bot))) {
				return;
			}
		}

		this.client.logger.info('Queueing guild: ' + guild.id);
		this.client.queue.add(guild.id);
	}
}

export default GuildJoin;