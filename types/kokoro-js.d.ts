/**
 * Minimal ambient type declaration for kokoro-js.
 * The package ships ./types/kokoro.d.ts but tsconfig.node.json uses
 * moduleResolution:"node" which does not read package.json#exports.
 */
declare module "kokoro-js" {
  export interface KokoroAudio {
    audio: Float32Array;
    sampling_rate: number;
    save(path: string): Promise<void>;
  }

  export interface KokoroTTSOptions {
    dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
    device?: string;
  }

  export interface GenerateOptions {
    voice?: string;
  }

  export class KokoroTTS {
    static from_pretrained(model: string, options?: KokoroTTSOptions): Promise<KokoroTTS>;
    generate(text: string, options?: GenerateOptions): Promise<KokoroAudio>;
  }
}
