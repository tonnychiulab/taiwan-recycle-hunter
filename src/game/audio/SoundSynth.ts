export class SoundSynth {
	private ctx: AudioContext | null = null;
	private muted = false;

	public unlock(): void {
		if (typeof window === "undefined") return;
		if (!this.ctx) {
			const AudioCtx = window.AudioContext;
			if (!AudioCtx) return;
			this.ctx = new AudioCtx();
		}
		if (this.ctx.state === "suspended") {
			void this.ctx.resume();
		}
	}

	public setMuted(next: boolean): void {
		this.muted = next;
	}

	public isMuted(): boolean {
		return this.muted;
	}

	public playPickup(streak: number): void {
		const baseFreq = Math.min(880, 520 + streak * 36);
		this.tone(baseFreq, 0.08, "triangle", 0.14, 0);
		this.tone(baseFreq * 1.25, 0.11, "sine", 0.12, 0.055);
	}

	public playTriadOrDeposit(): void {
		const notes = [523.25, 659.25, 783.99, 1046.5];
		notes.forEach((freq, idx) => {
			this.tone(freq, 0.12, "triangle", 0.14, idx * 0.055);
		});
	}

	public playStopCleared(): void {
		this.tone(660, 0.07, "sine", 0.11, 0);
		this.tone(880, 0.1, "sine", 0.12, 0.07);
	}

	public playViolation(): void {
		this.tone(210, 0.15, "sawtooth", 0.15, 0);
		this.tone(165, 0.2, "sawtooth", 0.15, 0.12);
	}

	public playShutter(): void {
		this.tone(1400, 0.03, "square", 0.08, 0);
		this.tone(920, 0.04, "triangle", 0.07, 0.035);
	}

	private tone(
		freq: number,
		durationSec: number,
		wave: OscillatorType,
		gainPeak: number,
		delaySec: number,
	): void {
		if (this.muted || !this.ctx || this.ctx.state !== "running") return;
		const start = this.ctx.currentTime + delaySec;
		const osc = this.ctx.createOscillator();
		const gain = this.ctx.createGain();
		osc.type = wave;
		osc.frequency.setValueAtTime(freq, start);
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(gainPeak, start + 0.012);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
		osc.connect(gain);
		gain.connect(this.ctx.destination);
		osc.start(start);
		osc.stop(start + durationSec + 0.02);
	}
}
