import { createLogger } from '@structures/logger';
import config from '@../config.json';
import { sleep } from '@utilities';

interface SolveOptions {
	userAgent?: string;
	rqdata?: string;
	sitekey: string;
	proxy?: string;
	url: string;
}

const BASE_URL = 'https://api.hcoptcha.com/api/';
const logger = createLogger('hCoptcha');

export async function solve(options: SolveOptions) {
	const result = await fetch(BASE_URL + 'createTask', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'User-Agent': options.userAgent
		},
		body: JSON.stringify({
			task_type: 'hcaptchaEnterprise',
			api_key: config.captcha.key,
			data: options
		})
	});

	if (result.status !== 200) {
		const text = await result.text();
		logger.error(`Failed to create task with options:`, options, result.status, text);
		throw new Error('Captcha error: ' + text);
	}

	const json = await result.json();

	if (json.error) {
		logger.error(`Failed to create task with options:`, options, result.status, json);
		return null;
	}

	const task = json.task_id;

	while (true) {
		const status = await checkStatus(task);

		switch (status?.task?.state) {
			case 'completed': {
				return status.task.captcha_key;
			}

			case 'error': {
				logger.error('Got error while solving captcha, will retry:', status);
				return solve(options);
			}
		}

		// Check every 500ms
		await sleep(500);
	}
}

export async function checkStatus(taskId: string) {
	const result = await fetch(BASE_URL + 'getTaskData', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			api_key: config.captcha.key,
			task_id: taskId
		})
	});

	if (result.status !== 200) {
		logger.error(`Failed to check status for task ${taskId}:`, await result.text());
		return null;
	}

	return await result.json();
}

export default { solve, checkStatus };