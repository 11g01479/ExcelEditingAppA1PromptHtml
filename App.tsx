import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileSpreadsheet, Download, RefreshCw, Play, AlertCircle, FileText, BookOpen, Zap } from 'lucide-react';
import { AppStatus, LogEntry } from './types';
import { initPyodide, extractA1AndColumns, runPythonTransformation } from './services/pyodideService';
import { generateExcelEditCode } from './services/geminiService';
import { Terminal } from './components/Terminal';

const MAX_DAILY_USES = 5;
const STORAGE_KEY = 'excel_autopilot_usage';

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

  // Initial boot
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
        setErrorMsg("Python環境のロードに失敗しました。");
        addLog(`重大なエラー: ${e.message}`, 'error');
      }
    };
    boot();
  }, []);

  // Load usage limit
  useEffect(() => {
    const today = new Date().toDateString();
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const { date, count } = JSON.parse(stored);
        if (date === today) {
          setRemainingUses(Math.max(0, MAX_DAILY_USES - count));
        } else {
          // Reset for new day
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: 0 }));
          setRemainingUses(MAX_DAILY_USES);
        }
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: today, count: 0 }));
        setRemainingUses(MAX_DAILY_USES);
      }
    } catch (e) {
      console.error("Failed to parse usage logs", e);
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
      setErrorMsg("本日の無料生成回数の上限に達しました。また明日お試しください。");
      setStatus(AppStatus.ERROR);
      return;
    }

    setInputFile(file);
    setOutputBlob(null);
    setGeneratedCode("");
    setA1Instruction("");
    setErrorMsg(null);
    
    // Reset inputs for next time
    if (fileInputRef.current) fileInputRef.current.value = "";

    try {
      setStatus(AppStatus.READING_FILE);
      addLog(`ファイル読み込み中: ${file.name}...`, 'info');
      
      const { a1, columns } = await extractA1AndColumns(file);
      
      if (!a1 || a1.trim() === "") {
        addLog("警告: A1セルが空のようです。", 'warning');
        setA1Instruction("(A1セルに指示が見つかりませんでした)");
      } else {
        addLog(`A1セルの指示を検出: "${a1}"`, 'success');
        setA1Instruction(a1);
      }

      setStatus(AppStatus.ANALYZING_INSTRUCTION);
      
      if (!process.env.API_KEY) {
         addLog("APIキーが見つかりません。Geminiを利用できません。", 'error');
         setErrorMsg("環境変数に Gemini API Key が設定されていません。");
         setStatus(AppStatus.ERROR);
         return;
      }

      addLog("Gemini AI にコンテキストを送信中...", 'info');
      
      // Deduct usage before calling AI
      consumeUsage();

      const code = await generateExcelEditCode(a1, columns);
      
      setGeneratedCode(code);
      addLog("Pythonコードが正常に生成されました。", 'success');
      
      setStatus(AppStatus.EXECUTING_CODE);
      addLog("ブラウザ内のサンドボックスでコードを実行中...", 'info');
      
      const resultBlob = await runPythonTransformation(code, file, (msg) => addLog(msg, 'info'));
      
      setOutputBlob(resultBlob);
      setStatus(AppStatus.COMPLETED);
      addLog("処理完了！ファイルをダウンロードできます。", 'success');

    } catch (e: any) {
      console.error(e);
      setStatus(AppStatus.ERROR);
      setErrorMsg(e.message);
      addLog(e.message, 'error');
    }
  };

  const handleDownload = () => {
    if (!outputBlob) return;
    const url = URL.createObjectURL(outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `edited_${inputFile?.name || 'output.xlsx'}`;
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
      
      {/* Header */}
      <header className="max-w-6xl mx-auto w-full mb-8 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="text-center md:text-left">
          <h1 className="text-3xl font-bold text-emerald-700 flex items-center gap-3 justify-center md:justify-start">
            <FileSpreadsheet className="w-10 h-10" />
            Excel自動編集パイロット
          </h1>
          <p className="text-gray-500 mt-1">AI搭載 Excel自動化エンジニア</p>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Usage Counter Badge */}
          <div className="bg-white px-4 py-2 rounded-full border border-gray-200 shadow-sm flex items-center gap-2">
            <Zap className={`w-4 h-4 ${remainingUses > 0 ? 'text-amber-500' : 'text-gray-400'}`} />
            <div className="text-sm flex flex-col md:flex-row md:gap-1 leading-tight">
              <span className="text-gray-500 font-medium">本日残り回数:</span>
              <span className={`font-bold ${remainingUses > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {remainingUses}/{MAX_DAILY_USES}
              </span>
            </div>
          </div>

          <span className={`hidden md:inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold ${
             status === AppStatus.BOOTING_PYTHON ? 'bg-yellow-100 text-yellow-800' : 'bg-emerald-100 text-emerald-800'
           }`}>
             {status === AppStatus.BOOTING_PYTHON ? (
               <>Python起動中...</>
             ) : (
               <>Python準備完了</>
             )}
           </span>
        </div>
      </header>

      <main className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-2 gap-6 flex-1">
        
        {/* Left Column: Input & Controls */}
        <div className="flex flex-col gap-6">

          {/* Guide Card */}
          <div className="bg-blue-50 rounded-xl shadow-sm border border-blue-100 p-5">
            <h2 className="text-base font-bold text-blue-800 mb-3 flex items-center gap-2">
              <BookOpen className="w-5 h-5" />
              利用ガイド
            </h2>
            <ol className="text-sm text-blue-900 space-y-2 list-decimal list-inside">
              <li>Excelファイルを開き、最初のシートを選択します。</li>
              <li><strong>A1セル</strong>に、やりたい処理（例：「C列の値を2倍にする」「空行を削除」）を入力して保存します。</li>
              <li>下のフォームからファイルをアップロードします。</li>
              <li>AIが指示を理解し、自動的にPythonコードを生成・実行して編集します。</li>
            </ol>
          </div>
          
          {/* Upload Card */}
          <div className={`bg-white rounded-xl shadow-sm border border-gray-200 p-6 ${remainingUses <= 0 ? 'opacity-75 grayscale' : ''}`}>
            <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <Upload className="w-5 h-5 text-emerald-600" />
              Excelファイルをアップロード
            </h2>
            
            <div 
              className={`
                border-2 border-dashed rounded-lg p-8 text-center transition-colors
                ${remainingUses <= 0 
                  ? 'bg-gray-100 border-gray-300 cursor-not-allowed' 
                  : isProcessing 
                    ? 'bg-gray-50 border-gray-300 cursor-wait' 
                    : 'hover:bg-emerald-50 hover:border-emerald-400 border-gray-300 cursor-pointer'
                }
              `}
              onClick={() => {
                if (!isProcessing && remainingUses > 0) {
                  fileInputRef.current?.click();
                }
              }}
            >
              <input 
                type="file" 
                ref={fileInputRef} 
                onChange={handleFileChange} 
                accept=".xlsx" 
                className="hidden" 
                disabled={isProcessing || remainingUses <= 0}
              />
              {isProcessing ? (
                <div className="flex flex-col items-center animate-pulse">
                  <RefreshCw className="w-10 h-10 text-emerald-500 animate-spin mb-2" />
                  <span className="text-gray-500 font-medium">処理中...</span>
                </div>
              ) : remainingUses <= 0 ? (
                <div className="flex flex-col items-center">
                  <AlertCircle className="w-12 h-12 text-gray-400 mb-2" />
                  <span className="text-gray-600 font-medium">本日の上限に達しました</span>
                  <span className="text-xs text-gray-500 mt-1">また明日ご利用ください</span>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <FileSpreadsheet className="w-12 h-12 text-gray-400 mb-2" />
                  <span className="text-gray-600 font-medium">クリックして .xlsx を選択</span>
                  <span className="text-xs text-gray-400 mt-1">ブラウザ内のPythonで安全に処理されます</span>
                </div>
              )}
            </div>
          </div>

          {/* Status / A1 Display */}
          {(a1Instruction || status === AppStatus.ERROR) && (
            <div className={`bg-white rounded-xl shadow-sm border p-6 ${status === AppStatus.ERROR ? 'border-red-200 bg-red-50' : 'border-gray-200'}`}>
              <h2 className={`text-lg font-semibold mb-3 flex items-center gap-2 ${status === AppStatus.ERROR ? 'text-red-700' : 'text-gray-800'}`}>
                {status === AppStatus.ERROR ? <AlertCircle className="w-5 h-5"/> : <FileText className="w-5 h-5 text-emerald-600" />}
                {status === AppStatus.ERROR ? "エラーが発生しました" : "指示を検出"}
              </h2>
              
              {status === AppStatus.ERROR ? (
                <p className="text-red-600 bg-red-100 p-3 rounded text-sm font-mono">{errorMsg}</p>
              ) : (
                <div className="bg-amber-50 border-l-4 border-amber-400 p-4 rounded-r">
                   <p className="text-xs font-bold text-amber-800 uppercase tracking-wide mb-1">A1セルの内容</p>
                   <p className="text-gray-800 italic">"{a1Instruction}"</p>
                </div>
              )}
            </div>
          )}

          {/* Download Card (Only when done) */}
          {status === AppStatus.COMPLETED && (
            <div className="bg-emerald-50 rounded-xl shadow-sm border border-emerald-200 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-lg font-semibold text-emerald-800 mb-2 flex items-center gap-2">
                <Download className="w-5 h-5" />
                完了
              </h2>
              <p className="text-sm text-emerald-700 mb-4">ファイルの処理が正常に完了しました。</p>
              <button 
                onClick={handleDownload}
                className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 px-4 rounded-lg shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2"
              >
                <Download className="w-5 h-5" />
                編集済みファイルをダウンロード
              </button>
            </div>
          )}
        </div>

        {/* Right Column: Code & Terminal */}
        <div className="flex flex-col gap-6 h-full min-h-[500px]">
          
          {/* Terminal */}
          <Terminal logs={logs} className="flex-1 min-h-[300px]" />

          {/* Code Preview (Collapsible or just small) */}
          {generatedCode && (
            <div className="bg-slate-900 rounded-xl shadow-sm border border-slate-700 overflow-hidden flex flex-col max-h-[400px]">
              <div className="bg-slate-800 px-4 py-2 flex items-center justify-between border-b border-slate-700">
                <span className="text-slate-300 text-xs font-mono font-bold flex items-center gap-2">
                  <Play className="w-3 h-3 text-emerald-400" />
                  生成コード (GENERATED_SCRIPT.PY)
                </span>
                <span className="text-xs text-slate-500">Gemini 2.5 Flash</span>
              </div>
              <pre className="p-4 overflow-auto text-xs font-mono text-emerald-50 scrollbar-thin flex-1">
                <code>{generatedCode}</code>
              </pre>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default App;