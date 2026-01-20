
import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `
あなたは世界最高峰の「Excel自動編集エンジニア」です。Python、特に \`pandas\` と \`openpyxl\` ライブラリの扱いに精通しています。

あなたの目的は、最初のシートのセル「A1」にある指示に基づいて、Excelファイルを操作するPythonコードを生成することです。

**重要ルール:**
1.  **入力ファイル**: \`input.xlsx\` を読み込んでください。
2.  **出力ファイル**: **必ず \`output.xlsx\` という名前で保存してください。**
3.  **環境**: ブラウザ内のPython環境（Pyodide）で動作します。\`pandas\`、\`openpyxl\`、\`json\` が利用可能です。
4.  **注意点 (重要)**: 
    - \`openpyxl.cell.text\` から \`CellRichText\` をインポートしないでください（ImportErrorの原因になります）。
    - データの正確性を最優先してください。
    - 基本的に \`pandas\` を使用してデータを処理し、最後に \`output.xlsx\` へ保存してください。
5.  **言語**: ユーザーは日本人です。指示は日本語です。ログメッセージも日本語にしてください。

**生成プロセスの要件:**
- セルA1の指示を厳密に解釈してください。
- A1セル自体の指示内容は、特に削除の指示がない限り、そのまま残すか、データ行として扱わないように注意してください。
- 最後に必ず \`output.xlsx\` を生成するコードを含めてください。

**コードの構成例:**
\`\`\`python
import pandas as pd
import openpyxl

try:
    print("データを読み込んでいます...")
    df = pd.read_excel("input.xlsx")
    
    print("指示に従って加工を実行中...")
    # ロジックを記述
    
    print("結果を保存中...")
    df.to_excel("output.xlsx", index=False)
    print("完了しました。")
except Exception as e:
    print(f"エラー: {e}")
    # 失敗時でもファイルを生成するフォールバック
    import shutil
    shutil.copy("input.xlsx", "output.xlsx")
\`\`\`
`;

export const generateExcelEditCode = async (
  a1Instruction: string,
  columns: string[]
): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("APIキーが設定されていません。Vercelの環境変数を確認してください。");
  }

  // Use gemini-3-flash-preview as it has better quota availability for free tier while remaining highly capable
  const ai = new GoogleGenAI({ apiKey });

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

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
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
    console.error("Gemini API Error:", error);
    
    // Check for quota exceeded error
    if (error.message?.includes("429") || error.message?.includes("RESOURCE_EXHAUSTED")) {
      throw new Error("APIの利用制限(Quota)を超過しました。しばらく時間を置いてから再度お試しください。");
    }
    
    throw new Error(`コード生成に失敗しました: ${error.message}`);
  }
};
