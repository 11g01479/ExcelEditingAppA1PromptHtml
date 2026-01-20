
import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileSpreadsheet, Download, RefreshCw, Play, AlertCircle, FileText, BookOpen, Zap } from 'lucide-react';
import { AppStatus, LogEntry } from './types';
import { initPyodide, extractA1AndColumns, runPythonTransformation } from './services/pyodideService';
import { generateExcelEditCode } from './services/geminiService';
import { Terminal } from './components/Terminal';

const MAX_DAILY_USES = 20; // Increased daily limit as Flash is cheaper/faster
const STORAGE_KEY = 'excel_autopilot_usage_v3';

const App: React.FC = () => {
  const [status, setStatus] = useState<AppStatus>(AppStatus.IDLE);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [inputFile, setInputFile] = useState<File | null>(null);
  const [a1Instruction, setA1Instruction] = useState<string>("");
  const [generatedCode, setGeneratedCode] = useState<string>("");
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [remainingUses, setRemainingUses] = useState<number>(MAX_DAILY_USES);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addLog = (message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { timestamp: new Date(), message, type }]);
  };

  useEffect(() => {
    const boot = async () => {
      try {
        setStatus(AppStatus.BOOTING_PYTHON);
        addLog("Python環境(Pyodide)を初期化中...", 'info');
        await initPyodide((msg) => addLog(msg, 'info'));
        setStatus(AppStatus.IDLE);
        addLog("システム準備完了。Excelファイルをアップロードしてください。", 'success');
      } catch (e: any) {
        setStatus(AppStatus.ERROR);
        setErrorMsg("Python環境のロードに失敗しました。ページをリロードしてください。");
        addLog(`重大なエラー: ${e.message}`, 'error');
      }
    };
    boot();
  }, []);

  useEffect(() => {
    const today = new Date().toDateString();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { date, count } = JSON.parse(stored);
        if (date === today) {
          setRemainingUses(Math.max(0, MAX_DAILY_USES - count));
        } else {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: 0 }));
          setRemainingUses(MAX_DAILY_USES);
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: 0 }));
        setRemainingUses(MAX_DAILY_USES);
      }
    } catch (e) {
      setRemainingUses(MAX_DAILY_USES);
    }
  }, []);

  const consumeUsage = () => {
    const today = new Date().toDateString();
    const currentUsed = MAX_DAILY_USES - remainingUses;
    const newUsed = currentUsed + 1;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: newUsed }));
    setRemainingUses(Math.max(0, MAX_DAILY_USES - newUsed));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
  };

  const processFile = async (file: File) => {
    if (remainingUses <= 0) {
      setErrorMsg("本日の生成回数の上限に達しました。明日またお試しください。");
      setStatus(AppStatus.ERROR);
      return;
    }

    setInputFile(file);
    setOutputBlob(null);
    setGeneratedCode("");
    setA1Instruction("");
    setErrorMsg(null);
    
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      setStatus(AppStatus.READING_FILE);
      addLog(`ファイル読み込み中: ${file.name}...`, 'info');
      
      const { a1, columns } = await extractA1AndColumns(file);
      
      if (!a1 || a1.trim() === "" || a1 === "None") {
        addLog("警告: A1セルに指示が見つかりませんでした。", 'warning');
        setA1Instruction("(指示なし)");
        throw new Error("ExcelファイルのA1セルに「何をしたいか」を入力してアップロードしてください。");
      } else {
        addLog(`指示を検出: "${a1}"`, 'success');
        setA1Instruction(a1);
      }

      setStatus(AppStatus.GENERATING_CODE);
      addLog("Gemini 3 Flash に指示を送信中...", 'info');
      consumeUsage();

      const code = await generateExcelEditCode(a1, columns);
      setGeneratedCode(code);
      addLog("Pythonコードが生成されました。", 'success');
      
      setStatus(AppStatus.EXECUTING_CODE);
      addLog("Pythonスクリプトを実行中...", 'info');
      
      const resultBlob = await runPythonTransformation(code, file, (msg) => addLog(msg, 'info'));
      
      setOutputBlob(resultBlob);
      setStatus(AppStatus.COMPLETED);
      addLog("すべての処理が完了しました！", 'success');

    } catch (e: any) {
      console.error(e);
      setStatus(AppStatus.ERROR);
      // Clean up technical error messages
      let displayError = e.message;
      if (displayError.includes('{"error"')) {
        try {
          const parsed = JSON.parse(displayError.split('failed: ')[1] || displayError);
          displayError = parsed.error.message || "不明なAPIエラーが発生しました。";
        } catch(err) {}
      }
      setErrorMsg(displayError);
      addLog(displayError, 'error');
    }
  };

  const handleDownload = () => {
    if (!outputBlob) return;
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement('a');
    a.href = url;
    const fileName = inputFile?.name.replace(/\.[^/.]+$/, "") || "output";
    a.download = `${fileName}_編集済み.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const isProcessing = [
    AppStatus.BOOTING_PYTHON, 
    AppStatus.READING_FILE, 
    AppStatus.ANALYZING_INSTRUCTION, 
    AppStatus.GENERATING_CODE, 
    AppStatus.EXECUTING_CODE
  ].includes(status);

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col p-4 md:p-8 font-sans">
      <header className="max-w-6xl mx-auto w-full mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-center md:text-left">
          <h1 className="text-3xl font-bold text-emerald-700 flex items-center gap-3 justify-center md:justify-start">
            <FileSpreadsheet className="w-10 h-10" />
            Excel Auto-Pilot
          </h1>
          <p className="text-gray-500 mt-1">AIがExcelファイルを解析・編集します</p>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="bg-white px-4 py-2 rounded-full border border-gray-200 shadow-sm flex items-center gap-2">
            <Zap className={`w-4 h-4 ${remainingUses > 0 ? 'text-amber-500' : 'text-gray-400'}`} />
            <div className="text-sm flex flex-col md:flex-row md:gap-1 leading-tight">
              <span className="text-gray-500 font-medium">本日残り:</span>
              <span className={`font-bold ${remainingUses > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {remainingUses}/{MAX_DAILY_USES}
              </span>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
        <div className="flex flex-col gap-6">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col gap-4">
            <h2 className="text-base font-bold text-gray-800 flex items-center gap-2">
              <BookOpen className="w-5 h-5 text-emerald-600" />
              使い方
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-center">
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-emerald-600 font-bold text-xl mb-1">1</div>
                <div className="text-xs text-gray-600">A1セルに指示を書く</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-emerald-600 font-bold text-xl mb-1">2</div>
                <div className="text-xs text-gray-600">ファイルをアップロード</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-emerald-600 font-bold text-xl mb-1">3</div>
                <div className="text-xs text-gray-600">完成版をダウンロード</div>
              </div>
            </div>
          </div>
          
          <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 ${remainingUses <= 0 ? 'opacity-75 grayscale' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-600" />
              ファイルをアップロード
            </h2>
            <div 
              className={`border-2 border-dashed rounded-lg p-10 text-center transition-all ${remainingUses <= 0 ? 'bg-gray-100 cursor-not-allowed border-gray-300' : isProcessing ? 'bg-gray-50 cursor-wait border-emerald-300' : 'hover:bg-emerald-50 hover:border-emerald-400 border-gray-300 cursor-pointer'}`}
              onClick={() => !isProcessing && remainingUses > 0 && fileInputRef.current?.click()}
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx" className="hidden" disabled={isProcessing || remainingUses <= 0} />
              {isProcessing ? (
                <div className="flex flex-col items-center">
                  <RefreshCw className="w-12 h-12 text-emerald-500 animate-spin mb-3" />
                  <span className="text-emerald-600 font-bold">AI処理中...</span>
                  <span className="text-xs text-gray-400 mt-2">ブラウザでPythonを実行しています</span>
                </div>
              ) : remainingUses <= 0 ? (
                <div className="flex flex-col items-center">
                  <AlertCircle className="w-12 h-12 text-red-400 mb-2" />
                  <span className="text-gray-600 font-medium">利用上限に達しました</span>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <div className="bg-emerald-100 p-4 rounded-full mb-3">
                    <FileSpreadsheet className="w-8 h-8 text-emerald-600" />
                  </div>
                  <span className="text-gray-700 font-bold">クリックして Excelファイル を選択</span>
                  <span className="text-xs text-gray-400 mt-2">対応形式: .xlsx (A1セルに指示が必要)</span>
                </div>
              )}
            </div>
          </div>

          {(a1Instruction || status === AppStatus.ERROR) && (
            <div className={`bg-white rounded-xl shadow-sm border p-6 animate-in fade-in duration-300 ${status === AppStatus.ERROR ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
              <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${status === AppStatus.ERROR ? 'text-red-700' : 'text-gray-800'}`}>
                {status === AppStatus.ERROR ? <AlertCircle className="w-5 h-5"/> : <FileText className="w-5 h-5 text-emerald-600" />}
                {status === AppStatus.ERROR ? "エラーが発生しました" : "検出された指示 (A1セル)"}
              </h2>
              {status === AppStatus.ERROR ? (
                <div className="text-red-600 bg-white border border-red-100 p-4 rounded text-sm font-medium shadow-sm">
                  {errorMsg}
                </div>
              ) : (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r shadow-inner">
                   <p className="text-gray-800 leading-relaxed font-medium">"{a1Instruction}"</p>
                </div>
              )}
            </div>
          )}

          {status === AppStatus.COMPLETED && (
            <div className="bg-emerald-600 rounded-xl shadow-lg p-6 animate-in zoom-in-95 duration-500">
              <div className="flex items-center gap-3 text-white mb-4">
                <div className="bg-white/20 p-2 rounded-full">
                  <Download className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold">処理が完了しました</h2>
                  <p className="text-emerald-100 text-sm">編集済みのファイルをダウンロードできます</p>
                </div>
              </div>
              <button onClick={handleDownload} className="w-full bg-white text-emerald-700 hover:bg-emerald-50 font-bold py-4 px-4 rounded-lg shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2">
                <Download className="w-5 h-5" />
                ファイルをダウンロードする
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-6 h-full min-h-[500px]">
          <Terminal logs={logs} className="flex-1 shadow-md" />
          {generatedCode && (
            <div className="bg-slate-900 rounded-xl shadow-xl border border-slate-700 overflow-hidden flex flex-col max-h-[350px]">
              <div className="bg-slate-800 px-4 py-3 flex items-center justify-between border-b border-slate-700">
                <span className="text-slate-300 text-xs font-mono font-bold flex items-center gap-2">
                  <Play className="w-3 h-3 text-emerald-400 fill-emerald-400" />
                  AIが生成したPythonスクリプト
                </span>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded border border-emerald-500/20 font-bold">Gemini 3 Flash</span>
              </div>
              <pre className="p-4 overflow-auto text-[11px] font-mono text-emerald-50/90 scrollbar-thin flex-1 bg-slate-900/50">
                <code>{generatedCode}</code>
              </pre>
            </div>
          )}
        </div>
      </main>
      
      <footer className="max-w-6xl mx-auto w-full mt-8 py-6 border-t border-gray-200 text-center text-gray-400 text-xs">
        <p>© 2024 Excel Auto-Pilot Engineer | Powered by Gemini 3 Flash & Pyodide</p>
      </footer>
    </div>
  );
};

export default App;
