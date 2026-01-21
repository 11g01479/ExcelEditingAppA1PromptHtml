
import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `
あなたは世界最高峰の「Excel自動編集エンジニア」です。Python、特に \`pandas\` と \`openpyxl\` ライブラリの扱いに精通しています。

あなたの目的は、最初のシートのセル「A1」にある指示に基づいて、Excelファイルを操作するPythonコードを生成することです。

**重要ルール:**
1.  **入力ファイル**: \`input.xlsx\` を読み込んでください。
2.  **出力ファイル**: **必ず \`output.xlsx\` という名前で保存してください。**
3.  **環境**: ブラウザ内のPython環境（Pyodide）で動作します。\`pandas\`、\`openpyxl\`、\`json\` が利用可能です。
4.  **注意点 (重要)**: 
    - \`openpyxl.cell.text\` から \`CellRichText\` をインポートしないでください。
    - データの正確性を最優先してください。
    - 基本的に \`pandas\` を使用してデータを処理し、最後に \`output.xlsx\` へ保存してください。
5.  **言語**: ユーザーは日本人です。指示は日本語です。ログメッセージも日本語にしてください。

**生成プロセスの要件:**
- セルA1の指示を厳密に解釈してください。
- A1セル自体の指示内容は、そのまま残すか、データ行として扱わないように注意してください。
- 最後に必ず \`output.xlsx\` を生成するコードを含めてください。
`;

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

export const generateExcelEditCode = async (
  a1Instruction: string,
  columns: string[],
  onRetry?: (attempt: number, message: string) => void
): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("APIキーが設定されていません。Vercelの環境変数を確認してください。");
  }

  // Create instance right before use as per best practices
  const ai = new GoogleGenAI({ apiKey });
  const modelName = 'gemini-3-flash-preview';

  const prompt = `
    Excelファイルの自動編集用スクリプトを作成してください。
    
    **指示内容 (A1セル):** "${a1Instruction}"
    **現在の列構成:** ${columns.join(', ')}
    
    **要件:**
    - 'input.xlsx' を読み込み、指示通りに加工して 'output.xlsx' に保存する。
    - 'openpyxl.cell.text' からの 'CellRichText' インポートは避けること。
    - 進捗を日本語で print 出力すること。
    
    Pythonコードのみを \`\`\`python ... \`\`\` 形式で出力してください。
  `;

  let lastError: any;
  const maxRetries = 8; // Increased retries for sustained overload
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          temperature: 0.1,
        }
      });

      const text = response.text;
      if (!text) throw new Error("AIからの応答が空です。");

      const codeMatch = text.match(/```python([\s\S]*?)```/);
      if (codeMatch && codeMatch[1]) {
        return codeMatch[1].trim();
      }
      return text.replace(/```python/g, '').replace(/```/g, '').trim();

    } catch (error: any) {
      lastError = error;
      
      // Attempt to extract structured error data
      const status = error.status || (error.response && error.response.status);
      const code = error.code || (error.response && error.response.code);
      const errorMsg = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
      
      const isRetryable = 
        status === "UNAVAILABLE" || 
        status === "RESOURCE_EXHAUSTED" ||
        String(code) === "503" ||
        String(code) === "429" ||
        errorMsg.includes("503") ||
        errorMsg.includes("429") ||
        errorMsg.toLowerCase().includes("overloaded") ||
        errorMsg.toLowerCase().includes("unavailable") ||
        errorMsg.toLowerCase().includes("resource_exhausted");
      
      if (isRetryable && attempt < maxRetries) {
        // Exponential backoff with jitter: (2^attempt * 1.5s) + random(0-1s)
        const backoffMs = Math.pow(1.8, attempt) * 1500 + Math.random() * 1000;
        onRetry?.(attempt + 1, `AIサーバーが混雑しています。再試行中 (${attempt + 1}/${maxRetries})...`);
        await delay(backoffMs);
        continue;
      }
      
      break; 
    }
  }

  // Final error handling with clean messages
  let finalMessage = lastError.message || "不明なエラーが発生しました。";
  if (finalMessage.includes('{"error"')) {
    try {
      const match = finalMessage.match(/\{"error":.*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        finalMessage = parsed.error?.message || finalMessage;
      }
    } catch(e) {}
  }

  if (finalMessage.toLowerCase().includes("overloaded") || finalMessage.includes("503") || finalMessage.includes("UNAVAILABLE")) {
    throw new Error("AIサーバーが現在非常に混み合っています。Google側の無料枠制限により発生しています。1〜2分待ってから、下の「再試行」ボタンを押してください。");
  }
  
  if (finalMessage.includes("429") || finalMessage.includes("RESOURCE_EXHAUSTED")) {
    throw new Error("APIの利用制限(Quota)に達しました。しばらく時間を置いてから再度お試しください。");
  }
  
  throw new Error(`エラー: ${finalMessage}`);
};
