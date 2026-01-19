export enum AppStatus {
  IDLE = 'IDLE',
  BOOTING_PYTHON = 'BOOTING_PYTHON',
  READING_FILE = 'READING_FILE',
  ANALYZING_INSTRUCTION = 'ANALYZING_INSTRUCTION',
  GENERATING_CODE = 'GENERATING_CODE',
  EXECUTING_CODE = 'EXECUTING_CODE',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: Date;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error' | 'code';
}

export interface ExecutionResult {
  outputFileBlob?: Blob;
  logs: string[];
}
