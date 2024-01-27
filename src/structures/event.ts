import Client from '@structures/client';
import { ClientEvents } from 'discord.js';

class Event<T extends keyof ClientEvents> {
	constructor(
		public name: T,
		public client: Client
	) { };

	handler(...args: ClientEvents[T]) {
		this.client.logger.error(`This event is missing an implementation.`, new Error());
	}
}

export default Event;