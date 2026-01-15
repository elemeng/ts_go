import { writable } from 'svelte/store';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
	id: string;
	type: ToastType;
	title?: string;
	description: string;
	duration: number; // 0 for persistent
}

function createToastStore() {
	const { subscribe, update } = writable<Toast[]>([]);

	let toastId = 0;

	function add(toast: Omit<Toast, 'id'>) {
		const id = `toast-${++toastId}`;
		const newToast = { ...toast, id };

		update(toasts => [...toasts, newToast]);

		return id;
	}

	function remove(id: string) {
		update(toasts => toasts.filter(t => t.id !== id));
	}

	function clear() {
		update(() => []);
	}

	// Convenience methods
	function success(description: string, title?: string, duration = 3000) {
		return add({ type: 'success', title, description, duration });
	}

	function error(description: string, title?: string, duration = 5000) {
		return add({ type: 'error', title, description, duration });
	}

	function warning(description: string, title?: string, duration = 4000) {
		return add({ type: 'warning', title, description, duration });
	}

	function info(description: string, title?: string, duration = 3000) {
		return add({ type: 'info', title, description, duration });
	}

	return {
		subscribe,
		add,
		remove,
		clear,
		success,
		error,
		warning,
		info
	};
}

export const toastStore = createToastStore();