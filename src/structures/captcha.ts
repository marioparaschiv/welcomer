import hCoptcha from '@structures/hcoptcha';
import { createLogger } from '@structures/logger';
import type { CaptchaSolver } from 'discord.js-selfbot-v13';

const logger = createLogger('Client', 'Captcha');

interface Captcha {
	captcha_sitekey: string;
	captcha_rqdata?: string;
}

const solve: CaptchaSolver = async (captcha: Captcha, userAgent: string) => {
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

export default { solve };