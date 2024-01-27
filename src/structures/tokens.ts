import { createLogger } from '@structures/logger';
import Client from '@structures/client';
import path from 'path';
import os from 'os';
import fs from 'fs';

class Tokens {
	paths: { unused: string; used: string; invalid: string; };
	logger = createLogger('User Tokens');

	invalid: string[] = [];
	tokens: string[] = [];
	used: string[] = [];

	constructor(
		public client: Client
	) {
		const state = path.join(__dirname, '..', '..', 'state');
		if (!fs.existsSync(state)) fs.mkdirSync(state);

		this.paths = {
			unused: path.join(state, 'userTokens.txt'),
			used: path.join(state, 'usedUserTokens.txt'),
			invalid: path.join(state, 'invalidUserTokens.txt')
		};

		if (fs.existsSync(this.paths.unused)) {
			try {
				const content = fs.readFileSync(this.paths.unused, 'utf-8');
				const parsed = content.split(/\r?\n/).filter(Boolean);

				this.tokens = parsed;
			} catch (e) {
				this.logger.error('Failed to load userTokens.txt:', e);
			}
		}

		if (fs.existsSync(this.paths.used)) {
			try {
				const content = fs.readFileSync(this.paths.used, 'utf-8');
				const parsed = content.split(/\r?\n/).filter(Boolean);

				this.used = parsed;
			} catch (e) {
				this.logger.error('Failed to load usedUserTokens.txt:', e);
			}
		}

		if (fs.existsSync(this.paths.invalid)) {
			try {
				const content = fs.readFileSync(this.paths.invalid, 'utf-8');
				const parsed = content.split(/\r?\n/).filter(Boolean);

				this.invalid = parsed;
			} catch (e) {
				this.logger.error('Failed to load invalidUserTokens.txt:', e);
			}
		}
	}

	getNext() {
		const token = this.tokens.shift();
		this.used.push(token);
		this.persist();

		return token;
	}

	add(token: string) {
		this.tokens.push(token);
	}

	invalidate(token: string) {
		const idx = this.tokens.indexOf(token);
		if (idx > -1) this.tokens.splice(idx, 1);

		const idx2 = this.used.indexOf(token);
		if (idx2 > -1) this.used.splice(idx2, 1);

		this.invalid.push(token);
		this.persist();
	}

	persist() {
		fs.writeFileSync(this.paths.invalid, this.invalid.join(os.EOL));
		fs.writeFileSync(this.paths.used, this.used.join(os.EOL));
		fs.writeFileSync(this.paths.unused, this.tokens.join(os.EOL));
	}
}

export default Tokens;