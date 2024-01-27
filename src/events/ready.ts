import Client from '@structures/client';
import Event from '@structures/event';
import config from '@../config.json';
import { Guild } from 'discord.js';

class Ready extends Event<'ready'> {
	constructor(
		public client: Client
	) {
		super('ready', client);
	}

	async handler(): Promise<void> {
		this.client.logger.success(`Logged in as ${this.client.user.tag}.`);
		const botIds = config.bots.map(b => b.botId);

		const guilds = this.client.guilds.cache
			.filter(guild => !this.client.completedGuilds.includes(guild.id))
			.filter(guild => guild.mfaLevel === 0)
			.filter(guild => guild.memberCount > config.memberThreshold)
			.values();

		const res: Guild[] = [];

		for (const guild of guilds) {
			if (!guild.members.me) {
				await guild.members.fetchMe({ force: true });
			}

			if (guild.members.me.permissions.has('Administrator')) {
				if (config.skipFullGuild) {
					for (const bot of botIds) {
						const member = await guild.members.fetch(bot).catch(() => null);
						if (!member) {
							res.push(guild);
						}
					}
				} else {
					res.push(guild);
				}
			};
		}


		const guildIds = res.map((guild: Guild) => guild.id);
		this.client.logger.info(`Queueing ${guildIds.length} guilds.`);
		this.client.queue.add(...guildIds);
	}
}

export default Ready;