import React from 'react';

// ── QA Touchstone — 根層錯誤邊界 ─────────────────────────────────────────────
// 之前任何元件丟出未捕捉錯誤都會讓整個 React 樹卸載（白屏、無訊息）。
// 這裡接住錯誤、顯示可讀的回報畫面與「重新載入」。文案刻意雙語硬編碼，
// 不依賴 i18n —— i18n 本身壞掉時錯誤畫面也必須能渲染。
export interface ErrorBoundaryProps {
  children?: React.ReactNode;
}

export interface ErrorBoundaryState {
  /** 捕到的 throw 值不保證是 Error（可能是字串等），型別從寬。 */
  error: any;
}

// 注意：不能用 class field 宣告（vite:react-babel 的 class-properties 轉換
// 會改變欄位初始化順序），維持 JS 原樣只在 constructor 指派；型別由
// React.Component<P, S> 泛型提供。
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Uncaught render error:', error, info && info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    const msg = String((this.state.error && this.state.error.message) || this.state.error);
    return (
      <div
        role="alert"
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          background: '#15181c',
          color: '#e8edf2',
          fontFamily: 'ui-monospace, monospace',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700 }}>Something went wrong / 程式發生錯誤</div>
        <div style={{ fontSize: 13, color: '#9aa7b2', maxWidth: 560, wordBreak: 'break-word' }}>
          {msg}
        </div>
        <button
          type="button"
          onClick={() => {
            try {
              window.location.reload();
            } catch {
              /* 非瀏覽器環境 */
            }
          }}
          style={{
            marginTop: 8,
            padding: '8px 18px',
            borderRadius: 8,
            border: '1px solid #3a424d',
            background: '#21262d',
            color: '#e8edf2',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Reload / 重新載入
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
