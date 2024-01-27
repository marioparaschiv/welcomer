import { createLogger } from '@structures/logger';

class Queue<T> {
	instance = [];
	running = false;
	stopped = false;
	logger = createLogger('Queue');

	constructor(
		public onDrain: (item: T) => void
	) { }

	add(...items) {
		this.instance.push(...items);
		if (!this.running) this.drain();
	}

	remove(...items) {
		for (const item of items) {
			const idx = this.instance.indexOf(item);
			if (idx > -1) this.instance.splice(item, 1);
		}
	}

	stop() {
		this.stopped = true;
	}

	async drain() {
		this.running = true;

		while (this.instance.length && !this.stopped) {
			const item = this.instance.shift();
			try {
				await this.onDrain(item);
				this.logger.log(`${this.instance.length} items left in queue. State: ${this.stopped ? 'Stopped' : 'Active'}`);
			} catch (e) {
				console.error('Failed to drain!', e);
			}
		}

		this.running = false;
	}
}

export default Queue;