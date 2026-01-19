
import { GoogleGenAI } from "@google/genai";

const SYSTEM_INSTRUCTION = `
あなたは世界最高峰の「Excel自動編集エンジニア」です。Python、特に \`pandas\` と \`openpyxl\` ライブラリの扱いに精通しています。

あなたの目的は、最初のシートのセル「A1」にある指示に基づいて、Excelファイルを操作するPythonコードを生成することです。

**重要ルール:**
1.  **入力ファイル**: \`input.xlsx\` を読み込んでください。
2.  **出力ファイル**: **必ず \`output.xlsx\` という名前で保存してください。** 処理に変更がない場合や、エラーが発生しそうな場合でも、最終的にこのファイルが存在しないとシステムがエラーになります。
3.  **環境**: ブラウザ内のPython環境（Pyodide）で動作します。\`pandas\`、\`openpyxl\`、\`json\` が利用可能です。
4.  **言語**: ユーザーは日本人です。A1の指示は日本語です。
5.  **ログ出力**: 処理の各ステップで \`print()\` を使用して進捗を報告してください。**ログメッセージは必ず日本語にしてください。**

**生成プロセスの要件:**
- セルA1の指示を厳密に解釈してください。
- 指示に従ってデータを加工してください。
- A1セル自体を削除する指示がない限り、A1セルの指示内容は残したまま（あるいは適切に更新して）保存してください。
- 最後に必ず \`df.to_excel("output.xlsx", index=False)\` または \`wb.save("output.xlsx")\` を実行してください。
- コードブロック (\`\`\`python ... \`\`\`) のみを出力し、解説文は含めないでください。

**コードの構成例:**
\`\`\`python
import pandas as pd
import openpyxl

try:
    print("ファイルを読み込んでいます...")
    # 処理ロジック
    print("データを加工しています...")
    # 加工ロジック
    print("結果を output.xlsx に保存しています...")
    # 保存処理（必ず実行）
    print("処理が正常に完了しました。")
except Exception as e:
    print(f"エラーが発生しました: {e}")
    # 失敗しても元のファイルをコピーして保存するなどの配慮
\`\`\`
`;

export const generateExcelEditCode = async (
  a1Instruction: string,
  columns: string[]
): Promise<string> => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("API Key is missing.");
  }

  // Use gemini-3-pro-preview for high-quality code generation
  const ai = new GoogleGenAI({ apiKey });

  const prompt = `
    ユーザーがExcelファイルをアップロードしました。
    
    **セルA1の指示内容:** "${a1Instruction}"
    
    **シートの列構成:** ${columns.join(', ')}
    
    この指示を実行するためのPythonスクリプトを生成してください。
    入力ファイル: 'input.xlsx'
    出力ファイル: 'output.xlsx' (必ずこの名前で生成してください)
    
    \`\`\`python ... \`\`\` の形式で有効なPythonコードのみを返してください。
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: prompt,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        temperature: 0.1, // より決定論的で正確なコードのために低い温度設定
      }
    });

    const text = response.text;
    if (!text) throw new Error("Geminiからの応答が空です。");

    // Extract code block
    const codeMatch = text.match(/```python([\s\S]*?)```/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1].trim();
    }
    
    return text.replace(/```python/g, '').replace(/```/g, '').trim();

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    throw new Error(`コード生成に失敗しました: ${error.message}`);
  }
};
