// 知らせる音。Web Audio でその場で作る（音のファイルは同梱しない。公開リポジトリでライセンスを気にしなくてよいように）。
// AudioContext は鳴らすときに作り、鳴り終えたら閉じる。音のために何かを回し続けることはしない。

import type { SoundType } from '../shared/settings.js';
import type { AlertReason } from './model.js';

interface Note {
  /** 高さ（Hz） */
  freq: number;
  /** 鳴らし始める時刻（秒） */
  at: number;
  /** 消えるまでの長さ（秒） */
  length: number;
}

/** 音の種類ごとの音符。対応待ちは上がる高めの音、完了は下がる低めの音 */
const NOTES: Record<SoundType, Record<AlertReason, Note[]>> = {
  chime: {
    waiting: [{ freq: 880, at: 0, length: 0.6 }, { freq: 1318.5, at: 0.16, length: 0.9 }],
    done: [{ freq: 784, at: 0, length: 0.6 }, { freq: 523.3, at: 0.16, length: 0.9 }],
  },
  bell: {
    waiting: [{ freq: 1046.5, at: 0, length: 1.8 }],
    done: [{ freq: 587.3, at: 0, length: 1.8 }],
  },
  pop: {
    waiting: [{ freq: 1100, at: 0, length: 0.14 }, { freq: 1100, at: 0.18, length: 0.14 }],
    done: [{ freq: 660, at: 0, length: 0.18 }],
  },
};

/** 鐘らしく聞こえる、整数倍からずれた倍音（倍率と強さ） */
const BELL_PARTIALS = [[1, 1], [2.76, 0.4], [5.4, 0.2], [8.93, 0.1]] as const;

/** 1 つの正弦波を、すぐ立ち上がって指数的に消える形で鳴らす */
function tone(ctx: AudioContext, out: AudioNode, freq: number, start: number, length: number, level: number, drop = 1) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(freq, start);
  // ポンは、鳴らし始めに少し下がる
  if (drop !== 1) osc.frequency.exponentialRampToValueAtTime(freq * drop, start + length);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

function playNote(ctx: AudioContext, out: AudioNode, type: SoundType, note: Note) {
  const start = ctx.currentTime + note.at;
  switch (type) {
    case 'chime':
      tone(ctx, out, note.freq, start, note.length, 1);
      // 1 つ上のオクターブを薄く重ねて、柔らかい金属の響きにする
      tone(ctx, out, note.freq * 2, start, note.length * 0.5, 0.15);
      break;
    case 'bell':
      for (const [ratio, level] of BELL_PARTIALS) tone(ctx, out, note.freq * ratio, start, note.length / ratio ** 0.5, level);
      break;
    case 'pop':
      tone(ctx, out, note.freq, start, note.length, 1, 0.7);
      break;
  }
}

/** 音を鳴らす。volume は 0〜100（%）。0 なら何もしない */
export function playSound(type: SoundType, reason: AlertReason, volume: number) {
  if (volume <= 0) return;
  const notes = NOTES[type][reason];
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return;
  }
  const master = ctx.createGain();
  // 耳で聞いた大きさがつまみの位置に近くなるよう、2 乗にする。重ねても割れないよう全体を下げる
  master.gain.value = (volume / 100) ** 2 * 0.4;
  master.connect(ctx.destination);
  for (const note of notes) playNote(ctx, master, type, note);
  const end = Math.max(...notes.map((n) => n.at + n.length));
  setTimeout(() => void ctx.close(), (end + 0.3) * 1000);
}
