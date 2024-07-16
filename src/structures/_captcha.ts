import type { CaptchaSolver } from 'discord.js-selfbot-v13';
import { createLogger } from '@structures/logger';
import config from '@../config.json';
import { Solver } from '2captcha';

const logger = createLogger('Client', 'Captcha');
const solver = new Solver(config.captcha.key);

interface Captcha {
	captcha_sitekey: string;
	captcha_rqdata?: string;
}

const solve: CaptchaSolver = async (captcha: Captcha, userAgent: string) => {
	return solver.hcaptcha(captcha.captcha_sitekey, 'discord.com', {
		invisible: 1,
		userAgent,
		data: captcha.captcha_rqdata,
	}).then(res => res.data);
};

export default { solve };