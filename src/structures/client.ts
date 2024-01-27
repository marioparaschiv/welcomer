import CaptchaSolver from 'discord.js-selfbot-v13/src/rest/CaptchaSolver';
import { Client as DiscordJSClient } from 'discord.js';
import { createLogger } from '@structures/logger';
import Invitation from '@structures/invitation';
import Tokens from '@structures/tokens';
import Queue from '@structures/queue';
import config from '@../config.json';
import { sleep } from '@utilities';
import * as Events from '@events';
import path from 'path';
import fs from 'fs';

class Client extends DiscordJSClient {
	captcha = new CaptchaSolver('2captcha', config.captcha.key);
	queue = new Queue(this.onDrain.bind(this));
	invitation = new Invitation(this);
	tokens = new Tokens(this);
	completedGuilds = [];

	constructor(
		public logger = createLogger('Client')
	) {
		super({
			rest: {
				offset: 0,
				version: config.clientOptions.apiVersion
			},
			intents: ['Guilds'],
			shards: 'auto'
		});

		for (const event in Events) {
			const Event = Events[event];
			const instance = new Event(this);

			this.on(instance.name, instance.handler.bind(instance));
		}

		const state = path.resolve(__dirname, '..', '..', 'state');
		if (!fs.existsSync(state)) fs.mkdirSync(state);

		const completed = path.resolve(state, 'completed.json');
		if (config.useCompletionFile && fs.existsSync(completed)) {
			try {
				const content = fs.readFileSync(completed, 'utf-8');
				const json = JSON.parse(content);

				if (Array.isArray(json)) {
					// de-duplicate guild ids
					this.completedGuilds.push(...[...new Set(json)]);
				}
			} catch (e) {
				this.logger.error('Failed to load previously completed guilds:', e);
			}
		}
	}

	start() {
		this.login(config.botToken);
	}

	async onDrain(id: string) {
		try {
			this.logger.info(`Processing guild ${id}.`);

			if (!(await this.invitation.perform(id))) {
				this.queue.add(id);
				return this.logger.error('Failed to perform invitation on guild:', id);
			};

			this.completedGuilds.push(id);
			this.persist();

			if (config.queueSleepTime > 0) {
				this.logger.info(`Waiting for ${config.queueSleepTime}ms before continuing to process the queue.`);
				await sleep(config.queueSleepTime);
			}
		} catch (e) {
			this.logger.error('Failed to drain queue:', e);
		}
	}

	persist() {
		try {
			const state = path.join(__dirname, '..', '..', 'state');
			if (!fs.existsSync(state)) fs.mkdirSync(state);

			const completed = path.join(state, 'completed.json');
			// de-duplicate guild ids and write
			fs.writeFileSync(completed, JSON.stringify([...new Set(this.completedGuilds)], null, 2), 'utf-8');
		} catch (e) {
			this.logger.error('Failed to persist completed guilds:', e);
		}
	}
}

export default Client;