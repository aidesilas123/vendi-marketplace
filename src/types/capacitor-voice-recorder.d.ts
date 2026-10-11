declare module 'capacitor-voice-recorder' {
  export interface GenericResponse {
    value: boolean;
  }

  export interface CurrentRecordingStatus {
    status: 'RECORDING' | 'PAUSED' | 'NONE';
  }

  export interface RecordingData {
    value: {
      recordDataBase64?: string;
      msDuration: number;
      mimeType: string;
      path?: string;
    };
  }

  export interface VoiceRecorderPlugin {
    canDeviceVoiceRecord(): Promise<GenericResponse>;
    requestAudioRecordingPermission(): Promise<GenericResponse>;
    hasAudioRecordingPermission(): Promise<GenericResponse>;
    startRecording(options?: any): Promise<GenericResponse>;
    stopRecording(): Promise<RecordingData>;
    pauseRecording(): Promise<GenericResponse>;
    resumeRecording(): Promise<GenericResponse>;
    getCurrentStatus(): Promise<CurrentRecordingStatus>;
  }

  export const VoiceRecorder: VoiceRecorderPlugin;
}
