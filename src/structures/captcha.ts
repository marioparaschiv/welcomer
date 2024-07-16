import type { CaptchaSolver } from 'discord.js-selfbot-v13';
import { createLogger } from '@structures/logger';
import hCoptcha from '@structures/hcoptcha';
import config from '@../config.json';
import { Solver } from '2captcha';

const logger = createLogger('Client', 'Captcha');
let twoCaptchaSolver: Solver;

interface Captcha {
	captcha_sitekey: string;
	captcha_rqdata?: string;
}

const solve: CaptchaSolver = async (captcha: Captcha, userAgent: string) => {
	switch (config.captcha.service.toLowerCase()) {
		case 'hcoptcha':
			return solveHCoptcha(captcha, userAgent);
		case '2captcha':
			return solveTwoCaptcha(captcha, userAgent);
	}
};

const solveHCoptcha = async (captcha: Captcha, userAgent: string) => {
	const data = { result: null, attempts: 0, error: null };

	logger.info('Received captcha. Attempting to solve it...');

	while (true) {
		try {
			const result = await hCoptcha.solve({
				sitekey: captcha.captcha_sitekey,
				url: 'https://dsicord.com/',
				rqdata: captcha.captcha_rqdata,
				proxy: null,
				userAgent
			});

			data.result = result;
			break;
		} catch (error) {
			if (data.attempts >= 10) {
				logger.error(`Failed to solve captcha after 10 attempts.`);
				data.error = error;
				break;
			}

			data.attempts++;
			logger.error(`Failed to solve captcha. Retrying... (Attempt ${data.attempts}):`, error.message);
		}
	}

	if (!data.error) {
		logger.success('Captcha solved successfully.');
	} else {
		throw data.error;
	}

	return data.result;
};

const solveTwoCaptcha = async (captcha: Captcha, userAgent: string) => {
	twoCaptchaSolver ??= new Solver(config.captcha.key);

	return twoCaptchaSolver.hcaptcha(captcha.captcha_sitekey, 'discord.com', {
		invisible: 1,
		userAgent,
		data: captcha.captcha_rqdata,
	}).then(res => res.data);
};

export default { solve };