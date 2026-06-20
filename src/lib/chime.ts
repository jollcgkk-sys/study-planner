/**
 * Robust synthesized chime using Web Audio API for cross-browser reliability.
 * Avoids any external audio file downloads.
 */
export const playNotificationChime = () => {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();
    
    // Harmonious melody: C5 (Do) -> E5 (Mi) -> G5 (Sol) -> C6 (Do octave)
    const playNote = (frequency: number, startTime: number, duration: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency, startTime);
      
      // Gentle volume spike then exponential fade
      gain.gain.setValueAtTime(0.12, startTime);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    playNote(523.25, now, 0.3);       // C5
    playNote(659.25, now + 0.12, 0.3); // E5
    playNote(783.99, now + 0.24, 0.4); // G5
    playNote(1046.50, now + 0.36, 0.5); // C6
  } catch (err) {
    console.warn("Failed to play audio chime:", err);
  }
};
