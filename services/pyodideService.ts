
// Define types for global Pyodide
declare global {
  interface Window {
    loadPyodide: (config: any) => Promise<any>;
    pyodideInstance: any;
  }
}

let pyodideReadyPromise: Promise<any> | null = null;

export const initPyodide = async (logCallback: (msg: string) => void) => {
  if (window.pyodideInstance) return window.pyodideInstance;

  if (!pyodideReadyPromise) {
    pyodideReadyPromise = (async () => {
      logCallback("Python実行環境(Pyodide)をロード中...");
      const pyodide = await window.loadPyodide({
        indexURL: "https://cdn.jsdelivr.net/pyodide/v0.25.1/full/",
      });
      
      logCallback("必要なライブラリ(pandas, openpyxl)をインストール中...");
      await pyodide.loadPackage("micropip");
      const micropip = pyodide.pyimport("micropip");
      await micropip.install(["pandas", "openpyxl"]);
      
      logCallback("Python環境の準備が完了しました。");
      window.pyodideInstance = pyodide;
      return pyodide;
    })();
  }
  return pyodideReadyPromise;
};

export const extractA1AndColumns = async (
  file: File
): Promise<{ a1: string; columns: string[] }> => {
  const pyodide = window.pyodideInstance;
  if (!pyodide) throw new Error("Python環境が初期化されていません。");

  const arrayBuffer = await file.arrayBuffer();
  pyodide.FS.writeFile("input_temp.xlsx", new Uint8Array(arrayBuffer));

  const script = `
import pandas as pd
import openpyxl
import json

try:
    # openpyxlでA1セルの生の値を取得
    wb = openpyxl.load_workbook("input_temp.xlsx", data_only=True)
    ws = wb.active
    a1_val = ws['A1'].value

    # pandasで列名を取得
    df = pd.read_excel("input_temp.xlsx")
    cols = list(df.columns)

    result = {
        "a1": str(a1_val) if a1_val is not None else "",
        "columns": [str(c) for c in cols]
    }
except Exception as e:
    result = {"a1": "", "columns": [], "error": str(e)}

json.dumps(result)
`;

  const resultJson = await pyodide.runPythonAsync(script);
  return JSON.parse(resultJson);
};

export const runPythonTransformation = async (
  script: string,
  inputFile: File,
  logCallback: (msg: string) => void
): Promise<Blob> => {
  const pyodide = window.pyodideInstance;
  if (!pyodide) throw new Error("Python環境が初期化されていません。");

  // Mount file
  logCallback("ファイルを仮想環境に準備中...");
  const arrayBuffer = await inputFile.arrayBuffer();
  pyodide.FS.writeFile("input.xlsx", new Uint8Array(arrayBuffer));

  // 標準出力をログにリダイレクト
  pyodide.setStdout({
    batched: (msg: string) => logCallback(`[Python] ${msg}`),
  });

  logCallback("Pythonスクリプトを実行しています...");
  try {
    // 実行前に前回の出力があれば削除
    try { pyodide.FS.unlink("output.xlsx"); } catch(e) {}
    
    await pyodide.runPythonAsync(script);
  } catch (err: any) {
    throw new Error(`実行エラー: ${err.message}`);
  }

  // Retrieve output
  logCallback("出力ファイルを確認しています...");
  if (pyodide.FS.analyzePath("output.xlsx").exists) {
    const fileData = pyodide.FS.readFile("output.xlsx");
    return new Blob([fileData], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  } else {
    // もし output.xlsx が生成されなかった場合、致命的な指示不足として扱う
    throw new Error("スクリプトは正常に終了しましたが、'output.xlsx' が生成されませんでした。Pythonコード内でファイルの保存処理（output.xlsxへの書き出し）が行われなかった可能性があります。指示内容を見直してもう一度お試しください。");
  }
};
