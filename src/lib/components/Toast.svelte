<script lang="ts">
	import { fly } from 'svelte/transition';
	import { toastStore, type Toast } from '$lib/stores/toastStore';

	export let toast: Toast;

	function dismiss() {
		toastStore.remove(toast.id);
	}

	// Auto-dismiss after timeout
	if (toast.duration > 0) {
		setTimeout(dismiss, toast.duration);
	}
</script>

<div class="toast toast-{toast.type}" transition:fly={{ y: 50, duration: 300 }}>
	<div class="toast-content">
		{#if toast.type === 'success'}
			<span class="icon">✓</span>
		{:else if toast.type === 'error'}
			<span class="icon">✗</span>
		{:else if toast.type === 'warning'}
			<span class="icon">⚠</span>
		{:else}
			<span class="icon">ℹ</span>
		{/if}
		<div class="toast-message">
			{#if toast.title}
				<strong>{toast.title}</strong>
			{/if}
			{#if toast.description}
				<p>{toast.description}</p>
			{/if}
		</div>
		{#if toast.duration > 0}
			<button class="close-btn" on:click={dismiss}>×</button>
		{/if}
	</div>
	{#if toast.duration > 0}
		<div class="progress-bar" style="--duration: {toast.duration}ms"></div>
	{/if}
</div>
