import React from 'react';
import { Icon } from '../components';
import { useI18n } from '../useI18n';
import { STORAGE_ERROR_EVENT } from '../storage';

// ── QA Touchstone — 事件驅動 Toast 層 ────────────────────────────────────────
// 訂閱兩種 window 事件並自行管理顯示狀態，發送方（send 流程 / storage 層）
// 不再持有 toast state：
//   • COOKIE_TOAST_EVENT  — Set-Cookie 捕捉（RequestContext 發出），4.2s 自動消失
//   • STORAGE_ERROR_EVENT — 本機儲存寫入失敗（storage.ts 發出），點擊關閉

export const COOKIE_TOAST_EVENT = 'qa-cookie-toast';

interface CookieToast {
  name: string;
  domain: string;
}
interface StorageToast {
  key?: string;
  message?: string;
}

export function ToastHost({ onOpenCookieJar }: { onOpenCookieJar?: () => void }) {
  const { t } = useI18n();
  const [cookieToast, setCookieToast] = React.useState<CookieToast | null>(null);
  const [storageToast, setStorageToast] = React.useState<StorageToast | null>(null);
  const cookieTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => {
    const onCookie = (e: Event) => {
      const detail = (e as CustomEvent<CookieToast>).detail;
      if (!detail) return;
      setCookieToast(detail);
      if (cookieTimer.current) clearTimeout(cookieTimer.current);
      cookieTimer.current = setTimeout(() => setCookieToast(null), 4200);
    };
    const onStorageError = (e: Event) => {
      setStorageToast((e as CustomEvent<StorageToast>).detail || { key: '', message: '' });
    };
    window.addEventListener(COOKIE_TOAST_EVENT, onCookie);
    window.addEventListener(STORAGE_ERROR_EVENT, onStorageError);
    return () => {
      window.removeEventListener(COOKIE_TOAST_EVENT, onCookie);
      window.removeEventListener(STORAGE_ERROR_EVENT, onStorageError);
      if (cookieTimer.current) clearTimeout(cookieTimer.current);
    };
  }, []);

  return (
    <>
      {/* Set-Cookie capture toast */}
      {cookieToast && (
        <div
          className="qa-toast"
          onClick={() => {
            setCookieToast(null);
            if (onOpenCookieJar) onOpenCookieJar();
          }}
        >
          <Icon name="globe" size={15} />
          <div className="qa-toast-text">
            <strong>{t('toast.cookieStored')}</strong>
            <span>
              {t('toast.cookieSaved', { name: cookieToast.name, domain: cookieToast.domain })}
            </span>
          </div>
          <span className="qa-toast-cta">{t('toast.viewJar')}</span>
        </div>
      )}

      {/* 本機儲存失敗 toast（點擊關閉） */}
      {storageToast && (
        <div className="qa-toast" role="alert" onClick={() => setStorageToast(null)}>
          <Icon name="shield" size={15} />
          <div className="qa-toast-text">
            <strong>{t('toast.storageFailTitle')}</strong>
            <span>{t('toast.storageFailBody', { key: storageToast.key || '?' })}</span>
          </div>
          <span className="qa-toast-cta">{t('toast.dismiss')}</span>
        </div>
      )}
    </>
  );
}
