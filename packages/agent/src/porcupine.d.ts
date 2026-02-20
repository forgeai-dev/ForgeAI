declare module '@picovoice/porcupine-node' {
  export enum BuiltinKeyword {
    ALEXA = 'alexa',
    AMERICANO = 'americano',
    BLUEBERRY = 'blueberry',
    BUMBLEBEE = 'bumblebee',
    COMPUTER = 'computer',
    GRAPEFRUIT = 'grapefruit',
    GRASSHOPPER = 'grasshopper',
    HEY_GOOGLE = 'hey_google',
    HEY_SIRI = 'hey_siri',
    JARVIS = 'jarvis',
    OK_GOOGLE = 'ok_google',
    PICOVOICE = 'picovoice',
    PORCUPINE = 'porcupine',
    TERMINATOR = 'terminator',
  }

  export class Porcupine {
    readonly frameLength: number;
    readonly sampleRate: number;
    constructor(accessKey: string, keywords: (BuiltinKeyword | string)[], sensitivities: number[]);
    process(pcm: Int16Array): number;
    release(): void;
  }
}
