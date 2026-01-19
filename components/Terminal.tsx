import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';
import { Terminal as TerminalIcon } from 'lucide-react';

interface TerminalProps {
  logs: LogEntry[];
  className?: string;
}

export const Terminal: React.FC<TerminalProps> = ({ logs, className }) => {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className={`flex flex-col bg-[#1e1e1e] rounded-lg shadow-lg overflow-hidden border border-gray-700 font-mono text-sm ${className}`}>
      <div className="flex items-center gap-2 px-4 py-2 bg-[#2d2d2d] border-b border-gray-700">
        <TerminalIcon className="w-4 h-4 text-gray-400" />
        <span className="text-gray-400 font-semibold text-xs uppercase tracking-wider">システムログ (System Log)</span>
      </div>
      <div className="flex-1 p-4 overflow-y-auto max-h-[300px] scrollbar-thin">
        {logs.length === 0 && (
          <div className="text-gray-500 italic">処理開始を待機しています...</div>
        )}
        {logs.map((log, index) => (
          <div key={index} className="mb-1 break-words">
            <span className="text-gray-600 mr-2 text-xs">
              [{log.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' })}]
            </span>
            <span
              className={`
                ${log.type === 'error' ? 'text-red-400 font-bold' : ''}
                ${log.type === 'success' ? 'text-green-400' : ''}
                ${log.type === 'warning' ? 'text-yellow-400' : ''}
                ${log.type === 'code' ? 'text-blue-300' : ''}
                ${log.type === 'info' ? 'text-gray-300' : ''}
              `}
            >
              {log.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};